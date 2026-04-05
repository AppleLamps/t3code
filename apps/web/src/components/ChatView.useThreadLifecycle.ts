import type { MessageId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  type ComposerTrigger,
  detectComposerTrigger,
} from "../composer-logic";
import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../composerDraftStore";
import { useComposerDraftStore } from "../composerDraftStore";
import type { TerminalContextDraft } from "../lib/terminalContext";
import type { ChatMessage, SessionPhase } from "../types";
import {
  readFileAsDataUrl,
  reconcileMountedTerminalThreadIds,
  revokeUserMessagePreviewUrls,
  type PullRequestDialogState,
} from "./ChatView.logic";
import { collectUserMessageBlobPreviewUrls } from "./ChatView.useAttachmentPreviewHandoff";

const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 2;

export interface ThreadLifecycleInput {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;

  // Thread data
  serverThread: { id: ThreadId } | undefined;
  activeThread: { id: ThreadId; messages: ChatMessage[] } | undefined;
  activeLatestTurnCompletedAt: string | null;
  activeThreadLastVisitedAt: string | undefined;
  latestTurnSettled: boolean;
  phase: SessionPhase;
  composerImages: ComposerImageAttachment[];
  composerTerminalContexts: TerminalContextDraft[];
  prompt: string;

  // Terminal state
  terminalOpen: boolean;
  existingOpenTerminalThreadIds: ThreadId[];

  // Optimistic messages
  optimisticUserMessages: ChatMessage[];
  setOptimisticUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;

  // State setters
  setMountedTerminalThreadIds: React.Dispatch<React.SetStateAction<ThreadId[]>>;
  setExpandedWorkGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setPullRequestDialogState: React.Dispatch<React.SetStateAction<PullRequestDialogState | null>>;
  setPlanSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRevertingCheckpoint: React.Dispatch<React.SetStateAction<boolean>>;
  setComposerHighlightedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setComposerCursor: React.Dispatch<React.SetStateAction<number>>;
  setComposerTrigger: React.Dispatch<React.SetStateAction<ComposerTrigger | null>>;
  setIsDragOverComposer: (value: boolean) => void;
  setExpandedImage: (image: null) => void;
  setNowTick: React.Dispatch<React.SetStateAction<number>>;
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>;

  // Refs
  promptRef: React.MutableRefObject<string>;
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: React.MutableRefObject<TerminalContextDraft[]>;
  planSidebarDismissedForTurnRef: React.MutableRefObject<string | null>;
  planSidebarOpenOnNextThreadRef: React.MutableRefObject<boolean>;
  terminalOpenByThreadRef: React.MutableRefObject<Record<string, boolean>>;

  // Callbacks
  markThreadVisited: (threadId: ThreadId) => void;
  resetLocalDispatch: () => void;
  focusComposer: () => void;
  handoffAttachmentPreviews: (messageId: MessageId, urls: string[]) => void;

  // Draft store
  clearComposerDraftPersistedAttachments: (threadId: ThreadId) => void;
  syncComposerDraftPersistedAttachments: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[],
  ) => void;
}

