import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  WsRpcGroup,
  WsServerGetConfigRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsGitStatusRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WS_METHODS,
} from "./rpc";

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

describe("WsRpcGroup", () => {
  it("contains all 34 declared RPC definitions", () => {
    expect(WsRpcGroup.requests.size).toBe(34);
  });

  it("has unique method names across all RPCs", () => {
    const methodValues = Object.values(WS_METHODS);
    const uniqueMethods = new Set(methodValues);
    expect(uniqueMethods.size).toBe(methodValues.length);
  });
});

describe("Server RPC payloads", () => {
  it("serverGetConfig accepts empty payload", () => {
    expect(decodes(WsServerGetConfigRpc.payloadSchema, {})).toBe(true);
  });

  it("serverGetSettings accepts empty payload", () => {
    expect(decodes(WsServerGetSettingsRpc.payloadSchema, {})).toBe(true);
  });

  it("serverUpdateSettings accepts a settings patch", () => {
    expect(
      decodes(WsServerUpdateSettingsRpc.payloadSchema, {
        patch: { enableAssistantStreaming: true },
      }),
    ).toBe(true);
  });

  it("serverUpdateSettings accepts empty patch", () => {
    expect(decodes(WsServerUpdateSettingsRpc.payloadSchema, { patch: {} })).toBe(true);
  });

  it("serverRefreshProviders accepts empty payload", () => {
    expect(decodes(WsServerRefreshProvidersRpc.payloadSchema, {})).toBe(true);
  });

  it("serverUpsertKeybinding accepts valid static command", () => {
    expect(
      decodes(WsServerUpsertKeybindingRpc.payloadSchema, {
        key: "ctrl+shift+t",
        command: "terminal.toggle",
      }),
    ).toBe(true);
  });

  it("serverUpsertKeybinding accepts valid script command", () => {
    expect(
      decodes(WsServerUpsertKeybindingRpc.payloadSchema, {
        key: "ctrl+shift+r",
        command: "script.my-script.run",
      }),
    ).toBe(true);
  });

  it("serverUpsertKeybinding rejects invalid command", () => {
    expect(
      decodes(WsServerUpsertKeybindingRpc.payloadSchema, {
        key: "ctrl+shift+t",
        command: "not.a.valid.command",
      }),
    ).toBe(false);
  });
});

describe("Project RPC payloads", () => {
  it("projectsSearchEntries accepts valid search input", () => {
    expect(
      decodes(WsProjectsSearchEntriesRpc.payloadSchema, {
        cwd: "/project",
        query: "main.ts",
        limit: 50,
      }),
    ).toBe(true);
  });

  it("projectsSearchEntries rejects missing limit", () => {
    expect(
      decodes(WsProjectsSearchEntriesRpc.payloadSchema, {
        cwd: "/project",
        query: "main.ts",
      }),
    ).toBe(false);
  });

  it("projectsWriteFile accepts valid write input", () => {
    expect(
      decodes(WsProjectsWriteFileRpc.payloadSchema, {
        cwd: "/project",
        relativePath: "src/index.ts",
        contents: "export default {};",
      }),
    ).toBe(true);
  });
});

describe("Shell RPC payloads", () => {
  it("shellOpenInEditor accepts valid input", () => {
    expect(
      decodes(WsShellOpenInEditorRpc.payloadSchema, {
        cwd: "/project",
        editor: "cursor",
      }),
    ).toBe(true);
  });

  it("shellOpenInEditor rejects invalid editor", () => {
    expect(
      decodes(WsShellOpenInEditorRpc.payloadSchema, {
        cwd: "/project",
        editor: "not-an-editor",
      }),
    ).toBe(false);
  });
});

describe("Git RPC payloads", () => {
  it("gitStatus accepts valid cwd", () => {
    expect(
      decodes(WsGitStatusRpc.payloadSchema, {
        cwd: "/project",
      }),
    ).toBe(true);
  });

  it("gitPull accepts valid pull input", () => {
    expect(
      decodes(WsGitPullRpc.payloadSchema, {
        cwd: "/project",
      }),
    ).toBe(true);
  });

  it("gitRunStackedAction accepts valid input", () => {
    expect(
      decodes(WsGitRunStackedActionRpc.payloadSchema, {
        actionId: "action-1",
        cwd: "/project",
        action: "create_pr",
      }),
    ).toBe(true);
  });

  it("gitResolvePullRequest accepts valid input", () => {
    expect(
      decodes(WsGitResolvePullRequestRpc.payloadSchema, {
        cwd: "/project",
        reference: "#42",
      }),
    ).toBe(true);
  });

  it("gitPreparePullRequestThread accepts valid input", () => {
    expect(
      decodes(WsGitPreparePullRequestThreadRpc.payloadSchema, {
        cwd: "/project",
        reference: "#42",
        mode: "worktree",
      }),
    ).toBe(true);
  });

  it("gitListBranches accepts valid input", () => {
    expect(
      decodes(WsGitListBranchesRpc.payloadSchema, {
        cwd: "/project",
      }),
    ).toBe(true);
  });

  it("gitCreateWorktree accepts valid input", () => {
    expect(
      decodes(WsGitCreateWorktreeRpc.payloadSchema, {
        cwd: "/project",
        branch: "feature/test",
        path: "/tmp/worktree",
      }),
    ).toBe(true);
  });

  it("gitRemoveWorktree accepts valid input", () => {
    expect(
      decodes(WsGitRemoveWorktreeRpc.payloadSchema, {
        cwd: "/project",
        path: "/tmp/worktree",
      }),
    ).toBe(true);
  });

  it("gitCreateBranch accepts valid input", () => {
    expect(
      decodes(WsGitCreateBranchRpc.payloadSchema, {
        cwd: "/project",
        branch: "feature/new",
      }),
    ).toBe(true);
  });

  it("gitCheckout accepts valid input", () => {
    expect(
      decodes(WsGitCheckoutRpc.payloadSchema, {
        cwd: "/project",
        branch: "main",
      }),
    ).toBe(true);
  });

  it("gitInit accepts valid input", () => {
    expect(
      decodes(WsGitInitRpc.payloadSchema, {
        cwd: "/project",
      }),
    ).toBe(true);
  });
});

