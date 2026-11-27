import { describe, it, expect } from "vitest";
import {
  containsUrl,
  isDailyLimitExceeded,
  isKillSwitchActive,
  isMessageTooShort,
  isWithinBlackoutHours,
  minutesInTimeZone,
  parseTimeToMinutes,
} from "./hardSafety";

/** A Date that reads `hhmm` on a Nairobi wall clock (UTC+3, no DST). */
const nairobi = (hhmm: string) => new Date(`2026-11-27T${hhmm}:00+03:00`);
const TZ = "Africa/Nairobi";

describe("parseTimeToMinutes", () => {
  it.each([
    ["00:00", 0],
    ["01:00", 60],
    ["6:05", 365],
    ["23:59", 1439],
  ])("parses %s", (input, expected) => expect(parseTimeToMinutes(input)).toBe(expected));

  it.each(["24:00", "12:60", "noon", "", "7"])("rejects %j", (input) =>
    expect(() => parseTimeToMinutes(input)).toThrow()
  );
});

describe("minutesInTimeZone", () => {
  it("reads the wall clock in the given zone, not the machine's", () => {
    const instant = new Date("2026-11-27T21:30:00Z");
    expect(minutesInTimeZone(instant, "Africa/Nairobi")).toBe(0 * 60 + 30); // 00:30 next day
    expect(minutesInTimeZone(instant, "UTC")).toBe(21 * 60 + 30);
  });
});

describe("isWithinBlackoutHours — same-day window 01:00–06:00", () => {
  it.each([
    ["00:59", false],
    ["01:00", true],
    ["03:30", true],
    ["05:59", true],
    ["06:00", false],
    ["12:00", false],
  ])("at %s → %s", (time, expected) =>
    expect(isWithinBlackoutHours(nairobi(time), "01:00", "06:00", TZ)).toBe(expected)
  );
});

describe("isWithinBlackoutHours — overnight window 23:00–06:00", () => {
  it.each([
    ["22:59", false],
    ["23:00", true],
    ["23:59", true],
    ["00:00", true],
    ["05:59", true],
    ["06:00", false],
    ["14:00", false],
  ])("at %s → %s", (time, expected) =>
    expect(isWithinBlackoutHours(nairobi(time), "23:00", "06:00", TZ)).toBe(expected)
  );
});

describe("isWithinBlackoutHours — edge settings", () => {
  it("treats start == end as no blackout", () => {
    expect(isWithinBlackoutHours(nairobi("03:00"), "03:00", "03:00", TZ)).toBe(false);
  });

  it("throws on malformed settings so the gate can fail closed", () => {
    expect(() => isWithinBlackoutHours(nairobi("03:00"), "1am", "06:00", TZ)).toThrow();
  });
});

describe("isKillSwitchActive", () => {
  it("is true only when the switch is on", () => {
    expect(isKillSwitchActive(true)).toBe(true);
    expect(isKillSwitchActive(false)).toBe(false);
  });
});

describe("isDailyLimitExceeded", () => {
  it.each([
    [0, 10, false],
    [9, 10, false],
    [10, 10, true],
    [11, 10, true],
    [0, 0, true],
  ])("%i sent of %i → %s", (count, limit, expected) =>
    expect(isDailyLimitExceeded(count, limit)).toBe(expected)
  );
});

describe("containsUrl", () => {
  it.each([
    "check this https://example.com/x?y=1",
    "http://foo.bar",
    "HTTPS://LOUD.COM",
    "go to www.something.co.ke",
    "bit.ly/abc123",
    "visit example.com now",
    "my site is abeddy.dev",
  ])("detects a link in %j", (msg) => expect(containsUrl(msg)).toBe(true));

  it.each([
    "awww that's sweet",
    "wwwhat",
    "e.g. tomorrow",
    "sawa. tutaongea kesho",
    "it costs 2.50 only",
    "the end.",
  ])("does not flag %j", (msg) => expect(containsUrl(msg)).toBe(false));
});

describe("isMessageTooShort", () => {
  it.each([
    ["", true],
    ["   ", true],
    ["k", true],
    ["👍", true],
    ["ok", false],
    ["hi", false],
    ["  gn  ", false],
    ["yoo", false],
    ["sema", false],
  ])("%j → %s", (msg, expected) => expect(isMessageTooShort(msg)).toBe(expected));

  it("respects a custom minimum", () => {
    expect(isMessageTooShort("hi", 3)).toBe(true);
  });
});
