import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  ArrowUpIcon,
  HardDriveIcon,
  HomeIcon,
  LoaderIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { getWsRpcClient } from "~/wsRpcClient";
import type { FilesystemDirectoryEntry } from "@t3tools/contracts";

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

export function FolderPickerDialog({ open, onOpenChange, onSelect }: FolderPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<readonly FilesystemDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const rpcClient = getWsRpcClient();
      const result = await rpcClient.filesystem.listDirectory({ path });
      setEntries(result.entries);
      setCurrentPath(result.currentPath);
      setParentPath(result.parentPath);
      setPathInput(result.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadDirectory("");
    }
  }, [open, loadDirectory]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [currentPath]);

  const handleNavigate = (path: string) => {
    void loadDirectory(path);
  };

  const handleGoUp = () => {
    if (parentPath !== null) {
      void loadDirectory(parentPath);
    }
  };

  const handleGoHome = () => {
    void loadDirectory("");
  };

  const handlePathInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void loadDirectory(pathInput);
    }
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onOpenChange(false);
  };

  const directories = entries.filter((e) => e.isDirectory);
  const isDrivesView = currentPath === "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Select a folder</DialogTitle>
          <DialogDescription>Browse to select a project folder.</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              onClick={handleGoHome}
              disabled={loading}
              aria-label="Go to home directory"
            >
              <HomeIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              onClick={handleGoUp}
              disabled={loading || parentPath === null}
              aria-label="Go to parent directory"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={handlePathInputKeyDown}
              placeholder="/path/to/directory"
            />
          </div>
        </div>

        <div
          ref={scrollRef}
          className="mx-6 mb-3 max-h-72 min-h-48 overflow-y-auto rounded-md border border-border bg-secondary/50"
        >
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
              <span className="ml-2 text-xs">Loading...</span>
            </div>
          )}

          {error && <div className="px-3 py-8 text-center text-xs text-red-400">{error}</div>}

          {!loading && !error && directories.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground/60">
              No subdirectories
            </div>
          )}

          {!loading &&
            !error &&
            directories.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                onDoubleClick={() => handleNavigate(entry.path)}
                onClick={() => handleNavigate(entry.path)}
              >
                {isDrivesView ? (
                  <HardDriveIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{entry.name}</span>
                <ChevronRightIcon className="ml-auto size-3 shrink-0 text-muted-foreground/40" />
              </button>
            ))}
        </div>

        {!loading && !error && (
          <div className="mx-6 mb-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
            <FolderOpenIcon className="size-3.5 shrink-0 text-primary" />
            <span className="truncate font-mono text-xs text-foreground">
              {isDrivesView ? "Select a drive" : currentPath}
            </span>
          </div>
        )}

        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={loading || !!error || isDrivesView}>
            Select Folder
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