export function useThreadLifecycle(input: ThreadLifecycleInput): void {
  const {
    threadId,
    activeThreadId,
    serverThread,
    activeThread,
    activeLatestTurnCompletedAt,
    activeThreadLastVisitedAt,
    latestTurnSettled,
    phase,
    composerImages,
    composerTerminalContexts,
    prompt,
    terminalOpen,
    existingOpenTerminalThreadIds,
    optimisticUserMessages,
    setOptimisticUserMessages,
    setMountedTerminalThreadIds,
    setExpandedWorkGroups,
    setPullRequestDialogState,
    setPlanSidebarOpen,
    setIsRevertingCheckpoint,
    setComposerHighlightedItemId,
    setComposerCursor,
    setComposerTrigger,
    setIsDragOverComposer,
    setExpandedImage,
    setNowTick,
    setTerminalFocusRequestId,
    promptRef,
    composerImagesRef,
    composerTerminalContextsRef,
    planSidebarDismissedForTurnRef,
    planSidebarOpenOnNextThreadRef,
    terminalOpenByThreadRef,
    markThreadVisited,
    resetLocalDispatch,
    focusComposer,
    handoffAttachmentPreviews,
    clearComposerDraftPersistedAttachments,
    syncComposerDraftPersistedAttachments,
  } = input;

  // --- Terminal mount reconciliation ---
  useEffect(() => {
    setMountedTerminalThreadIds((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadIds,
        activeThreadId,
        activeThreadTerminalOpen: Boolean(activeThreadId && terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  }, [activeThreadId, existingOpenTerminalThreadIds, setMountedTerminalThreadIds, terminalOpen]);

  // --- Mark thread visited ---
  useEffect(() => {
    if (!serverThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurnCompletedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurnCompletedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(serverThread.id);
  }, [
    activeLatestTurnCompletedAt,
    activeThreadLastVisitedAt,
    latestTurnSettled,
    markThreadVisited,
    serverThread?.id,
  ]);

  // --- Thread change: reset sidebar, PR, work groups ---
  useEffect(() => {
    setExpandedWorkGroups({});
    setPullRequestDialogState(null);
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false;
      setPlanSidebarOpen(true);
    } else {
      setPlanSidebarOpen(false);
    }
    planSidebarDismissedForTurnRef.current = null;
  }, [
    activeThread?.id,
    planSidebarDismissedForTurnRef,
    planSidebarOpenOnNextThreadRef,
    setExpandedWorkGroups,
    setPlanSidebarOpen,
    setPullRequestDialogState,
  ]);

  // --- Thread change: reset revert flag ---
  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeThread?.id, setIsRevertingCheckpoint]);

  // --- Thread change: focus composer when terminal closed ---
  useEffect(() => {
    if (!activeThread?.id || terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalOpen]);

  // --- Ref syncs ---
  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages, composerImagesRef]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts, composerTerminalContextsRef]);

  // --- Optimistic message cleanup ---
  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeThread?.id,
    activeThread?.messages,
    handoffAttachmentPreviews,
    optimisticUserMessages,
    setOptimisticUserMessages,
  ]);

  // --- Prompt ref sync + cursor clamp ---
  useEffect(() => {
    promptRef.current = prompt;
    setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
  }, [prompt, promptRef, setComposerCursor]);

  // --- Full thread reset on threadId change ---
  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
    setComposerHighlightedItemId(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
    setIsDragOverComposer(false);
    setExpandedImage(null);
  }, [
    promptRef,
    resetLocalDispatch,
    setComposerCursor,
    setComposerHighlightedItemId,
    setComposerTrigger,
    setExpandedImage,
    setIsDragOverComposer,
    setOptimisticUserMessages,
    threadId,
  ]);

  // --- Image persistence to draft store ---
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(threadId);
        return;
      }
      const getPersistedAttachmentsForThread = () =>
        useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) {
          return;
        }
        syncComposerDraftPersistedAttachments(threadId, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds = fallbackPersistedAttachments
          .map((attachment) => attachment.id)
          .filter((id) => currentImageIds.has(id));
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) {
          return;
        }
        syncComposerDraftPersistedAttachments(threadId, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearComposerDraftPersistedAttachments,
    composerImages,
    syncComposerDraftPersistedAttachments,
    threadId,
  ]);

  // --- Now tick timer (elapsed display while running) ---
  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [phase, setNowTick]);

  // --- Terminal open/close focus tracking ---
  useEffect(() => {
    if (!activeThreadId) return;
    const previous = terminalOpenByThreadRef.current[activeThreadId] ?? false;
    const current = Boolean(terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadId] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadId] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadId] = current;
  }, [
    activeThreadId,
    focusComposer,
    setTerminalFocusRequestId,
    terminalOpen,
    terminalOpenByThreadRef,
  ]);
}
