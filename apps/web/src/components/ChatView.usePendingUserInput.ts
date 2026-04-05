import type {
  ApprovalRequestId,
  OrchestrationThreadActivity,
  ProviderApprovalDecision,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposerTrigger } from "../composer-logic";
import { collapseExpandedComposerCursor, expandCollapsedComposerCursor } from "../composer-logic";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
  type PendingUserInputProgress,
} from "../pendingUserInput";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  type PendingApproval,
  type PendingUserInput,
} from "../session-logic";
import { readNativeApi } from "~/nativeApi";
import { newCommandId } from "~/lib/utils";

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

export interface PendingUserInputResult {
  pendingApprovals: PendingApproval[];
  activePendingApproval: PendingApproval | null;
  pendingUserInputs: PendingUserInput[];
  activePendingUserInput: PendingUserInput | null;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  activePendingProgress: PendingUserInputProgress | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  respondingRequestIds: ApprovalRequestId[];
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  onRespondToUserInput: (
    requestId: ApprovalRequestId,
    answers: Record<string, unknown>,
  ) => Promise<void>;
  setActivePendingUserInputQuestionIndex: (nextQuestionIndex: number) => void;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;
  onAdvanceActivePendingUserInput: () => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  updateActivePendingDraftAnswer: (questionId: string, answerText: string) => void;
}

export function usePendingUserInput(input: {
  threadActivities: ReadonlyArray<OrchestrationThreadActivity>;
  activeThreadId: ThreadId | undefined;
  setStoreThreadError: (threadId: ThreadId, error: string | null) => void;
  promptRef: React.RefObject<string>;
  setComposerCursor: (cursor: number) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  detectComposerTrigger: (prompt: string, cursor: number) => ComposerTrigger | null;
}): PendingUserInputResult {
  const {
    threadActivities,
    activeThreadId,
    setStoreThreadError,
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    detectComposerTrigger: detectTrigger,
  } = input;
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});

  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities],
  );

  const activePendingApproval = pendingApprovals[0] ?? null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;

  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );

  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;

  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );

  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );

  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readNativeApi();
      if (!api || !activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId!,
            err instanceof Error ? err.message : "Failed to submit approval decision.",
          );
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, setStoreThreadError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readNativeApi();
      if (!api || !activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId!,
            err instanceof Error ? err.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, setStoreThreadError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: {
            selectedOptionLabel: optionLabel,
            customAnswer: "",
          },
        },
      }));
      promptRef.current = "";
      setComposerCursor(0);
      setComposerTrigger(null);
    },
    [activePendingUserInput, promptRef, setComposerCursor, setComposerTrigger],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      setComposerCursor(nextCursor);
      setComposerTrigger(cursorAdjacentToMention ? null : detectTrigger(value, expandedCursor));
    },
    [activePendingUserInput, promptRef, setComposerCursor, setComposerTrigger, detectTrigger],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const updateActivePendingDraftAnswer = useCallback(
    (questionId: string, answerText: string) => {
      if (!activePendingUserInput) return;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            answerText,
          ),
        },
      }));
    },
    [activePendingUserInput],
  );

  // Sync pending user input custom answer to composer
  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);
  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      lastSyncedPendingInputRef.current = null;
      return;
    }
    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      detectTrigger(nextCustomAnswer, expandCollapsedComposerCursor(nextCustomAnswer, nextCursor)),
    );
  }, [
    activePendingProgress?.customAnswer,
    activePendingUserInput?.requestId,
    activePendingProgress?.activeQuestion?.id,
    promptRef,
    setComposerCursor,
    setComposerTrigger,
    detectTrigger,
  ]);

  return {
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
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    updateActivePendingDraftAnswer,
  };
}
