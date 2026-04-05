import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProjectId,
  type ProjectScript,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { truncate } from "@t3tools/shared/String";
import { useCallback, useRef } from "react";
import { type NavigateFn } from "@tanstack/react-router";
import { readNativeApi } from "~/nativeApi";
import { newCommandId, newMessageId, newThreadId, warnIgnoredError } from "~/lib/utils";
import { toastManager } from "./ui/toast";
import type { ComposerTrigger } from "../composer-logic";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import { resolvePlanFollowUpSubmission } from "../proposedPlan";
import { buildPlanImplementationPrompt, buildPlanImplementationThreadTitle } from "../proposedPlan";
import type { ChatMessage, SessionPhase, Thread } from "../types";
import {
  buildExpiredTerminalContextToastCopy,
  buildTemporaryWorktreeBranchName,
  cloneComposerImageForRetry,
  deriveComposerSendState,
  readFileAsDataUrl,
  revokeUserMessagePreviewUrls,
  waitForStartedServerThread,
} from "./ChatView.logic";
import type { ComposerImageAttachment } from "../composerDraftStore";
import { getProviderModelCapabilities } from "../providerModels";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";
import type { ClaudeCodeEffort } from "@t3tools/contracts";
import { setupProjectScript } from "~/projectScripts";
import type { UseMutationResult } from "@tanstack/react-query";

const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

function formatOutgoingPrompt(params: {
  provider: ProviderKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeCodeEffort | null);
  }
  return params.text;
}

export interface SendMessageResult {
  onSend: (e?: { preventDefault: () => void }) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onSubmitPlanFollowUp: (input: {
    text: string;
    interactionMode: "default" | "plan";
  }) => Promise<void>;
  onImplementPlanInNewThread: () => Promise<void>;
  onRevertToTurnCount: (turnCount: number) => Promise<void>;
  sendInFlightRef: React.RefObject<boolean>;
}

export interface SendMessageInput {
  activeThread: Thread | undefined;
  activeProject:
    | {
        id: ProjectId;
        cwd: string;
        scripts: ProjectScript[];
        defaultModelSelection?: ModelSelection | null;
      }
    | undefined;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  envMode: "local" | "worktree";
  // Model selection
  selectedProvider: ProviderKind;
  selectedModel: string;
  selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  selectedPromptEffort: string | null;
  selectedModelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  // Composer state refs
  promptRef: React.RefObject<string>;
  composerImagesRef: React.RefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: React.RefObject<TerminalContextDraft[]>;
  shouldAutoScrollRef: React.RefObject<boolean>;
  // Current composer values (for reading at send time)
  composerImages: ComposerImageAttachment[];
  composerTerminalContexts: TerminalContextDraft[];
  // UI state
  isSendBusy: boolean;
  isConnecting: boolean;
  isRevertingCheckpoint: boolean;
  phase: SessionPhase;
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: {
    id: string;
    planMarkdown: string;
    turnId: string | null;
  } | null;
  activePendingProgress: { questionIndex: number } | null;
  // Dispatch callbacks
  beginLocalDispatch: (opts: { preparingWorktree: boolean }) => void;
  resetLocalDispatch: () => void;
  forceStickToBottom: () => void;
  onAdvanceActivePendingUserInput: () => void;
  // Thread settings
  persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    modelSelection?: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
  // State setters
  setOptimisticUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  setStoreThreadBranch: (threadId: ThreadId, branch: string, worktreePath: string) => void;
  setComposerHighlightedItemId: (id: string | null) => void;
  setComposerCursor: (cursor: number) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  setComposerDraftInteractionMode: (threadId: ThreadId, mode: ProviderInteractionMode) => void;
  clearComposerDraftContent: (threadId: ThreadId) => void;
  setPrompt: (prompt: string) => void;
  addComposerImagesToDraft: (images: ComposerImageAttachment[]) => void;
  addComposerTerminalContextsToDraft: (contexts: TerminalContextDraft[]) => void;
  setIsRevertingCheckpoint: (value: boolean) => void;
  setPlanSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  planSidebarDismissedForTurnRef: React.RefObject<string | null>;
  planSidebarOpenOnNextThreadRef: React.RefObject<boolean>;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  // Worktree
  createWorktreeMutation: UseMutationResult<
    { worktree: { branch: string; path: string } },
    Error,
    { cwd: string; branch: string; newBranch: string }
  >;
  // Side effects
  runProjectScript: (
    script: ProjectScript,
    options?: {
      cwd?: string;
      worktreePath?: string | null;
      rememberAsLastInvoked?: boolean;
    },
  ) => Promise<void>;
  navigate: NavigateFn;
}

