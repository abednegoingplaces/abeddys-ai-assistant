import { describe, it, expect } from "vitest";
import { startOfDayInTimeZone } from "./replyCounter";

describe("startOfDayInTimeZone", () => {
  it("finds Nairobi midnight (UTC+3) for an afternoon time", () => {
    // 15:30 in Nairobi = 12:30 UTC; Nairobi midnight = 21:00 UTC the previous day.
    expect(startOfDayInTimeZone(new Date("2026-11-27T12:30:00Z"), "Africa/Nairobi").toISOString()).toBe(
      "2026-11-26T21:00:00.000Z"
    );
  });

  it("rolls over at Nairobi midnight, not UTC midnight", () => {
    // 22:30 UTC on the 27th is already 01:30 on the 28th in Nairobi.
    expect(startOfDayInTimeZone(new Date("2026-11-27T22:30:00Z"), "Africa/Nairobi").toISOString()).toBe(
      "2026-11-27T21:00:00.000Z"
    );
    // 20:59 UTC on the 27th is still 23:59 on the 27th in Nairobi.
    expect(startOfDayInTimeZone(new Date("2026-11-27T20:59:59Z"), "Africa/Nairobi").toISOString()).toBe(
      "2026-11-26T21:00:00.000Z"
    );
  });

  it("works for UTC itself", () => {
    expect(startOfDayInTimeZone(new Date("2026-11-27T12:30:45.678Z"), "UTC").toISOString()).toBe(
      "2026-11-27T00:00:00.000Z"
    );
  });
});
