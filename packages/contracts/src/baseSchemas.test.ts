import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { IsoDateTime } from "./baseSchemas";

const decode = Schema.decodeUnknownSync(IsoDateTime);

describe("IsoDateTime", () => {
  it("accepts standard toISOString() output", () => {
    expect(decode("2026-04-05T12:34:56.789Z")).toBe("2026-04-05T12:34:56.789Z");
  });

  it("accepts datetime without milliseconds", () => {
    expect(decode("2026-04-05T12:34:56Z")).toBe("2026-04-05T12:34:56Z");
  });

  it("accepts datetime with timezone offset", () => {
    expect(decode("2026-04-05T12:34:56.789+05:30")).toBe("2026-04-05T12:34:56.789+05:30");
    expect(decode("2026-04-05T12:34:56-08:00")).toBe("2026-04-05T12:34:56-08:00");
  });

  it("accepts sub-millisecond precision", () => {
    expect(decode("2026-04-05T12:34:56.1234567Z")).toBe("2026-04-05T12:34:56.1234567Z");
  });

  it("rejects plain date without time", () => {
    expect(() => decode("2026-04-05")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => decode("")).toThrow();
  });

  it("rejects arbitrary text", () => {
    expect(() => decode("not a date")).toThrow();
  });

  it("rejects date without timezone", () => {
    expect(() => decode("2026-04-05T12:34:56")).toThrow();
  });

  it("rejects non-string values", () => {
    expect(() => decode(12345)).toThrow();
    expect(() => decode(null)).toThrow();
  });
});
