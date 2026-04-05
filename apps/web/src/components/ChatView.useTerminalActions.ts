import type { ThreadId } from "@t3tools/contracts";
import { useCallback, useState } from "react";
import { randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { performTerminalClose } from "./PersistentThreadTerminalDrawer";
import type { selectThreadTerminalState } from "../terminalStateStore";

export interface TerminalActionsResult {
  terminalFocusRequestId: number;
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminalVisibility: () => void;
  splitTerminal: () => void;
  createNewTerminal: () => void;
  closeTerminal: (terminalId: string) => void;
}

export function useTerminalActions(input: {
  activeThreadId: ThreadId | undefined;
  terminalState: ReturnType<typeof selectThreadTerminalState>;
  hasReachedSplitLimit: boolean;
  storeSetTerminalOpen: (threadId: ThreadId, open: boolean) => void;
  storeSplitTerminal: (threadId: ThreadId, terminalId: string) => void;
  storeNewTerminal: (threadId: ThreadId, terminalId: string) => void;
  storeCloseTerminal: (threadId: ThreadId, terminalId: string) => void;
}): TerminalActionsResult {
  const {
    activeThreadId,
    terminalState,
    hasReachedSplitLimit,
    storeSetTerminalOpen,
    storeSplitTerminal,
    storeNewTerminal,
    storeCloseTerminal,
  } = input;
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);

  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadId) return;
      storeSetTerminalOpen(activeThreadId, open);
    },
    [activeThreadId, storeSetTerminalOpen],
  );

  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadId) return;
    setTerminalOpen(!terminalState.terminalOpen);
  }, [activeThreadId, setTerminalOpen, terminalState.terminalOpen]);

  const splitTerminal = useCallback(() => {
    if (!activeThreadId || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(activeThreadId, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadId, hasReachedSplitLimit, storeSplitTerminal]);

  const createNewTerminal = useCallback(() => {
    if (!activeThreadId) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(activeThreadId, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  }, [activeThreadId, storeNewTerminal]);

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readNativeApi();
      if (!activeThreadId || !api) return;
      performTerminalClose(api, activeThreadId, terminalId, terminalState.terminalIds.length <= 1);
      storeCloseTerminal(activeThreadId, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeThreadId, storeCloseTerminal, terminalState.terminalIds.length],
  );

  return {
    terminalFocusRequestId,
    setTerminalFocusRequestId,
    setTerminalOpen,
    toggleTerminalVisibility,
    splitTerminal,
    createNewTerminal,
    closeTerminal,
  };
}