export function useSendMessage(input: SendMessageInput): SendMessageResult {
  const {
    activeThread,
    activeProject,
    isServerThread,
    isLocalDraftThread,
    envMode,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    selectedPromptEffort,
    selectedModelSelection,
    runtimeMode,
    interactionMode,
    promptRef,
    composerImagesRef,
    composerTerminalContextsRef,
    shouldAutoScrollRef,
    composerImages,
    composerTerminalContexts,
    isSendBusy,
    isConnecting,
    isRevertingCheckpoint,
    phase,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    activePendingProgress,
    beginLocalDispatch,
    resetLocalDispatch,
    forceStickToBottom,
    onAdvanceActivePendingUserInput,
    persistThreadSettingsForNextTurn,
    setOptimisticUserMessages,
    setThreadError,
    setStoreThreadBranch,
    setComposerHighlightedItemId,
    setComposerCursor,
    setComposerTrigger,
    setComposerDraftInteractionMode,
    clearComposerDraftContent,
    setPrompt,
    addComposerImagesToDraft,
    addComposerTerminalContextsToDraft,
    setIsRevertingCheckpoint,
    setPlanSidebarOpen,
    planSidebarDismissedForTurnRef,
    planSidebarOpenOnNextThreadRef,
    handleInteractionModeChange,
    createWorktreeMutation,
    runProjectScript,
    navigate,
  } = input;

  const sendInFlightRef = useRef(false);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = readNativeApi();
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        effort: selectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginLocalDispatch({ preparingWorktree: false });
      setThreadError(threadIdForSend, null);
      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);
      shouldAutoScrollRef.current = true;
      forceStickToBottom();

      try {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: selectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(threadIdForSend, nextInteractionMode);

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default") {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetLocalDispatch();
      }
    },
    [
      activeThread,
      activeProposedPlan,
      beginLocalDispatch,
      forceStickToBottom,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      resetLocalDispatch,
      runtimeMode,
      selectedPromptEffort,
      selectedModelSelection,
      selectedProvider,
      selectedProviderModels,
      setComposerDraftInteractionMode,
      setThreadError,
      selectedModel,
      shouldAutoScrollRef,
      setOptimisticUserMessages,
      setPlanSidebarOpen,
      planSidebarDismissedForTurnRef,
    ],
  );

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const api = readNativeApi();
    if (!api || !activeThread || isSendBusy || isConnecting || sendInFlightRef.current) return;
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }
    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
    });
    if (showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      promptRef.current = "";
      clearComposerDraftContent(activeThread.id);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }
    const standaloneSlashCommand =
      composerImages.length === 0 && sendableComposerTerminalContexts.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(activeThread.id);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        });
      }
      return;
    }
    if (!activeProject) return;
    const threadIdForSend = activeThread.id;
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      isFirstMessage && envMode === "worktree" && !activeThread.worktreePath
        ? activeThread.branch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && envMode === "worktree" && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThread.branch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });

    const composerImagesSnapshot = [...composerImages];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const messageTextForSend = appendTerminalContextsToPrompt(
      promptForSend,
      composerTerminalContextsSnapshot,
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: selectedPromptEffort,
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    });
    const turnAttachmentsPromise = Promise.all(
      composerImagesSnapshot.map(async (image) => ({
        type: "image" as const,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: await readFileAsDataUrl(image.file),
      })),
    );
    const optimisticAttachments = composerImagesSnapshot.map((image) => ({
      type: "image" as const,
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      previewUrl: image.previewUrl,
    }));
    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        createdAt: messageCreatedAt,
        streaming: false,
      },
    ]);
    // Sending a message should always bring the latest user turn into view.
    shouldAutoScrollRef.current = true;
    forceStickToBottom();

    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add({
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      });
    }
    promptRef.current = "";
    clearComposerDraftContent(threadIdForSend);
    setComposerHighlightedItemId(null);
    setComposerCursor(0);
    setComposerTrigger(null);

    let createdServerThreadForLocalDraft = false;
    let turnStartSucceeded = false;
    let nextThreadBranch = activeThread.branch;
    let nextThreadWorktreePath = activeThread.worktreePath;
    await (async () => {
      // On first message: lock in branch + create worktree if needed.
      if (baseBranchForWorktree) {
        beginLocalDispatch({ preparingWorktree: true });
        const newBranch = buildTemporaryWorktreeBranchName();
        const result = await createWorktreeMutation.mutateAsync({
          cwd: activeProject.cwd,
          branch: baseBranchForWorktree,
          newBranch,
        });
        nextThreadBranch = result.worktree.branch;
        nextThreadWorktreePath = result.worktree.path;
        if (isServerThread) {
          await api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: threadIdForSend,
            branch: result.worktree.branch,
            worktreePath: result.worktree.path,
          });
          // Keep local thread state in sync immediately so terminal drawer opens
          // with the worktree cwd/env instead of briefly using the project root.
          setStoreThreadBranch(threadIdForSend, result.worktree.branch, result.worktree.path);
        }
      }

      let firstComposerImageName: string | null = null;
      if (composerImagesSnapshot.length > 0) {
        const firstComposerImage = composerImagesSnapshot[0];
        if (firstComposerImage) {
          firstComposerImageName = firstComposerImage.name;
        }
      }
      let titleSeed = trimmed;
      if (!titleSeed) {
        if (firstComposerImageName) {
          titleSeed = `Image: ${firstComposerImageName}`;
        } else if (composerTerminalContextsSnapshot.length > 0) {
          titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
        } else {
          titleSeed = "New thread";
        }
      }
      const title = truncate(titleSeed);
      const threadCreateModelSelection: ModelSelection = {
        provider: selectedProvider,
        model:
          selectedModel ||
          activeProject.defaultModelSelection?.model ||
          DEFAULT_MODEL_BY_PROVIDER.codex,
        ...(selectedModelSelection.options ? { options: selectedModelSelection.options } : {}),
      };

      if (isLocalDraftThread) {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          projectId: activeProject.id,
          title,
          modelSelection: threadCreateModelSelection,
          runtimeMode,
          interactionMode,
          branch: nextThreadBranch,
          worktreePath: nextThreadWorktreePath,
          createdAt: activeThread.createdAt,
        });
        createdServerThreadForLocalDraft = true;
      }

      let setupScript: ProjectScript | null = null;
      if (baseBranchForWorktree) {
        setupScript = setupProjectScript(activeProject.scripts);
      }
      if (setupScript) {
        let shouldRunSetupScript = false;
        if (isServerThread) {
          shouldRunSetupScript = true;
        } else {
          if (createdServerThreadForLocalDraft) {
            shouldRunSetupScript = true;
          }
        }
        if (shouldRunSetupScript) {
          const setupScriptOptions: Parameters<typeof runProjectScript>[1] = {
            worktreePath: nextThreadWorktreePath,
            rememberAsLastInvoked: false,
          };
          if (nextThreadWorktreePath) {
            setupScriptOptions.cwd = nextThreadWorktreePath;
          }
          await runProjectScript(setupScript, setupScriptOptions);
        }
      }

      // Auto-title from first message
      if (isFirstMessage && isServerThread) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          title,
        });
      }

      if (isServerThread) {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          ...(selectedModel ? { modelSelection: selectedModelSelection } : {}),
          runtimeMode,
          interactionMode,
        });
      }

      beginLocalDispatch({ preparingWorktree: false });
      const turnAttachments = await turnAttachmentsPromise;
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        message: {
          messageId: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          attachments: turnAttachments,
        },
        modelSelection: selectedModelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        createdAt: messageCreatedAt,
      });
      turnStartSucceeded = true;
    })().catch(async (err: unknown) => {
      if (createdServerThreadForLocalDraft && !turnStartSucceeded) {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: threadIdForSend,
          })
          .catch(
            warnIgnoredError("send: compensating thread delete", { threadId: threadIdForSend }),
          );
      }
      if (
        !turnStartSucceeded &&
        promptRef.current.length === 0 &&
        composerImagesRef.current.length === 0 &&
        composerTerminalContextsRef.current.length === 0
      ) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        promptRef.current = promptForSend;
        setPrompt(promptForSend);
        setComposerCursor(collapseExpandedComposerCursor(promptForSend, promptForSend.length));
        addComposerImagesToDraft(composerImagesSnapshot.map(cloneComposerImageForRetry));
        addComposerTerminalContextsToDraft(composerTerminalContextsSnapshot);
        setComposerTrigger(detectComposerTrigger(promptForSend, promptForSend.length));
      }
      setThreadError(
        threadIdForSend,
        err instanceof Error ? err.message : "Failed to send message.",
      );
    });
    sendInFlightRef.current = false;
    if (!turnStartSucceeded) {
      resetLocalDispatch();
    }
  };

  const onInterrupt = async () => {
    const api = readNativeApi();
    if (!api || !activeThread) return;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
    });
  };

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = readNativeApi();
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: selectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = selectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: activeThread.branch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        });
      })
      .then(() => {
        return waitForStartedServerThread(nextThreadId);
      })
      .then(() => {
        // Signal that the plan sidebar should open on the new thread.
        planSidebarOpenOnNextThreadRef.current = true;
        return navigate({
          to: "/$threadId",
          params: { threadId: nextThreadId },
        });
      })
      .catch(async (err) => {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .catch(
            warnIgnoredError("implement plan: compensating thread delete", {
              threadId: nextThreadId,
            }),
          );
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            err instanceof Error ? err.message : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeThread,
    beginLocalDispatch,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetLocalDispatch,
    runtimeMode,
    selectedPromptEffort,
    selectedModelSelection,
    selectedProvider,
    selectedProviderModels,
    selectedModel,
    planSidebarOpenOnNextThreadRef,
  ]);

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = readNativeApi();
      if (!api || !activeThread || isRevertingCheckpoint) return;

      if (phase === "running" || isSendBusy || isConnecting) {
        setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
        return;
      }
      const confirmed = await api.dialogs.confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this thread.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to revert thread state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [
      activeThread,
      isConnecting,
      isRevertingCheckpoint,
      isSendBusy,
      phase,
      setThreadError,
      setIsRevertingCheckpoint,
    ],
  );

  return {
    onSend,
    onInterrupt,
    onSubmitPlanFollowUp,
    onImplementPlanInNewThread,
    onRevertToTurnCount,
    sendInFlightRef,
  };
}
