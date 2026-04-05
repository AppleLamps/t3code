import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const FilesystemListDirectoryInput = Schema.Struct({
  /** Absolute path to list. If empty, lists the user's home directory. */
  path: Schema.String,
});
export type FilesystemListDirectoryInput = typeof FilesystemListDirectoryInput.Type;

export const FilesystemDirectoryEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  isDirectory: Schema.Boolean,
});
export type FilesystemDirectoryEntry = typeof FilesystemDirectoryEntry.Type;

export const FilesystemListDirectoryResult = Schema.Struct({
  entries: Schema.Array(FilesystemDirectoryEntry),
  /** The absolute path that was listed (resolved from input). Empty string for the drives view on Windows. */
  currentPath: Schema.String,
  /** Parent directory path, or null if at a root. */
  parentPath: Schema.NullOr(Schema.String),
});
export type FilesystemListDirectoryResult = typeof FilesystemListDirectoryResult.Type;

export class FilesystemListDirectoryError extends Schema.TaggedErrorClass<FilesystemListDirectoryError>()(
  "FilesystemListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
