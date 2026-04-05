import type { NativeApi, ThreadId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import { randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { projectScriptCwd, projectScriptRuntimeEnv } from "~/projectScripts";
import { useComposerDraftStore } from "../composerDraftStore";
import type { TerminalContextSelection } from "../lib/terminalContext";
import { useProjectById, useThreadById } from "../storeSelectors";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { ComponentErrorBoundary } from "./ui/error-boundary";

/**
 * Perform the terminal close API sequence: clear if final terminal, then close
 * with history deletion. Falls back to writing "exit\n" if close is unavailable.
 */
export function performTerminalClose(
  api: NativeApi,
  threadId: string,
  terminalId: string,
  isFinalTerminal: boolean,
): void {
  const fallbackExitWrite = () =>
    api.terminal.write({ threadId, terminalId, data: "exit\n" }).catch(() => undefined);

  if ("close" in api.terminal && typeof api.terminal.close === "function") {
    void (async () => {
      if (isFinalTerminal) {
        await api.terminal.clear({ threadId, terminalId }).catch(() => undefined);
      }
      await api.terminal.close({ threadId, terminalId, deleteHistory: true });
    })().catch(() => fallbackExitWrite());
  } else {
    void fallbackExitWrite();
  }
}

interface PersistentThreadTerminalDrawerProps {
  threadId: ThreadId;
  visible: boolean;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

export default function PersistentThreadTerminalDrawer({
  threadId,
  visible,
  focusRequestId,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  onAddTerminalContext,
}: PersistentThreadTerminalDrawerProps) {
  const serverThread = useThreadById(threadId);
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const project = useProjectById(serverThread?.projectId ?? draftThread?.projectId);
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const storeSetTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const cwd = useMemo(
    () =>
      project
        ? projectScriptCwd({
            project: { cwd: project.cwd },
            worktreePath,
          })
        : null,
    [project, worktreePath],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.cwd },
            worktreePath,
          })
        : {},
    [project, worktreePath],
  );

  const bumpFocusRequestId = useCallback(() => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  }, [visible]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(threadId, height);
    },
    [storeSetTerminalHeight, threadId],
  );

  const splitTerminal = useCallback(() => {
    storeSplitTerminal(threadId, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeSplitTerminal, threadId]);

  const createNewTerminal = useCallback(() => {
    storeNewTerminal(threadId, `terminal-${randomUUID()}`);
    bumpFocusRequestId();
  }, [bumpFocusRequestId, storeNewTerminal, threadId]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(threadId, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, threadId],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readNativeApi();
      if (!api) return;
      performTerminalClose(api, threadId, terminalId, terminalState.terminalIds.length <= 1);
      storeCloseTerminal(threadId, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeCloseTerminal, terminalState.terminalIds.length, threadId],
  );

  const handleAddTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!visible) {
        return;
      }
      onAddTerminalContext(selection);
    },
    [onAddTerminalContext, visible],
  );

  if (!project || !terminalState.terminalOpen || !cwd) {
    return null;
  }

  return (
    <div className={visible ? undefined : "hidden"}>
      <ComponentErrorBoundary
        context="ThreadTerminalDrawer"
        fallback={
          <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
            Terminal failed to render. Try reopening the terminal.
          </div>
        }
      >
        <ThreadTerminalDrawer
          threadId={threadId}
          cwd={cwd}
          runtimeEnv={runtimeEnv}
          visible={visible}
          height={terminalState.terminalHeight}
          terminalIds={terminalState.terminalIds}
          activeTerminalId={terminalState.activeTerminalId}
          terminalGroups={terminalState.terminalGroups}
          activeTerminalGroupId={terminalState.activeTerminalGroupId}
          focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
          onSplitTerminal={splitTerminal}
          onNewTerminal={createNewTerminal}
          splitShortcutLabel={visible ? splitShortcutLabel : undefined}
          newShortcutLabel={visible ? newShortcutLabel : undefined}
          closeShortcutLabel={visible ? closeShortcutLabel : undefined}
          onActiveTerminalChange={activateTerminal}
          onCloseTerminal={closeTerminal}
          onHeightChange={setTerminalHeight}
          onAddTerminalContext={handleAddTerminalContext}
        />
      </ComponentErrorBoundary>
    </div>
  );
}
