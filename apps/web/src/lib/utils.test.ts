import { assert, describe, it, vi } from "vitest";

import { isWindowsPlatform, warnIgnoredError } from "./utils";

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("warnIgnoredError", () => {
  it("returns a function that logs and returns undefined", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = warnIgnoredError("test context");
    const result = handler(new Error("boom"));
    assert.isUndefined(result);
    assert.isTrue(spy.mock.calls.length > 0);
    assert.include(spy.mock.calls[0]![0], "test context");
    spy.mockRestore();
  });

  it("passes extra context to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = warnIgnoredError("op", { id: "123" });
    handler("some error");
    assert.deepEqual(spy.mock.calls[0]![2], { id: "123" });
    spy.mockRestore();
  });
});
