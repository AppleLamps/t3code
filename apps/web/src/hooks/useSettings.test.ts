import {
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverApiMock, toastAddMock } = vi.hoisted(() => ({
  serverApiMock: {
    getConfig: vi.fn(),
    updateSettings: vi.fn(),
  },
  toastAddMock: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({ server: serverApiMock }),
}));

vi.mock("~/components/ui/toast", () => ({
  toastManager: {
    add: toastAddMock,
  },
}));

import {
  buildLegacyClientSettingsMigrationPatch,
  migrateLocalSettingsToServer,
  persistServerSettingsPatch,
} from "./useSettings";
import {
  getServerConfig,
  resetServerStateForTests,
  setServerConfigSnapshot,
} from "~/rpc/serverState";

const defaultProviders: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
  },
];

const baseServerConfig: ServerConfig = {
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/.config/keybindings.json",
  keybindings: [],
  issues: [],
  providers: defaultProviders,
  availableEditors: ["cursor"],
  observability: {
    logsDirectoryPath: "/tmp/workspace/.config/logs",
    localTracingEnabled: true,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};

const OLD_SETTINGS_KEY = "t3code:app-settings:v1";
const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";

function createStorage(initialEntries: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initialEntries));

  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetServerStateForTests();
  serverApiMock.getConfig.mockResolvedValue(baseServerConfig);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetServerStateForTests();
});

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });
});

describe("persistServerSettingsPatch", () => {
  it("rolls back optimistic server settings when the RPC update fails", async () => {
    setServerConfigSnapshot(baseServerConfig);
    serverApiMock.updateSettings.mockRejectedValueOnce(new Error("boom"));

    await expect(
      persistServerSettingsPatch({ enableAssistantStreaming: true }, serverApiMock),
    ).resolves.toBe(false);

    expect(getServerConfig()?.settings.enableAssistantStreaming).toBe(
      DEFAULT_SERVER_SETTINGS.enableAssistantStreaming,
    );
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Failed to save settings",
        description: "boom",
      }),
    );
    expect(serverApiMock.getConfig).toHaveBeenCalledOnce();
  });
});

describe("migrateLocalSettingsToServer", () => {
  it("removes the legacy key only after a successful migration", async () => {
    const storage = createStorage({
      [OLD_SETTINGS_KEY]: JSON.stringify({
        enableAssistantStreaming: true,
        diffWordWrap: false,
      }),
      [CLIENT_SETTINGS_STORAGE_KEY]: JSON.stringify({
        confirmThreadArchive: false,
      }),
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { localStorage: storage });
    serverApiMock.updateSettings.mockResolvedValueOnce({
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    });

    await migrateLocalSettingsToServer();

    expect(serverApiMock.updateSettings).toHaveBeenCalledWith({
      enableAssistantStreaming: true,
    });
    expect(storage.getItem(OLD_SETTINGS_KEY)).toBeNull();
    expect(storage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({
        confirmThreadArchive: false,
        diffWordWrap: false,
      }),
    );
  });

  it("preserves the legacy key when migration fails", async () => {
    const storage = createStorage({
      [OLD_SETTINGS_KEY]: JSON.stringify({
        enableAssistantStreaming: true,
      }),
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { localStorage: storage });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    serverApiMock.updateSettings.mockRejectedValueOnce(new Error("network down"));

    await migrateLocalSettingsToServer();

    expect(storage.getItem(OLD_SETTINGS_KEY)).not.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
