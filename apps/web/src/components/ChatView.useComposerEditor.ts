import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProjectEntry,
  type ProviderInteractionMode,
  type ProviderKind,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { randomUUID } from "~/lib/utils";
import {
  type ComposerTrigger,
  type ComposerTriggerKind,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "../composer-logic";
import {
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import type { Thread } from "../types";
import type { ComposerImageAttachment } from "../composerDraftStore";
import { basenameOfPath } from "../vscode-icons";
import { toastManager } from "./ui/toast";
import { type ComposerCommandItem } from "./chat/ComposerCommandMenu";
import { AVAILABLE_PROVIDER_OPTIONS } from "./chat/ProviderModelPicker";
import type { ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import type { PendingUserInputProgress } from "../pendingUserInput";
import type { PendingUserInput } from "../session-logic";

const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];

export interface ComposerEditorInput {
  // Thread context
  threadId: ThreadId;
  activeThread: Thread | undefined;

  // Current values from draft store / state
  composerCursor: number;
  composerTerminalContexts: TerminalContextDraft[];
  composerTrigger: ComposerTrigger | null;

  // State (owned by ChatView)
  composerHighlightedItemId: string | null;

  // State setters (owned by ChatView)
  setComposerCursor: (cursor: number) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  setComposerHighlightedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsDragOverComposer: (value: boolean) => void;

  // Shared refs (owned by ChatView)
  composerEditorRef: React.RefObject<ComposerPromptEditorHandle | null>;
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>;
  promptRef: React.MutableRefObject<string>;

  // For composerMenuItems
  gitCwd: string | null;
  lockedProvider: ProviderKind | null;
  modelOptionsByProvider: {
    codex: ReadonlyArray<ServerProvider["models"][number]>;
    claudeAgent: ReadonlyArray<ServerProvider["models"][number]>;
  };

  // For pending user input
  activePendingProgress: PendingUserInputProgress | null;
  activePendingUserInput: PendingUserInput | null;
  pendingUserInputs: PendingUserInput[];

  // External callbacks
  focusComposer: () => void;
  onSend: (e?: { preventDefault: () => void }) => Promise<void>;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  toggleInteractionMode: () => void;
  onProviderModelSelect: (provider: ProviderKind, model: string) => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;

  // Draft store setters
  setPrompt: (prompt: string) => void;
  addComposerImage: (image: ComposerImageAttachment) => void;
  addComposerImagesToDraft: (images: ComposerImageAttachment[]) => void;
  removeComposerImageFromDraft: (imageId: string) => void;
  insertComposerDraftTerminalContext: (
    threadId: ThreadId,
    prompt: string,
    context: TerminalContextDraft,
    index: number,
  ) => boolean;
  removeComposerDraftTerminalContext: (threadId: ThreadId, contextId: string) => void;
  setComposerDraftTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void;

  // For applyPromptReplacement / onPromptChange
  updateActivePendingDraftAnswer: (questionId: string, answerText: string) => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;
}

export interface ComposerEditorResult {
  // Menu state
  composerMenuItems: ComposerCommandItem[];
  composerMenuOpen: boolean;
  activeComposerMenuItem: ComposerCommandItem | null;
  composerTriggerKind: ComposerTriggerKind | null;
  isComposerMenuLoading: boolean;

  // Callbacks
  removeComposerImage: (imageId: string) => void;
  onComposerPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  onComposerDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  onComposerDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onComposerDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onComposerDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onSelectComposerItem: (item: ComposerCommandItem) => void;
  onComposerMenuItemHighlighted: (itemId: string | null) => void;
  onComposerCommandKey: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => boolean;
  onPromptChange: (
    nextPrompt: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
  ) => void;
  addTerminalContextToDraft: (selection: TerminalContextSelection) => void;
  removeComposerTerminalContextFromDraft: (contextId: string) => void;
}

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

export function useComposerEditor(input: ComposerEditorInput): ComposerEditorResult {
  const {
    threadId,
    activeThread,
    composerCursor,
    composerTerminalContexts,
    composerTrigger,
    setComposerCursor,
    setComposerTrigger,
    composerHighlightedItemId,
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
  } = input;

  const activeThreadId = activeThread?.id ?? null;

  // --- Internal refs ---
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const dragDepthRef = useRef(0);

  // Reset drag depth on thread change (owned by this hook, but thread cleanup is in ChatView)
  useEffect(() => {
    dragDepthRef.current = 0;
  }, [threadId]);

  // --- Derived trigger values ---
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
    pathTriggerQuery,
    { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";

  // --- Searchable model options ---
  const searchableModelOptions = useMemo(
    () =>
      AVAILABLE_PROVIDER_OPTIONS.filter(
        (option) => lockedProvider === null || option.value === lockedProvider,
      ).flatMap((option) =>
        modelOptionsByProvider[option.value].map(({ slug, name }) => ({
          provider: option.value,
          providerLabel: option.label,
          slug,
          name,
          searchSlug: slug.toLowerCase(),
          searchName: name.toLowerCase(),
          searchProvider: option.label.toLowerCase(),
        })),
      ),
    [lockedProvider, modelOptionsByProvider],
  );

  // --- Workspace entries query ---
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: gitCwd,
      query: effectivePathQuery,
      enabled: isPathTrigger,
      limit: 80,
    }),
  );
  const workspaceEntries = workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;

  // --- Composer menu items ---
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return workspaceEntries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path",
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.parentPath ?? "",
      }));
    }

    if (composerTrigger.kind === "slash-command") {
      const slashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        {
          id: "slash:plan",
          type: "slash-command",
          command: "plan",
          label: "/plan",
          description: "Switch this thread into plan mode",
        },
        {
          id: "slash:default",
          type: "slash-command",
          command: "default",
          label: "/default",
          description: "Switch this thread back to normal chat mode",
        },
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const query = composerTrigger.query.trim().toLowerCase();
      if (!query) {
        return [...slashCommandItems];
      }
      return slashCommandItems.filter(
        (item) => item.command.includes(query) || item.label.slice(1).includes(query),
      );
    }

    return searchableModelOptions
      .filter(({ searchSlug, searchName, searchProvider }) => {
        const query = composerTrigger.query.trim().toLowerCase();
        if (!query) return true;
        return (
          searchSlug.includes(query) || searchName.includes(query) || searchProvider.includes(query)
        );
      })
      .map(({ provider, providerLabel, slug, name }) => ({
        id: `model:${provider}:${slug}`,
        type: "model",
        provider,
        model: slug,
        label: name,
        description: `${providerLabel} · ${slug}`,
      }));
  }, [composerTrigger, searchableModelOptions, workspaceEntries]);

  const composerMenuOpen = Boolean(composerTrigger);
  const activeComposerMenuItem = useMemo(
    () =>
      composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
      composerMenuItems[0] ??
      null,
    [composerHighlightedItemId, composerMenuItems],
  );

  // --- Ref syncs ---
  composerMenuOpenRef.current = composerMenuOpen;
  composerMenuItemsRef.current = composerMenuItems;
  activeComposerMenuItemRef.current = activeComposerMenuItem;

  // --- Focus management ---
  // focusComposer is received as input since it's shared with other callbacks in ChatView.

  // --- Terminal context callbacks ---
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      if (!activeThread) {
        return;
      }
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor,
      );
      const nextCollapsedCursor = collapseExpandedComposerCursor(
        insertion.prompt,
        insertion.cursor,
      );
      const inserted = insertComposerDraftTerminalContext(
        activeThread.id,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex,
      );
      if (!inserted) {
        return;
      }
      promptRef.current = insertion.prompt;
      setComposerCursor(nextCollapsedCursor);
      setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCollapsedCursor);
      });
    },
    [
      activeThread,
      composerCursor,
      composerEditorRef,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
    ],
  );

  const removeComposerTerminalContextFromDraft = useCallback(
    (contextId: string) => {
      const contextIndex = composerTerminalContexts.findIndex(
        (context) => context.id === contextId,
      );
      if (contextIndex < 0) {
        return;
      }
      const nextPrompt = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
      promptRef.current = nextPrompt.prompt;
      setPrompt(nextPrompt.prompt);
      removeComposerDraftTerminalContext(threadId, contextId);
      setComposerCursor(nextPrompt.cursor);
      setComposerTrigger(
        detectComposerTrigger(
          nextPrompt.prompt,
          expandCollapsedComposerCursor(nextPrompt.prompt, nextPrompt.cursor),
        ),
      );
    },
    [
      composerTerminalContexts,
      promptRef,
      removeComposerDraftTerminalContext,
      setComposerCursor,
      setComposerTrigger,
      setPrompt,
      threadId,
    ],
  );

  // --- Image handling ---
  const addComposerImages = (files: File[]) => {
    if (!activeThreadId || files.length === 0) return;

    if (pendingUserInputs.length > 0) {
      toastManager.add({
        type: "error",
        title: "Attach images after answering plan questions.",
      });
      return;
    }

    const nextImages: ComposerImageAttachment[] = [];
    let nextImageCount = composerImagesRef.current.length;
    let error: string | null = null;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        error = `Unsupported file type for '${file.name}'. Please attach image files only.`;
        continue;
      }
      if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`;
        continue;
      }
      if (nextImageCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
        error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`;
        break;
      }

      const previewUrl = URL.createObjectURL(file);
      nextImages.push({
        type: "image",
        id: randomUUID(),
        name: file.name || "image",
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl,
        file,
      });
      nextImageCount += 1;
    }

    if (nextImages.length === 1 && nextImages[0]) {
      addComposerImage(nextImages[0]);
    } else if (nextImages.length > 1) {
      addComposerImagesToDraft(nextImages);
    }
    setThreadError(activeThreadId, error);
  };

  const removeComposerImage = (imageId: string) => {
    removeComposerImageFromDraft(imageId);
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    addComposerImages(imageFiles);
  };

  // --- Drag/drop handlers ---
  const onComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverComposer(true);
  };

  const onComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOverComposer(true);
  };

  const onComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOverComposer(false);
    }
  };

  const onComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOverComposer(false);
    const files = Array.from(event.dataTransfer.files);
    addComposerImages(files);
    focusComposer();
  };

  // --- Text editing ---
  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: { expectedText?: string },
    ): boolean => {
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        options?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== options.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInput) {
        updateActivePendingDraftAnswer(activePendingQuestion.id, next.text);
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectComposerTrigger(next.text, expandCollapsedComposerCursor(next.text, nextCursor)),
      );
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
      return true;
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      composerEditorRef,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      setPrompt,
      updateActivePendingDraftAnswer,
    ],
  );

  const readComposerSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
    };
  }, [composerCursor, composerEditorRef, composerTerminalContexts, promptRef]);

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  // --- Menu interaction ---
  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        const replacement = `@${item.path} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "model") {
          const replacement = "/model ";
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      onProviderModelSelect(item.provider, item.model);
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
    },
    [
      applyPromptReplacement,
      handleInteractionModeChange,
      onProviderModelSelect,
      resolveActiveComposerTrigger,
      setComposerHighlightedItemId,
    ],
  );

  const onComposerMenuItemHighlighted = useCallback(
    (itemId: string | null) => {
      setComposerHighlightedItemId(itemId);
    },
    [setComposerHighlightedItemId],
  );

  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) {
        return;
      }
      const highlightedIndex = composerMenuItems.findIndex(
        (item) => item.id === composerHighlightedItemId,
      );
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      const nextItem = composerMenuItems[nextIndex];
      setComposerHighlightedItemId(nextItem?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems, setComposerHighlightedItemId],
  );

  const isComposerMenuLoading =
    composerTriggerKind === "path" &&
    ((pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
      workspaceEntriesQuery.isLoading ||
      workspaceEntriesQuery.isFetching);

  // --- Prompt change ---
  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[],
    ) => {
      if (activePendingProgress?.activeQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
        setComposerDraftTerminalContexts(
          threadId,
          syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
        );
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      composerTerminalContexts,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setComposerCursor,
      setComposerDraftTerminalContexts,
      setComposerTrigger,
      setPrompt,
      threadId,
    ],
  );

  // --- Keyboard command dispatch ---
  const onComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (key === "Tab" && event.shiftKey) {
      toggleInteractionMode();
      return true;
    }

    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = composerMenuOpenRef.current || trigger !== null;

    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current;
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if (key === "Tab" || key === "Enter") {
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
    }

    if (key === "Enter" && !event.shiftKey) {
      void onSend();
      return true;
    }
    return false;
  };

  // --- Effects ---
  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      return;
    }
    setComposerHighlightedItemId((existing) =>
      existing && composerMenuItems.some((item) => item.id === existing)
        ? existing
        : (composerMenuItems[0]?.id ?? null),
    );
  }, [composerMenuItems, composerMenuOpen, setComposerHighlightedItemId]);

  return {
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
  };
}
