import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("useTheme", () => {
  it("does not crash during module initialization when reading localStorage fails", async () => {
    const classList = {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn(() => false),
    };
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      desktopBridge: undefined,
      localStorage,
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList,
        offsetHeight: 0,
      },
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      }),
    );

    await expect(import("./useTheme")).resolves.toBeDefined();

    expect(classList.toggle).toHaveBeenCalledWith("dark", false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[THEME] Unable to read stored theme preference.",
      "SecurityError",
    );
  });
});