describe("Orchestration RPC payloads", () => {
  it("getSnapshot accepts empty input", () => {
    expect(decodes(WsOrchestrationGetSnapshotRpc.payloadSchema, {})).toBe(true);
  });

  it("dispatchCommand accepts turn start command", () => {
    expect(
      decodes(WsOrchestrationDispatchCommandRpc.payloadSchema, {
        type: "thread.turn.start",
        commandId: "cmd-1",
        threadId: "thread-1",
        message: {
          messageId: "msg-1",
          role: "user",
          text: "Hello world",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("dispatchCommand accepts interrupt command", () => {
    expect(
      decodes(WsOrchestrationDispatchCommandRpc.payloadSchema, {
        type: "thread.turn.interrupt",
        commandId: "cmd-2",
        threadId: "thread-1",
        createdAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("dispatchCommand accepts approval response", () => {
    expect(
      decodes(WsOrchestrationDispatchCommandRpc.payloadSchema, {
        type: "thread.approval.respond",
        commandId: "cmd-3",
        threadId: "thread-1",
        requestId: "req-1",
        decision: "accept",
        createdAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("getTurnDiff accepts valid input", () => {
    expect(
      decodes(WsOrchestrationGetTurnDiffRpc.payloadSchema, {
        threadId: "thread-1",
        fromTurnCount: 0,
        toTurnCount: 1,
      }),
    ).toBe(true);
  });

  it("getTurnDiff rejects fromTurnCount > toTurnCount", () => {
    expect(
      decodes(WsOrchestrationGetTurnDiffRpc.payloadSchema, {
        threadId: "thread-1",
        fromTurnCount: 5,
        toTurnCount: 2,
      }),
    ).toBe(false);
  });

  it("getFullThreadDiff accepts valid input", () => {
    expect(
      decodes(WsOrchestrationGetFullThreadDiffRpc.payloadSchema, {
        threadId: "thread-1",
        toTurnCount: 3,
      }),
    ).toBe(true);
  });

  it("replayEvents accepts valid input", () => {
    expect(
      decodes(WsOrchestrationReplayEventsRpc.payloadSchema, {
        fromSequenceExclusive: 0,
      }),
    ).toBe(true);
  });
});

describe("Terminal RPC payloads", () => {
  it("terminalOpen accepts valid input", () => {
    expect(
      decodes(WsTerminalOpenRpc.payloadSchema, {
        threadId: "thread-1",
        cwd: "/project",
      }),
    ).toBe(true);
  });

  it("terminalWrite accepts valid input", () => {
    expect(
      decodes(WsTerminalWriteRpc.payloadSchema, {
        threadId: "thread-1",
        data: "ls -la\n",
      }),
    ).toBe(true);
  });

  it("terminalResize accepts valid input", () => {
    expect(
      decodes(WsTerminalResizeRpc.payloadSchema, {
        threadId: "thread-1",
        cols: 80,
        rows: 24,
      }),
    ).toBe(true);
  });

  it("terminalClear accepts valid input", () => {
    expect(
      decodes(WsTerminalClearRpc.payloadSchema, {
        threadId: "thread-1",
      }),
    ).toBe(true);
  });

  it("terminalRestart accepts valid input", () => {
    expect(
      decodes(WsTerminalRestartRpc.payloadSchema, {
        threadId: "thread-1",
        cwd: "/project",
        cols: 80,
        rows: 24,
      }),
    ).toBe(true);
  });

  it("terminalClose accepts valid input", () => {
    expect(
      decodes(WsTerminalCloseRpc.payloadSchema, {
        threadId: "thread-1",
      }),
    ).toBe(true);
  });
});

describe("Subscription RPC payloads", () => {
  it("subscribeOrchestrationDomainEvents accepts empty payload", () => {
    expect(decodes(WsSubscribeOrchestrationDomainEventsRpc.payloadSchema, {})).toBe(true);
  });

  it("subscribeTerminalEvents accepts empty payload", () => {
    expect(decodes(WsSubscribeTerminalEventsRpc.payloadSchema, {})).toBe(true);
  });

  it("subscribeServerConfig accepts empty payload", () => {
    expect(decodes(WsSubscribeServerConfigRpc.payloadSchema, {})).toBe(true);
  });

  it("subscribeServerLifecycle accepts empty payload", () => {
    expect(decodes(WsSubscribeServerLifecycleRpc.payloadSchema, {})).toBe(true);
  });
});
