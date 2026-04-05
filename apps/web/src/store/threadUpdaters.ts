import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "../session-logic";
import { type ChatMessage, type SidebarThreadSummary, type Thread } from "../types";
import { type AppState, EMPTY_THREAD_IDS, updateThread } from "./appState";

// ── Sidebar derived state ────────────────────────────────────────────

function getLatestUserMessageAt(
  messages: ReadonlyArray<Thread["messages"][number]>,
): string | null {
  let latestUserMessageAt: string | null = null;

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    if (latestUserMessageAt === null || message.createdAt > latestUserMessageAt) {
      latestUserMessageAt = message.createdAt;
    }
  }

  return latestUserMessageAt;
}

export function buildSidebarThreadSummary(thread: Thread): SidebarThreadSummary {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: thread.session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestUserMessageAt: getLatestUserMessageAt(thread.messages),
    hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
    hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
    hasActionableProposedPlan: hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    ),
  };
}

export function sidebarThreadSummariesEqual(
  left: SidebarThreadSummary | undefined,
  right: SidebarThreadSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.interactionMode === right.interactionMode &&
    left.session === right.session &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    left.latestTurn === right.latestTurn &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan
  );
}

export function buildSidebarThreadsById(
  threads: ReadonlyArray<Thread>,
): Record<string, SidebarThreadSummary> {
  return Object.fromEntries(
    threads.map((thread) => [thread.id, buildSidebarThreadSummary(thread)]),
  );
}

// ── Thread-by-project index ──────────────────────────────────────────

export function appendThreadIdByProjectId(
  threadIdsByProjectId: Record<string, ThreadId[]>,
  projectId: ProjectId,
  threadId: ThreadId,
): Record<string, ThreadId[]> {
  const existingThreadIds = threadIdsByProjectId[projectId] ?? EMPTY_THREAD_IDS;
  if (existingThreadIds.includes(threadId)) {
    return threadIdsByProjectId;
  }
  return {
    ...threadIdsByProjectId,
    [projectId]: [...existingThreadIds, threadId],
  };
}

export function removeThreadIdByProjectId(
  threadIdsByProjectId: Record<string, ThreadId[]>,
  projectId: ProjectId,
  threadId: ThreadId,
): Record<string, ThreadId[]> {
  const existingThreadIds = threadIdsByProjectId[projectId] ?? EMPTY_THREAD_IDS;
  if (!existingThreadIds.includes(threadId)) {
    return threadIdsByProjectId;
  }
  const nextThreadIds = existingThreadIds.filter(
    (existingThreadId) => existingThreadId !== threadId,
  );
  if (nextThreadIds.length === existingThreadIds.length) {
    return threadIdsByProjectId;
  }
  if (nextThreadIds.length === 0) {
    const nextThreadIdsByProjectId = { ...threadIdsByProjectId };
    delete nextThreadIdsByProjectId[projectId];
    return nextThreadIdsByProjectId;
  }
  return {
    ...threadIdsByProjectId,
    [projectId]: nextThreadIds,
  };
}

export function buildThreadIdsByProjectId(
  threads: ReadonlyArray<Thread>,
): Record<string, ThreadId[]> {
  const threadIdsByProjectId: Record<string, ThreadId[]> = {};
  for (const thread of threads) {
    const existingThreadIds = threadIdsByProjectId[thread.projectId] ?? EMPTY_THREAD_IDS;
    threadIdsByProjectId[thread.projectId] = [...existingThreadIds, thread.id];
  }
  return threadIdsByProjectId;
}

// ── Thread state update with sidebar sync ────────────────────────────

export function updateThreadState(
  state: AppState,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): AppState {
  let updatedThread: Thread | null = null;
  const threads = updateThread(state.threads, threadId, (thread) => {
    const nextThread = updater(thread);
    if (nextThread !== thread) {
      updatedThread = nextThread;
    }
    return nextThread;
  });
  if (threads === state.threads || updatedThread === null) {
    return state;
  }

  const nextSummary = buildSidebarThreadSummary(updatedThread);
  const previousSummary = state.sidebarThreadsById[threadId];
  const sidebarThreadsById = sidebarThreadSummariesEqual(previousSummary, nextSummary)
    ? state.sidebarThreadsById
    : {
        ...state.sidebarThreadsById,
        [threadId]: nextSummary,
      };

  if (sidebarThreadsById === state.sidebarThreadsById) {
    return {
      ...state,
      threads,
    };
  }

  return {
    ...state,
    threads,
    sidebarThreadsById,
  };
}

// ── Turn / checkpoint helpers ────────────────────────────────────────

export function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") {
    return "error" as const;
  }
  if (status === "missing") {
    return "interrupted" as const;
  }
  return "completed" as const;
}

export function compareActivities(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Thread["pendingSourceProposedPlan"];
}): NonNullable<Thread["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

export function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<Thread["turnDiffSummaries"][number]>,
  turnId: Thread["turnDiffSummaries"][number]["turnId"],
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"],
): Thread["turnDiffSummaries"] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

// ── Revert helpers ───────────────────────────────────────────────────

export function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

export function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<Thread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): Thread["activities"] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

export function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<Thread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): Thread["proposedPlans"] {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}
