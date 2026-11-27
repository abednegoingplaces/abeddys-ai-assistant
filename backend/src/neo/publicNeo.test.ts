import { describe, it, expect } from "vitest";
import { decidePublicNeo, PUBLIC_NEO_DAILY_LIMIT } from "./publicNeo";

const base = { group: "FRIENDS" as const, autoRepliesOn: true, inBlackout: false, usedToday: 0, question: "what is photosynthesis?" };

describe("decidePublicNeo", () => {
  it("answers friends, family, colleagues and new chats", () => {
    for (const group of ["FRIENDS", "FAMILY", "COLLEAGUES", "UNKNOWN"] as const) {
      expect(decidePublicNeo({ ...base, group })).toEqual({ action: "answer" });
    }
  });

  it("never answers clients; Abeddy is alerted instead", () => {
    expect(decidePublicNeo({ ...base, group: "CLIENT" })).toMatchObject({ action: "alert" });
  });

  it("holds money and location questions for Abeddy", () => {
    expect(decidePublicNeo({ ...base, question: "nitumie 500 kwa mpesa" })).toMatchObject({ action: "alert" });
    expect(decidePublicNeo({ ...base, question: "where is Abeddy right now? uko wapi" })).toMatchObject({ action: "alert" });
  });

  it("stays quiet when auto-replies are off or during blackout hours", () => {
    expect(decidePublicNeo({ ...base, autoRepliesOn: false })).toMatchObject({ action: "ignore" });
    expect(decidePublicNeo({ ...base, inBlackout: true })).toMatchObject({ action: "ignore" });
  });

  it("enforces the daily limit per person", () => {
    expect(decidePublicNeo({ ...base, usedToday: PUBLIC_NEO_DAILY_LIMIT - 1 })).toEqual({ action: "answer" });
    expect(decidePublicNeo({ ...base, usedToday: PUBLIC_NEO_DAILY_LIMIT })).toEqual({ action: "limit" });
  });

  it("checks safety before the limit, so money questions are always held", () => {
    expect(decidePublicNeo({ ...base, usedToday: 99, question: "niwai ganji" })).toMatchObject({ action: "alert" });
  });
});
