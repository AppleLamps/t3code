import type { ProjectScript, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { projectScriptIdFromCommand } from "~/projectScripts";
import type { selectThreadTerminalState } from "../terminalStateStore";
import type { useServerKeybindings } from "~/rpc/serverState";

export function useKeyboardShortcuts(input: {
  activeThreadId: ThreadId | null;
  activeProjectScripts: ProjectScript[] | undefined;
  terminalState: ReturnType<typeof selectThreadTerminalState>;
  keybindings: ReturnType<typeof useServerKeybindings>;
  toggleTerminalVisibility: () => void;
  setTerminalOpen: (open: boolean) => void;
  splitTerminal: () => void;
  createNewTerminal: () => void;
  closeTerminal: (terminalId: string) => void;
  onToggleDiff: () => void;
  runProjectScript: (script: ProjectScript) => void;
}): void {
  const {
    activeThreadId,
    activeProjectScripts,
    terminalState,
    keybindings,
    toggleTerminalVisibility,
    setTerminalOpen,
    splitTerminal,
    createNewTerminal,
    closeTerminal,
    onToggleDiff,
    runProjectScript,
  } = input;

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || event.defaultPrevented) return;
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProjectScripts) return;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      runProjectScript(script);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeProjectScripts,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    activeThreadId,
    closeTerminal,
    createNewTerminal,
    setTerminalOpen,
    runProjectScript,
    splitTerminal,
    keybindings,
    onToggleDiff,
    toggleTerminalVisibility,
  ]);
}
