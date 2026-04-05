import type {
  KeybindingCommand,
  ProjectId,
  ProjectScript,
  TerminalOpenInput,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect } from "react";
import { isElectron } from "../env";
import { readNativeApi } from "~/nativeApi";
import { newCommandId, randomUUID } from "~/lib/utils";
import { toastManager } from "./ui/toast";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import type { NewProjectScriptInput } from "./ProjectScriptsControl";
import {
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptRuntimeEnv,
} from "~/projectScripts";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";
import type { selectThreadTerminalState } from "../terminalStateStore";

const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

export interface ProjectScriptsResult {
  persistProjectScripts: (input: {
    projectId: ProjectId;
    projectCwd: string;
    previousScripts: ProjectScript[];
    nextScripts: ProjectScript[];
    keybinding?: string | null;
    keybindingCommand: KeybindingCommand;
  }) => Promise<void>;
  saveProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  updateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  deleteProjectScript: (scriptId: string) => Promise<void>;
  runProjectScript: (
    script: ProjectScript,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      worktreePath?: string | null;
      preferNewTerminal?: boolean;
      rememberAsLastInvoked?: boolean;
    },
  ) => Promise<void>;
}

export function useProjectScripts(input: {
  activeProject: { id: ProjectId; cwd: string; scripts: ProjectScript[] } | undefined;
  activeThread: { id: ThreadId; worktreePath: string | null } | undefined;
  activeThreadId: ThreadId | undefined;
  gitCwd: string | null;
  terminalState: ReturnType<typeof selectThreadTerminalState>;
  setTerminalOpen: (open: boolean) => void;
  storeNewTerminal: (threadId: ThreadId, terminalId: string) => void;
  storeSetActiveTerminal: (threadId: ThreadId, terminalId: string) => void;
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  setLastInvokedScriptByProjectId: (
    updater: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  pendingPullRequestSetupRequest: PendingPullRequestSetupRequest | null;
  setPendingPullRequestSetupRequest: (request: PendingPullRequestSetupRequest | null) => void;
}): ProjectScriptsResult {
  const {
    activeProject,
    activeThread,
    activeThreadId,
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
  } = input;
  const persistProjectScripts = useCallback(
    async (persistInput: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ProjectScript[];
      nextScripts: ProjectScript[];
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand;
    }) => {
      const api = readNativeApi();
      if (!api) return;

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: persistInput.projectId,
        scripts: persistInput.nextScripts,
      });

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: persistInput.keybinding,
        command: persistInput.keybindingCommand,
      });

      if (isElectron && keybindingRule) {
        await api.server.upsertKeybinding(keybindingRule);
      }
    },
    [],
  );

  const saveProjectScript = useCallback(
    async (saveInput: NewProjectScriptInput) => {
      if (!activeProject) return;
      const nextId = nextProjectScriptId(
        saveInput.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: saveInput.name,
        command: saveInput.command,
        icon: saveInput.icon,
        runOnWorktreeCreate: saveInput.runOnWorktreeCreate,
      };
      const nextScripts = saveInput.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: saveInput.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, persistProjectScripts],
  );

  const updateProjectScript = useCallback(
    async (scriptId: string, updateInput: NewProjectScriptInput) => {
      if (!activeProject) return;
      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: updateInput.name,
        command: updateInput.command,
        icon: updateInput.icon,
        runOnWorktreeCreate: updateInput.runOnWorktreeCreate,
      };
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : updateInput.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: updateInput.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, persistProjectScripts],
  );

  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!activeProject) return;
      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProject.scripts.find((s) => s.id === scriptId)?.name;

      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          projectCwd: activeProject.cwd,
          previousScripts: activeProject.scripts,
          nextScripts,
          keybinding: null,
          keybindingCommand: commandForProjectScript(scriptId),
        });
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [activeProject, persistProjectScripts],
  );

  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      const api = readNativeApi();
      if (!api || !activeThreadId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject!.id] === script.id) return current;
          return { ...current, [activeProject!.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : baseTerminalId;

      setTerminalOpen(true);
      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeThreadId, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeThreadId, targetTerminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: options?.worktreePath ?? activeThread.worktreePath ?? null,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const openTerminalInput: TerminalOpenInput = shouldCreateNewTerminal
        ? {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            env: runtimeEnv,
          };

      try {
        await api.terminal.open(openTerminalInput);
        await api.terminal.write({
          threadId: activeThreadId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        });
      } catch (error) {
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      gitCwd,
      setTerminalOpen,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
      setTerminalFocusRequestId,
    ],
  );

  // Execute pending PR setup script
  useEffect(() => {
    if (!pendingPullRequestSetupRequest || !activeProject || !activeThreadId || !activeThread) {
      return;
    }
    if (pendingPullRequestSetupRequest.threadId !== activeThreadId) {
      return;
    }
    if (activeThread.worktreePath !== pendingPullRequestSetupRequest.worktreePath) {
      return;
    }

    const prSetupScript =
      activeProject.scripts.find(
        (script) => script.id === pendingPullRequestSetupRequest!.scriptId,
      ) ?? null;
    setPendingPullRequestSetupRequest(null);
    if (!prSetupScript) {
      return;
    }

    void runProjectScript(prSetupScript, {
      cwd: pendingPullRequestSetupRequest.worktreePath,
      worktreePath: pendingPullRequestSetupRequest.worktreePath,
      rememberAsLastInvoked: false,
    }).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to run setup script.",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [
    activeProject,
    activeThread,
    activeThreadId,
    pendingPullRequestSetupRequest,
    setPendingPullRequestSetupRequest,
    runProjectScript,
  ]);

  return {
    persistProjectScripts,
    saveProjectScript,
    updateProjectScript,
    deleteProjectScript,
    runProjectScript,
  };
}

export interface PendingPullRequestSetupRequest {
  threadId: ThreadId;
  worktreePath: string;
  scriptId: string;
}
