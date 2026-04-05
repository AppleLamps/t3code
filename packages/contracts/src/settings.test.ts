import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { CodexSettings, ClaudeSettings, DEFAULT_SERVER_SETTINGS } from "./settings";

describe("CodexSettings", () => {
  it("uses 'codex' as the default binaryPath", () => {
    const result = Schema.decodeSync(CodexSettings)({});
    expect(result.binaryPath).toBe("codex");
  });

  it("preserves a non-empty binaryPath", () => {
    const result = Schema.decodeSync(CodexSettings)({ binaryPath: "/usr/local/bin/codex" });
    expect(result.binaryPath).toBe("/usr/local/bin/codex");
  });

  it("falls back to 'codex' for empty string binaryPath", () => {
    const result = Schema.decodeSync(CodexSettings)({ binaryPath: "" });
    expect(result.binaryPath).toBe("codex");
  });

  it("trims whitespace from binaryPath", () => {
    const result = Schema.decodeSync(CodexSettings)({ binaryPath: "  /usr/bin/codex  " });
    expect(result.binaryPath).toBe("/usr/bin/codex");
  });

  it("falls back to 'codex' for whitespace-only binaryPath", () => {
    const result = Schema.decodeSync(CodexSettings)({ binaryPath: "   " });
    expect(result.binaryPath).toBe("codex");
  });
});

describe("ClaudeSettings", () => {
  it("uses 'claude' as the default binaryPath", () => {
    const result = Schema.decodeSync(ClaudeSettings)({});
    expect(result.binaryPath).toBe("claude");
  });

  it("preserves a non-empty binaryPath", () => {
    const result = Schema.decodeSync(ClaudeSettings)({ binaryPath: "/opt/claude" });
    expect(result.binaryPath).toBe("/opt/claude");
  });

  it("falls back to 'claude' for empty string binaryPath", () => {
    const result = Schema.decodeSync(ClaudeSettings)({ binaryPath: "" });
    expect(result.binaryPath).toBe("claude");
  });
});

describe("DEFAULT_SERVER_SETTINGS", () => {
  it("has expected provider binary path defaults", () => {
    expect(DEFAULT_SERVER_SETTINGS.providers.codex.binaryPath).toBe("codex");
    expect(DEFAULT_SERVER_SETTINGS.providers.claudeAgent.binaryPath).toBe("claude");
  });
});
