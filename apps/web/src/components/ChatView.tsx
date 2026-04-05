import {
  DEFAULT_MODEL_BY_PROVIDER,
  type MessageId,
  type ModelSelection,
  type ProviderKind,
  type ServerProvider,
  type ThreadId,
  type TurnId,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { gitCreateWorktreeMutationOptions, gitStatusQueryOptions } from "~/lib/gitReactQuery";
import { isElectron } from "../env";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import {
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
} from "../composer-logic";
import {
  deriveCompletionDividerBeforeEntryId,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  formatElapsed,
} from "../session-logic";
import { useStore } from "../store";
import { useProjectById, useThreadById } from "../storeSelectors";
import { useUiStateStore } from "../uiStateStore";
import { proposedPlanTitle } from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type Thread,
  type TurnDiffSummary,
} from "../types";
import { LRUCache } from "../lib/lruCache";

import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import BranchToolbar from "./BranchToolbar";
import { shortcutLabelForCommand } from "../keybindings";
import PlanSidebar from "./PlanSidebar";
import {
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ListTodoIcon,
  LockIcon,
  LockOpenIcon,
  XIcon,
} from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { projectScriptCwd, setupProjectScript } from "~/projectScripts";
import { SidebarTrigger } from "./ui/sidebar";
import { newCommandId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { getProviderModels, resolveSelectableProvider } from "../providerModels";
import { useSettings } from "../hooks/useSettings";
import { resolveAppModelSelection } from "../modelSelection";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  useEffectiveComposerModelState,
  useComposerThreadDraft,
} from "../composerDraftStore";
import { type TerminalContextDraft } from "../lib/terminalContext";
import { deriveLatestContextWindowSnapshot } from "../lib/contextWindow";
import {
  resolveComposerFooterContentWidth,
  shouldForceCompactComposerFooterForFit,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { ComponentErrorBoundary } from "./ui/error-boundary";
import { ChatHeader } from "./chat/ChatHeader";
import { ContextWindowMeter } from "./chat/ContextWindowMeter";
import { buildExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { ComposerCommandMenu } from "./chat/ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./chat/ComposerPendingApprovalActions";
import { CompactComposerControlsMenu } from "./chat/CompactComposerControlsMenu";
import { ComposerPrimaryActions } from "./chat/ComposerPrimaryActions";
import { ComposerPendingApprovalPanel } from "./chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./chat/ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./chat/ComposerPlanFollowUpBanner";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./chat/composerProviderRegistry";
import { ProviderStatusBanner } from "./chat/ProviderStatusBanner";
import { ThreadErrorBanner } from "./chat/ThreadErrorBanner";
import {
  buildLocalDraftThread,
  deriveComposerSendState,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  PullRequestDialogState,
  threadHasStarted,
} from "./ChatView.logic";
import { useLocalDispatchState } from "./ChatView.useLocalDispatch";
import PersistentThreadTerminalDrawer from "./PersistentThreadTerminalDrawer";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import {
  useServerAvailableEditors,
  useServerConfig,
  useServerKeybindings,
} from "~/rpc/serverState";
import { useScrollBehavior } from "./ChatView.useScrollBehavior";
import { useImageExpansion } from "./ChatView.useImageExpansion";
import { useTerminalActions } from "./ChatView.useTerminalActions";
import { useAttachmentPreviewHandoff } from "./ChatView.useAttachmentPreviewHandoff";
import { usePendingUserInput } from "./ChatView.usePendingUserInput";
import {
  useProjectScripts,
  type PendingPullRequestSetupRequest,
} from "./ChatView.useProjectScripts";
import { useSendMessage } from "./ChatView.useSendMessage";
import { useKeyboardShortcuts } from "./ChatView.useKeyboardShortcuts";
import { useComposerEditor } from "./ChatView.useComposerEditor";
import { useThreadLifecycle } from "./ChatView.useThreadLifecycle";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];

type ThreadPlanCatalogEntry = Pick<Thread, "id" | "proposedPlans">;

const MAX_THREAD_PLAN_CATALOG_CACHE_ENTRIES = 500;
const MAX_THREAD_PLAN_CATALOG_CACHE_MEMORY_BYTES = 512 * 1024;
const threadPlanCatalogCache = new LRUCache<{
  proposedPlans: Thread["proposedPlans"];
  entry: ThreadPlanCatalogEntry;
}>(MAX_THREAD_PLAN_CATALOG_CACHE_ENTRIES, MAX_THREAD_PLAN_CATALOG_CACHE_MEMORY_BYTES);

function estimateThreadPlanCatalogEntrySize(thread: Thread): number {
  return Math.max(
    64,
    thread.id.length +
      thread.proposedPlans.reduce(
        (total, plan) =>
          total +
          plan.id.length +
          plan.planMarkdown.length +
          plan.updatedAt.length +
          (plan.turnId?.length ?? 0),
        0,
      ),
  );
}

function toThreadPlanCatalogEntry(thread: Thread): ThreadPlanCatalogEntry {
  const cached = threadPlanCatalogCache.get(thread.id);
  if (cached && cached.proposedPlans === thread.proposedPlans) {
    return cached.entry;
  }

  const entry: ThreadPlanCatalogEntry = {
    id: thread.id,
    proposedPlans: thread.proposedPlans,
  };
  threadPlanCatalogCache.set(
    thread.id,
    {
      proposedPlans: thread.proposedPlans,
      entry,
    },
    estimateThreadPlanCatalogEntrySize(thread),
  );
  return entry;
}

function useThreadPlanCatalog(threadIds: readonly ThreadId[]): ThreadPlanCatalogEntry[] {
  const selector = useMemo(() => {
    let previousThreads: Array<Thread | undefined> | null = null;
    let previousEntries: ThreadPlanCatalogEntry[] = [];

    return (state: { threads: Thread[] }): ThreadPlanCatalogEntry[] => {
      const nextThreads = threadIds.map((threadId) =>
        state.threads.find((thread) => thread.id === threadId),
      );
      const cachedThreads = previousThreads;
      if (
        cachedThreads &&
        nextThreads.length === cachedThreads.length &&
        nextThreads.every((thread, index) => thread === cachedThreads[index])
      ) {
        return previousEntries;
      }

      previousThreads = nextThreads;
      previousEntries = nextThreads.flatMap((thread) =>
        thread ? [toThreadPlanCatalogEntry(thread)] : [],
      );
      return previousEntries;
    };
  }, [threadIds]);

  return useStore(selector);
}

interface ChatViewProps {
  threadId: ThreadId;
}

export default function ChatView({ threadId }: ChatViewProps) {
  const serverThread = useThreadById(threadId);
  const setStoreThreadError = useStore((store) => store.setError);
  const setStoreThreadBranch = useStore((store) => store.setThreadBranch);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const activeThreadLastVisitedAt = useUiStateStore(
    (store) => store.threadLastVisitedAtById[threadId],
  );
  const settings = useSettings();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }));
  const composerDraft = useComposerThreadDraft(threadId);
  const prompt = composerDraft.prompt;
  const composerImages = composerDraft.images;
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length,
        terminalContexts: composerTerminalContexts,
      }),
    [composerImages.length, composerTerminalContexts, prompt],
  );
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const addComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.addTerminalContexts,
  );
  const removeComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.removeTerminalContext,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const promptRef = useRef(prompt);
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>(composerTerminalContexts);
  const [localDraftErrorsByThreadId, setLocalDraftErrorsByThreadId] = useState<
    Record<ThreadId, string | null>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({});
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
  const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the thread-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new thread" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [pendingPullRequestSetupRequest, setPendingPullRequestSetupRequest] =
    useState<PendingPullRequestSetupRequest | null>(null);
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(prompt, prompt.length),
  );
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerFormHeightRef = useRef(0);
  const composerFooterRef = useRef<HTMLDivElement>(null);
  const composerFooterLeadingRef = useRef<HTMLDivElement>(null);
  const composerFooterActionsRef = useRef<HTMLDivElement>(null);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const terminalState = useMemo(
    () => selectThreadTerminalState(terminalStateByThreadId, threadId),
    [terminalStateByThreadId, threadId],
  );
  const openTerminalThreadIds = useMemo(
    () =>
      Object.entries(terminalStateByThreadId).flatMap(([nextThreadId, nextTerminalState]) =>
        nextTerminalState.terminalOpen ? [nextThreadId as ThreadId] : [],
      ),
    [terminalStateByThreadId],
  );
  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const threads = useStore((state) => state.threads);
  const serverThreadIds = useMemo(() => threads.map((thread) => thread.id), [threads]);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const draftThreadIds = useMemo(
    () => Object.keys(draftThreadsByThreadId) as ThreadId[],
    [draftThreadsByThreadId],
  );
  const [mountedTerminalThreadIds, setMountedTerminalThreadIds] = useState<ThreadId[]>([]);

  const setPrompt = useCallback(
    (nextPrompt: string) => {
      setComposerDraftPrompt(threadId, nextPrompt);
    },
    [setComposerDraftPrompt, threadId],
  );
  const addComposerImage = useCallback(
    (image: ComposerImageAttachment) => {
      addComposerDraftImage(threadId, image);
    },
    [addComposerDraftImage, threadId],
  );
  const addComposerImagesToDraft = useCallback(
    (images: ComposerImageAttachment[]) => {
      addComposerDraftImages(threadId, images);
    },
    [addComposerDraftImages, threadId],
  );
  const addComposerTerminalContextsToDraft = useCallback(
    (contexts: TerminalContextDraft[]) => {
      addComposerDraftTerminalContexts(threadId, contexts);
    },
    [addComposerDraftTerminalContexts, threadId],
  );
  const removeComposerImageFromDraft = useCallback(
    (imageId: string) => {
      removeComposerDraftImage(threadId, imageId);
    },
    [removeComposerDraftImage, threadId],
  );

  const fallbackDraftProject = useProjectById(draftThread?.projectId);
  const localDraftError = serverThread ? null : (localDraftErrorsByThreadId[threadId] ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? {
              provider: "codex",
              model: DEFAULT_MODEL_BY_PROVIDER.codex,
            },
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId],
  );
  const activeThread = serverThread ?? localDraftThread;
  const runtimeMode =
    composerDraft.runtimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerDraft.interactionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isServerThread = serverThread !== undefined;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const diffOpen = rawSearch.diff === "1";
  const activeThreadId = activeThread?.id ?? null;
  const existingOpenTerminalThreadIds = useMemo(() => {
    const existingThreadIds = new Set<ThreadId>([...serverThreadIds, ...draftThreadIds]);
    return openTerminalThreadIds.filter((nextThreadId) => existingThreadIds.has(nextThreadId));
  }, [draftThreadIds, openTerminalThreadIds, serverThreadIds]);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const threadPlanCatalog = useThreadPlanCatalog(
    useMemo(() => {
      const threadIds: ThreadId[] = [];
      if (activeThread?.id) {
        threadIds.push(activeThread.id);
      }
      const sourceThreadId = activeLatestTurn?.sourceProposedPlan?.threadId;
      if (sourceThreadId && sourceThreadId !== activeThread?.id) {
        threadIds.push(sourceThreadId);
      }
      return threadIds;
    }, [activeLatestTurn?.sourceProposedPlan?.threadId, activeThread?.id]),
  );
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(activeThread?.activities ?? []),
    [activeThread?.activities],
  );
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProject = useProjectById(activeThread?.projectId);

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
      setComposerHighlightedItemId(null);
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const storedDraftThread = getDraftThreadByProjectId(activeProject.id);
      if (storedDraftThread) {
        setDraftThreadContext(storedDraftThread.threadId, input);
        setProjectDraftThreadId(activeProject.id, storedDraftThread.threadId, input);
        if (storedDraftThread.threadId !== threadId) {
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        }
        return storedDraftThread.threadId;
      }

      const activeDraftThread = getDraftThread(threadId);
      if (!isServerThread && activeDraftThread?.projectId === activeProject.id) {
        setDraftThreadContext(threadId, input);
        setProjectDraftThreadId(activeProject.id, threadId, input);
        return threadId;
      }

      clearProjectDraftThreadId(activeProject.id);
      const nextThreadId = newThreadId();
      setProjectDraftThreadId(activeProject.id, nextThreadId, {
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
      });
      return nextThreadId;
    },
    [
      activeProject,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      isServerThread,
      navigate,
      setDraftThreadContext,
      setProjectDraftThreadId,
      threadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      const targetThreadId = await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
      const setupScript =
        input.worktreePath && activeProject ? setupProjectScript(activeProject.scripts) : null;
      if (targetThreadId && input.worktreePath && setupScript) {
        setPendingPullRequestSetupRequest({
          threadId: targetThreadId,
          worktreePath: input.worktreePath,
          scriptId: setupScript.id,
        });
      } else {
        setPendingPullRequestSetupRequest(null);
      }
    },
    [activeProject, openOrReuseProjectDraftThread],
  );

  const sessionProvider = activeThread?.session?.provider ?? null;
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.provider ?? activeProject?.defaultModelSelection?.provider ?? null;
  const hasThreadStarted = threadHasStarted(activeThread);
  const lockedProvider: ProviderKind | null = hasThreadStarted
    ? (sessionProvider ?? threadProvider ?? selectedProviderByThreadId ?? null)
    : null;
  const serverConfig = useServerConfig();
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? "codex",
  );
  const selectedProvider: ProviderKind = lockedProvider ?? unlockedSelectedProvider;
  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId,
    providers: providerStatuses,
    selectedProvider,
    threadModelSelection: activeThread?.modelSelection,
    projectModelSelection: activeProject?.defaultModelSelection,
    settings,
  });
  const selectedProviderModels = getProviderModels(providerStatuses, selectedProvider);
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        prompt,
        modelOptions: composerModelOptions,
      }),
    [composerModelOptions, prompt, selectedModel, selectedProvider, selectedProviderModels],
  );
  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  const selectedModelSelection = useMemo<ModelSelection>(
    () => ({
      provider: selectedProvider,
      model: selectedModel,
      ...(selectedModelOptionsForDispatch ? { options: selectedModelOptionsForDispatch } : {}),
    }),
    [selectedModel, selectedModelOptionsForDispatch, selectedProvider],
  );
  const selectedModelForPicker = selectedModel;
  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const pendingUserInputResult = usePendingUserInput({
    threadActivities,
    activeThreadId: activeThreadId ?? undefined,
    setStoreThreadError,
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    detectComposerTrigger,
  });
  const {
    pendingApprovals,
    activePendingApproval,
    pendingUserInputs,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    respondingRequestIds,
    onRespondToApproval,
    onRespondToUserInput: _onRespondToUserInput,
    setActivePendingUserInputQuestionIndex: _setActivePendingUserInputQuestionIndex,
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    updateActivePendingDraftAnswer,
  } = pendingUserInputResult;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threadPlanCatalog],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree,
    isSendBusy,
  } = useLocalDispatchState({
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError: activeThread?.error,
  });
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const nowIso = new Date(nowTick).toISOString();
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
  );
  const isComposerApprovalState = activePendingApproval !== null;
  const hasComposerHeader =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (showPlanFollowUpPrompt && activeProposedPlan !== null);
  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const composerFooterActionLayoutKey = useMemo(() => {
    if (activePendingProgress) {
      return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
    }
    if (phase === "running") {
      return "running";
    }
    if (showPlanFollowUpPrompt) {
      return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
    }
    return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
  }, [
    activePendingIsResponding,
    activePendingProgress,
    composerSendState.hasSendableContent,
    isConnecting,
    isPreparingWorktree,
    isSendBusy,
    phase,
    prompt,
    showPlanFollowUpPrompt,
  ]);
  const {
    attachmentPreviewHandoffByMessageId,
    handoffAttachmentPreviews,
    clearAttachmentPreviewHandoffs: _clearAttachmentPreviewHandoffs,
  } = useAttachmentPreviewHandoff({ optimisticUserMessagesRef });

  const serverMessages = activeThread?.messages;
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(timelineMessages, activeThread?.proposedPlans ?? [], workLogEntries),
    [activeThread?.proposedPlans, timelineMessages, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") {
          break;
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }

    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!completionSummary) return null;
    return deriveCompletionDividerBeforeEntryId(timelineEntries, activeLatestTurn);
  }, [activeLatestTurn, completionSummary, latestTurnSettled, timelineEntries]);
  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusQuery = useQuery(gitStatusQueryOptions(gitCwd));
  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const modelOptionsByProvider = useMemo(
    () => ({
      codex: providerStatuses.find((provider) => provider.provider === "codex")?.models ?? [],
      claudeAgent:
        providerStatuses.find((provider) => provider.provider === "claudeAgent")?.models ?? [],
    }),
    [providerStatuses],
  );
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const currentOptions = modelOptionsByProvider[selectedProvider];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [modelOptionsByProvider, selectedModelForPicker, selectedProvider]);
  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );
  const activeProviderStatus = useMemo(
    () => providerStatuses.find((status) => status.provider === selectedProvider) ?? null,
    [selectedProvider, providerStatuses],
  );
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const nonTerminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: false,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.toggle"),
    [keybindings],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const diffPanelShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "diff.toggle", nonTerminalShortcutLabelOptions),
    [keybindings, nonTerminalShortcutLabelOptions],
  );
  const onToggleDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen ? { ...rest, diff: undefined } : { ...rest, diff: "1" };
      },
    });
  }, [diffOpen, navigate, threadId]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );
  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;

  // --- Extracted hooks ---
  const {
    expandedImage,
    expandedImageItem,
    setExpandedImage,
    closeExpandedImage,
    navigateExpandedImage,
    onExpandTimelineImage,
  } = useImageExpansion();

  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      if (useStore.getState().threads.some((thread) => thread.id === targetThreadId)) {
        setStoreThreadError(targetThreadId, error);
        return;
      }
      setLocalDraftErrorsByThreadId((existing) => {
        if ((existing[targetThreadId] ?? null) === error) {
          return existing;
        }
        return {
          ...existing,
          [targetThreadId]: error,
        };
      });
    },
    [setStoreThreadError],
  );

  const terminalActions = useTerminalActions({
    activeThreadId: activeThreadId ?? undefined,
    terminalState,
    hasReachedSplitLimit,
    storeSetTerminalOpen,
    storeSplitTerminal,
    storeNewTerminal,
    storeCloseTerminal,
  });
  const {
    terminalFocusRequestId,
    setTerminalFocusRequestId,
    setTerminalOpen,
    toggleTerminalVisibility,
    splitTerminal,
    createNewTerminal,
    closeTerminal,
  } = terminalActions;

  const {
    persistProjectScripts: _persistProjectScripts,
    saveProjectScript,
    updateProjectScript,
    deleteProjectScript,
    runProjectScript,
  } = useProjectScripts({
    activeProject,
    activeThread: activeThread
      ? { id: activeThread.id, worktreePath: activeThread.worktreePath ?? null }
      : undefined,
    activeThreadId: activeThreadId ?? undefined,
    gitCwd,
    terminalState,
    setTerminalOpen,
    storeNewTerminal,
    storeSetActiveTerminal,
    setTerminalFocusRequestId,
    setThreadError,
    setLastInvokedScriptByProjectId,
    pendingPullRequestSetupRequest,
    setPendingPullRequestSetupRequest,
  });

  const focusComposer = useCallback(() => {
    composerEditorRef.current?.focusAtEnd();
  }, []);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
      threadId,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
      threadId,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const toggleRuntimeMode = useCallback(() => {
    void handleRuntimeModeChange(
      runtimeMode === "full-access" ? "approval-required" : "full-access",
    );
  }, [handleRuntimeModeChange, runtimeMode]);
  const togglePlanSidebar = useCallback(() => {
    setPlanSidebarOpen((open) => {
      if (open) {
        const turnKey = activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? null;
        if (turnKey) {
          planSidebarDismissedForTurnRef.current = turnKey;
        }
      } else {
        planSidebarDismissedForTurnRef.current = null;
      }
      return !open;
    });
  }, [activePlan?.turnId, sidebarProposedPlan?.turnId]);

  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (!serverThread) {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.provider !== serverThread.modelSelection.provider ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: input.threadId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }
    },
    [serverThread],
  );

  // Auto-scroll on new messages
  const messageCount = timelineMessages.length;
  const {
    showScrollToBottom,
    messagesScrollElement,
    setMessagesScrollContainerRef,
    scrollMessagesToBottom,
    forceStickToBottom,
    scheduleStickToBottom,
    shouldAutoScrollRef,
    onMessagesScroll,
    onMessagesClickCapture,
    onMessagesWheel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesPointerCancel,
    onMessagesTouchStart,
    onMessagesTouchMove,
    onMessagesTouchEnd,
  } = useScrollBehavior({
    activeThreadId: activeThreadId ?? undefined,
    messageCount,
    phase,
    timelineEntries,
  });
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;
    const measureFooterCompactness = () => {
      const composerFormWidth = measureComposerFormWidth();
      const heuristicFooterCompact = shouldUseCompactComposerFooter(composerFormWidth, {
        hasWideActions: composerFooterHasWideActions,
      });
      const footer = composerFooterRef.current;
      const footerStyle = footer ? window.getComputedStyle(footer) : null;
      const footerContentWidth = resolveComposerFooterContentWidth({
        footerWidth: footer?.clientWidth ?? null,
        paddingLeft: footerStyle ? Number.parseFloat(footerStyle.paddingLeft) : null,
        paddingRight: footerStyle ? Number.parseFloat(footerStyle.paddingRight) : null,
      });
      const fitInput = {
        footerContentWidth,
        leadingContentWidth: composerFooterLeadingRef.current?.scrollWidth ?? null,
        actionsWidth: composerFooterActionsRef.current?.scrollWidth ?? null,
      };
      const nextFooterCompact =
        heuristicFooterCompact || shouldForceCompactComposerFooterForFit(fitInput);
      const nextPrimaryActionsCompact =
        nextFooterCompact &&
        shouldUseCompactComposerPrimaryActions(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });

      return {
        primaryActionsCompact: nextPrimaryActionsCompact,
        footerCompact: nextFooterCompact,
      };
    };

    composerFormHeightRef.current = composerForm.getBoundingClientRect().height;
    const initialCompactness = measureFooterCompactness();
    setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
    setIsComposerFooterCompact(initialCompactness.footerCompact);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      const nextCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact((previous) =>
        previous === nextCompactness.primaryActionsCompact
          ? previous
          : nextCompactness.primaryActionsCompact,
      );
      setIsComposerFooterCompact((previous) =>
        previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
      );

      const nextHeight = entry.contentRect.height;
      const previousHeight = composerFormHeightRef.current;
      composerFormHeightRef.current = nextHeight;

      if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
      if (!shouldAutoScrollRef.current) return;
      scheduleStickToBottom();
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
    };
  }, [
    activeThread?.id,
    composerFooterActionLayoutKey,
    composerFooterHasWideActions,
    scheduleStickToBottom,
    shouldAutoScrollRef,
  ]);

  const activeWorktreePath = activeThread?.worktreePath;
  const envMode: DraftThreadEnvMode = activeWorktreePath
    ? "worktree"
    : isLocalDraftThread
      ? (draftThread?.envMode ?? "local")
      : "local";

  useThreadLifecycle({
    threadId,
    activeThreadId,
    serverThread,
    activeThread,
    activeLatestTurnCompletedAt: activeLatestTurn?.completedAt ?? null,
    activeThreadLastVisitedAt,
    latestTurnSettled,
    phase,
    composerImages,
    composerTerminalContexts,
    prompt,
    terminalOpen: terminalState.terminalOpen,
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
  });

  useKeyboardShortcuts({
    activeThreadId,
    activeProjectScripts: activeProject?.scripts,
    terminalState,
    keybindings,
    toggleTerminalVisibility,
    setTerminalOpen,
    splitTerminal,
    createNewTerminal,
    closeTerminal,
    onToggleDiff,
    runProjectScript,
  });

  const {
    onSend,
    onInterrupt,
    onSubmitPlanFollowUp: _onSubmitPlanFollowUp,
    onImplementPlanInNewThread,
    onRevertToTurnCount,
    sendInFlightRef: _sendInFlightRef,
  } = useSendMessage({
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
  });

  const onProviderModelSelect = useCallback(
    (provider: ProviderKind, model: string) => {
      if (!activeThread) return;
      if (lockedProvider !== null && provider !== lockedProvider) {
        scheduleComposerFocus();
        return;
      }
      const resolvedProvider = resolveSelectableProvider(providerStatuses, provider);
      const resolvedModel = resolveAppModelSelection(
        resolvedProvider,
        settings,
        providerStatuses,
        model,
      );
      const nextModelSelection: ModelSelection = {
        provider: resolvedProvider,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(activeThread.id, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const {
    composerMenuItems,
    composerMenuOpen,
    activeComposerMenuItem,
    composerTriggerKind,
    isComposerMenuLoading,
    removeComposerImage,
    onComposerPaste,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    onSelectComposerItem,
    onComposerMenuItemHighlighted,
    onComposerCommandKey,
    onPromptChange,
    addTerminalContextToDraft,
    removeComposerTerminalContextFromDraft,
  } = useComposerEditor({
    threadId,
    activeThread,
    composerCursor,
    composerTerminalContexts,
    composerTrigger,
    composerHighlightedItemId,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
    setIsDragOverComposer,
    composerEditorRef,
    composerImagesRef,
    promptRef,
    gitCwd,
    lockedProvider,
    modelOptionsByProvider,
    activePendingProgress,
    activePendingUserInput,
    pendingUserInputs,
    focusComposer,
    onSend,
    handleInteractionModeChange,
    toggleInteractionMode,
    onProviderModelSelect,
    setThreadError,
    setPrompt,
    addComposerImage,
    addComposerImagesToDraft,
    removeComposerImageFromDraft,
    insertComposerDraftTerminalContext,
    removeComposerDraftTerminalContext,
    setComposerDraftTerminalContexts,
    updateActivePendingDraftAnswer,
    onChangeActivePendingUserInputCustomAnswer,
  });
  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      const currentPrompt = promptRef.current;
      if (nextPrompt === currentPrompt) {
        scheduleComposerFocus();
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [scheduleComposerFocus, setPrompt],
  );
  const providerTraitsMenuContent = renderProviderTraitsMenuContent({
    provider: selectedProvider,
    threadId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedProvider],
    prompt,
    onPromptChange: setPromptFromTraits,
  });
  const providerTraitsPicker = renderProviderTraitsPicker({
    provider: selectedProvider,
    threadId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedProvider],
    prompt,
    onPromptChange: setPromptFromTraits,
  });
  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { envMode: mode });
      }
      scheduleComposerFocus();
    },
    [isLocalDraftThread, scheduleComposerFocus, setDraftThreadContext, threadId],
  );

  const onToggleWorkGroup = useCallback((groupId: string) => {
    setExpandedWorkGroups((existing) => ({
      ...existing,
      [groupId]: !existing[groupId],
    }));
  }, []);
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [navigate, threadId],
  );
  const onRevertUserMessage = (messageId: MessageId) => {
    const targetTurnCount = revertTurnCountByUserMessageId.get(messageId);
    if (typeof targetTurnCount !== "number") {
      return;
    }
    void onRevertToTurnCount(targetTurnCount);
  };

  // Empty state: no active thread
  if (!activeThread) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Threads</span>
            </div>
          </header>
        )}
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs text-muted-foreground/50">No active thread</span>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm">Select a thread or create a new one to get started.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      {/* Top bar */}
      <header
        className={cn(
          "border-b border-border px-3 sm:px-5",
          isElectron ? "drag-region flex h-[52px] items-center" : "py-2 sm:py-3",
        )}
      >
        <ChatHeader
          activeThreadId={activeThread.id}
          activeThreadTitle={activeThread.title}
          activeProjectName={activeProject?.name}
          isGitRepo={isGitRepo}
          openInCwd={gitCwd}
          activeProjectScripts={activeProject?.scripts}
          preferredScriptId={
            activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
          }
          keybindings={keybindings}
          availableEditors={availableEditors}
          terminalAvailable={activeProject !== undefined}
          terminalOpen={terminalState.terminalOpen}
          terminalToggleShortcutLabel={terminalToggleShortcutLabel}
          diffToggleShortcutLabel={diffPanelShortcutLabel}
          gitCwd={gitCwd}
          diffOpen={diffOpen}
          onRunProjectScript={(script) => {
            void runProjectScript(script);
          }}
          onAddProjectScript={saveProjectScript}
          onUpdateProjectScript={updateProjectScript}
          onDeleteProjectScript={deleteProjectScript}
          onToggleTerminal={toggleTerminalVisibility}
          onToggleDiff={onToggleDiff}
        />
      </header>

      {/* Error banner */}
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      {/* Main content area with optional plan sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Chat column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Messages Wrapper */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Messages */}
            <div
              ref={setMessagesScrollContainerRef}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-5 sm:py-4"
              onScroll={onMessagesScroll}
              onClickCapture={onMessagesClickCapture}
              onWheel={onMessagesWheel}
              onPointerDown={onMessagesPointerDown}
              onPointerUp={onMessagesPointerUp}
              onPointerCancel={onMessagesPointerCancel}
              onTouchStart={onMessagesTouchStart}
              onTouchMove={onMessagesTouchMove}
              onTouchEnd={onMessagesTouchEnd}
              onTouchCancel={onMessagesTouchEnd}
            >
              <ComponentErrorBoundary
                context="MessagesTimeline"
                fallback={(error, reset) => (
                  <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
                    <CircleAlertIcon className="size-6 text-destructive" />
                    <p className="text-sm">Failed to render messages</p>
                    <p className="max-w-md text-xs">{error.message}</p>
                    <Button size="sm" variant="outline" onClick={reset}>
                      Retry
                    </Button>
                  </div>
                )}
              >
                <MessagesTimeline
                  key={activeThread.id}
                  hasMessages={timelineEntries.length > 0}
                  isWorking={isWorking}
                  activeTurnInProgress={isWorking || !latestTurnSettled}
                  activeTurnStartedAt={activeWorkStartedAt}
                  scrollContainer={messagesScrollElement}
                  timelineEntries={timelineEntries}
                  completionDividerBeforeEntryId={completionDividerBeforeEntryId}
                  completionSummary={completionSummary}
                  turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                  nowIso={nowIso}
                  expandedWorkGroups={expandedWorkGroups}
                  onToggleWorkGroup={onToggleWorkGroup}
                  onOpenTurnDiff={onOpenTurnDiff}
                  revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                  onRevertUserMessage={onRevertUserMessage}
                  isRevertingCheckpoint={isRevertingCheckpoint}
                  onImageExpand={onExpandTimelineImage}
                  markdownCwd={gitCwd ?? undefined}
                  resolvedTheme={resolvedTheme}
                  timestampFormat={timestampFormat}
                  workspaceRoot={activeProject?.cwd ?? undefined}
                />
              </ComponentErrorBoundary>
            </div>

            {/* scroll to bottom pill — shown when user has scrolled away from the bottom */}
            {showScrollToBottom && (
              <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                <button
                  type="button"
                  onClick={() => scrollMessagesToBottom("smooth")}
                  className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
                >
                  <ChevronDownIcon className="size-3.5" />
                  Scroll to bottom
                </button>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className={cn("px-3 pt-1.5 sm:px-5 sm:pt-2", isGitRepo ? "pb-1" : "pb-3 sm:pb-4")}>
            <form
              ref={composerFormRef}
              onSubmit={onSend}
              className="mx-auto w-full min-w-0 max-w-[52rem]"
              data-chat-composer-form="true"
            >
              <div
                className={cn(
                  "group rounded-[22px] p-px transition-colors duration-200",
                  composerProviderState.composerFrameClassName,
                )}
                onDragEnter={onComposerDragEnter}
                onDragOver={onComposerDragOver}
                onDragLeave={onComposerDragLeave}
                onDrop={onComposerDrop}
              >
                <div
                  className={cn(
                    "rounded-[20px] border bg-card transition-colors duration-200 has-focus-visible:border-ring/45",
                    isDragOverComposer ? "border-primary/70 bg-accent/30" : "border-border",
                    composerProviderState.composerSurfaceClassName,
                  )}
                >
                  {activePendingApproval ? (
                    <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                      <ComposerPendingApprovalPanel
                        approval={activePendingApproval}
                        pendingCount={pendingApprovals.length}
                      />
                    </div>
                  ) : pendingUserInputs.length > 0 ? (
                    <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                      <ComposerPendingUserInputPanel
                        pendingUserInputs={pendingUserInputs}
                        respondingRequestIds={respondingRequestIds}
                        answers={activePendingDraftAnswers}
                        questionIndex={activePendingQuestionIndex}
                        onSelectOption={onSelectActivePendingUserInputOption}
                        onAdvance={onAdvanceActivePendingUserInput}
                      />
                    </div>
                  ) : showPlanFollowUpPrompt && activeProposedPlan ? (
                    <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                      <ComposerPlanFollowUpBanner
                        key={activeProposedPlan.id}
                        planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                      />
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "relative px-3 pb-2 sm:px-4",
                      hasComposerHeader ? "pt-2.5 sm:pt-3" : "pt-3.5 sm:pt-4",
                    )}
                  >
                    {composerMenuOpen && !isComposerApprovalState && (
                      <div className="absolute inset-x-0 bottom-full z-20 mb-2 px-1">
                        <ComposerCommandMenu
                          items={composerMenuItems}
                          resolvedTheme={resolvedTheme}
                          isLoading={isComposerMenuLoading}
                          triggerKind={composerTriggerKind}
                          activeItemId={activeComposerMenuItem?.id ?? null}
                          onHighlightedItemChange={onComposerMenuItemHighlighted}
                          onSelect={onSelectComposerItem}
                        />
                      </div>
                    )}

                    {!isComposerApprovalState &&
                      pendingUserInputs.length === 0 &&
                      composerImages.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {composerImages.map((image) => (
                            <div
                              key={image.id}
                              className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                            >
                              {image.previewUrl ? (
                                <button
                                  type="button"
                                  className="h-full w-full cursor-zoom-in"
                                  aria-label={`Preview ${image.name}`}
                                  onClick={() => {
                                    const preview = buildExpandedImagePreview(
                                      composerImages,
                                      image.id,
                                    );
                                    if (!preview) return;
                                    setExpandedImage(preview);
                                  }}
                                >
                                  <img
                                    src={image.previewUrl}
                                    alt={image.name}
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ) : (
                                <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground/70">
                                  {image.name}
                                </div>
                              )}
                              {nonPersistedComposerImageIdSet.has(image.id) && (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span
                                        role="img"
                                        aria-label="Draft attachment may not persist"
                                        className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                      >
                                        <CircleAlertIcon className="size-3" />
                                      </span>
                                    }
                                  />
                                  <TooltipPopup
                                    side="top"
                                    className="max-w-64 whitespace-normal leading-tight"
                                  >
                                    Draft attachment could not be saved locally and may be lost on
                                    navigation.
                                  </TooltipPopup>
                                </Tooltip>
                              )}
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                                onClick={() => removeComposerImage(image.id)}
                                aria-label={`Remove ${image.name}`}
                              >
                                <XIcon />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    <ComposerPromptEditor
                      ref={composerEditorRef}
                      value={
                        isComposerApprovalState
                          ? ""
                          : activePendingProgress
                            ? activePendingProgress.customAnswer
                            : prompt
                      }
                      cursor={composerCursor}
                      terminalContexts={
                        !isComposerApprovalState && pendingUserInputs.length === 0
                          ? composerTerminalContexts
                          : []
                      }
                      onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                      onChange={onPromptChange}
                      onCommandKeyDown={onComposerCommandKey}
                      onPaste={onComposerPaste}
                      placeholder={
                        isComposerApprovalState
                          ? (activePendingApproval?.detail ??
                            "Resolve this approval request to continue")
                          : activePendingProgress
                            ? "Type your own answer, or leave this blank to use the selected option"
                            : showPlanFollowUpPrompt && activeProposedPlan
                              ? "Add feedback to refine the plan, or leave this blank to implement it"
                              : phase === "disconnected"
                                ? "Ask for follow-up changes or attach images"
                                : "Ask anything, @tag files/folders, or use / to show available commands"
                      }
                      disabled={isConnecting || isComposerApprovalState}
                    />
                  </div>

                  {/* Bottom toolbar */}
                  {activePendingApproval ? (
                    <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
                      <ComposerPendingApprovalActions
                        requestId={activePendingApproval.requestId}
                        isResponding={respondingRequestIds.includes(
                          activePendingApproval.requestId,
                        )}
                        onRespondToApproval={onRespondToApproval}
                      />
                    </div>
                  ) : (
                    <div
                      ref={composerFooterRef}
                      data-chat-composer-footer="true"
                      data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
                      className={cn(
                        "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-hidden px-2.5 pb-2.5 sm:px-3 sm:pb-3",
                        isComposerFooterCompact ? "gap-1.5" : "gap-2 sm:gap-0",
                      )}
                    >
                      <div
                        ref={composerFooterLeadingRef}
                        className={cn(
                          "flex min-w-0 flex-1 items-center",
                          isComposerFooterCompact
                            ? "gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                            : "gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible",
                        )}
                      >
                        {/* Provider/model picker */}
                        <ProviderModelPicker
                          compact={isComposerFooterCompact}
                          provider={selectedProvider}
                          model={selectedModelForPickerWithCustomFallback}
                          lockedProvider={lockedProvider}
                          providers={providerStatuses}
                          modelOptionsByProvider={modelOptionsByProvider}
                          {...(composerProviderState.modelPickerIconClassName
                            ? {
                                activeProviderIconClassName:
                                  composerProviderState.modelPickerIconClassName,
                              }
                            : {})}
                          onProviderModelChange={onProviderModelSelect}
                        />

                        {isComposerFooterCompact ? (
                          <CompactComposerControlsMenu
                            activePlan={Boolean(
                              activePlan || sidebarProposedPlan || planSidebarOpen,
                            )}
                            interactionMode={interactionMode}
                            planSidebarOpen={planSidebarOpen}
                            runtimeMode={runtimeMode}
                            traitsMenuContent={providerTraitsMenuContent}
                            onToggleInteractionMode={toggleInteractionMode}
                            onTogglePlanSidebar={togglePlanSidebar}
                            onToggleRuntimeMode={toggleRuntimeMode}
                          />
                        ) : (
                          <>
                            {providerTraitsPicker ? (
                              <>
                                <Separator
                                  orientation="vertical"
                                  className="mx-0.5 hidden h-4 sm:block"
                                />
                                {providerTraitsPicker}
                              </>
                            ) : null}

                            <Separator
                              orientation="vertical"
                              className="mx-0.5 hidden h-4 sm:block"
                            />

                            <Button
                              variant="ghost"
                              className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                              size="sm"
                              type="button"
                              onClick={toggleInteractionMode}
                              title={
                                interactionMode === "plan"
                                  ? "Plan mode — click to return to normal chat mode"
                                  : "Default mode — click to enter plan mode"
                              }
                            >
                              <BotIcon />
                              <span className="sr-only sm:not-sr-only">
                                {interactionMode === "plan" ? "Plan" : "Chat"}
                              </span>
                            </Button>

                            <Separator
                              orientation="vertical"
                              className="mx-0.5 hidden h-4 sm:block"
                            />

                            <Button
                              variant="ghost"
                              className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                              size="sm"
                              type="button"
                              onClick={() =>
                                void handleRuntimeModeChange(
                                  runtimeMode === "full-access"
                                    ? "approval-required"
                                    : "full-access",
                                )
                              }
                              title={
                                runtimeMode === "full-access"
                                  ? "Full access — click to require approvals"
                                  : "Approval required — click for full access"
                              }
                            >
                              {runtimeMode === "full-access" ? <LockOpenIcon /> : <LockIcon />}
                              <span className="sr-only sm:not-sr-only">
                                {runtimeMode === "full-access" ? "Full access" : "Supervised"}
                              </span>
                            </Button>

                            {activePlan || sidebarProposedPlan || planSidebarOpen ? (
                              <>
                                <Separator
                                  orientation="vertical"
                                  className="mx-0.5 hidden h-4 sm:block"
                                />
                                <Button
                                  variant="ghost"
                                  className={cn(
                                    "shrink-0 whitespace-nowrap px-2 sm:px-3",
                                    planSidebarOpen
                                      ? "text-blue-400 hover:text-blue-300"
                                      : "text-muted-foreground/70 hover:text-foreground/80",
                                  )}
                                  size="sm"
                                  type="button"
                                  onClick={togglePlanSidebar}
                                  title={
                                    planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"
                                  }
                                >
                                  <ListTodoIcon />
                                  <span className="sr-only sm:not-sr-only">Plan</span>
                                </Button>
                              </>
                            ) : null}
                          </>
                        )}
                      </div>

                      {/* Right side: send / stop button */}
                      <div
                        ref={composerFooterActionsRef}
                        data-chat-composer-actions="right"
                        data-chat-composer-primary-actions-compact={
                          isComposerPrimaryActionsCompact ? "true" : "false"
                        }
                        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                      >
                        {activeContextWindow ? (
                          <ContextWindowMeter usage={activeContextWindow} />
                        ) : null}
                        {isPreparingWorktree ? (
                          <span className="text-muted-foreground/70 text-xs">
                            Preparing worktree...
                          </span>
                        ) : null}
                        <ComposerPrimaryActions
                          compact={isComposerPrimaryActionsCompact}
                          pendingAction={
                            activePendingProgress
                              ? {
                                  questionIndex: activePendingProgress.questionIndex,
                                  isLastQuestion: activePendingProgress.isLastQuestion,
                                  canAdvance: activePendingProgress.canAdvance,
                                  isResponding: activePendingIsResponding,
                                  isComplete: Boolean(activePendingResolvedAnswers),
                                }
                              : null
                          }
                          isRunning={phase === "running"}
                          showPlanFollowUpPrompt={
                            pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                          }
                          promptHasText={prompt.trim().length > 0}
                          isSendBusy={isSendBusy}
                          isConnecting={isConnecting}
                          isPreparingWorktree={isPreparingWorktree}
                          hasSendableContent={composerSendState.hasSendableContent}
                          onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                          onInterrupt={() => void onInterrupt()}
                          onImplementPlanInNewThread={() => void onImplementPlanInNewThread()}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>

          {isGitRepo && (
            <BranchToolbar
              threadId={activeThread.id}
              onEnvModeChange={onEnvModeChange}
              envLocked={envLocked}
              onComposerFocusRequest={scheduleComposerFocus}
              {...(canCheckoutPullRequestIntoThread
                ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                : {})}
            />
          )}
          {pullRequestDialogState ? (
            <PullRequestThreadDialog
              key={pullRequestDialogState.key}
              open
              cwd={activeProject?.cwd ?? null}
              initialReference={pullRequestDialogState.initialReference}
              onOpenChange={(open) => {
                if (!open) {
                  closePullRequestDialog();
                }
              }}
              onPrepared={handlePreparedPullRequestThread}
            />
          ) : null}
        </div>
        {/* end chat column */}

        {/* Plan sidebar */}
        {planSidebarOpen ? (
          <PlanSidebar
            activePlan={activePlan}
            activeProposedPlan={sidebarProposedPlan}
            markdownCwd={gitCwd ?? undefined}
            workspaceRoot={activeProject?.cwd ?? undefined}
            timestampFormat={timestampFormat}
            onClose={() => {
              setPlanSidebarOpen(false);
              // Track that the user explicitly dismissed for this turn so auto-open won't fight them.
              const turnKey = activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? null;
              if (turnKey) {
                planSidebarDismissedForTurnRef.current = turnKey;
              }
            }}
          />
        ) : null}
      </div>
      {/* end horizontal flex container */}

      {mountedTerminalThreadIds.map((mountedThreadId) => (
        <PersistentThreadTerminalDrawer
          key={mountedThreadId}
          threadId={mountedThreadId}
          visible={mountedThreadId === activeThreadId && terminalState.terminalOpen}
          focusRequestId={mountedThreadId === activeThreadId ? terminalFocusRequestId : 0}
          splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
          newShortcutLabel={newTerminalShortcutLabel ?? undefined}
          closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
          onAddTerminalContext={addTerminalContextToDraft}
        />
      ))}

      {expandedImage && expandedImageItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image preview"
        >
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-zoom-out"
            aria-label="Close image preview"
            onClick={closeExpandedImage}
          />
          {expandedImage.images.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
              aria-label="Previous image"
              onClick={() => {
                navigateExpandedImage(-1);
              }}
            >
              <ChevronLeftIcon className="size-5" />
            </Button>
          )}
          <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="absolute right-2 top-2"
              onClick={closeExpandedImage}
              aria-label="Close image preview"
            >
              <XIcon />
            </Button>
            <img
              src={expandedImageItem.src}
              alt={expandedImageItem.name}
              className="max-h-[86vh] max-w-[92vw] select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
              draggable={false}
            />
            <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
              {expandedImageItem.name}
              {expandedImage.images.length > 1
                ? ` (${expandedImage.index + 1}/${expandedImage.images.length})`
                : ""}
            </p>
          </div>
          {expandedImage.images.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
              aria-label="Next image"
              onClick={() => {
                navigateExpandedImage(1);
              }}
            >
              <ChevronRightIcon className="size-5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
