import { describe, it, expect, vi } from "vitest";
import { createSafetyEngine, evaluateEscalation } from "./safetyEngine";
import type { SafetyInput, SafetySettings } from "./types";

const settings: SafetySettings = {
  killSwitch: false,
  blackoutStart: "01:00",
  blackoutEnd: "06:00",
  dailyReplyLimit: 10,
};

const midday = new Date("2026-11-27T12:00:00+03:00");

function engine(overrides: Partial<{ settings: SafetySettings | null; count: number; fail: "settings" | "redis" }> = {}) {
  return createSafetyEngine({
    timeZone: "Africa/Nairobi",
    getSettings: vi.fn(async () => {
      if (overrides.fail === "settings") throw new Error("db down");
      return overrides.settings === undefined ? settings : overrides.settings;
    }),
    getReplyCount: vi.fn(async () => {
      if (overrides.fail === "redis") throw new Error("ECONNREFUSED");
      return overrides.count ?? 0;
    }),
  });
}

const input = (over: Partial<SafetyInput> = {}): SafetyInput => ({
  contactId: "c1",
  group: "FRIENDS",
  mode: "IMPERSONATOR",
  platform: "WHATSAPP",
  content: "sema mzee, inakuaje",
  now: midday,
  ...over,
});

describe("checkMessageSafety — tier 1 blocks", () => {
  it("proceeds when everything is fine", async () => {
    expect((await engine()(input())).action).toBe("PROCEED");
  });

  it("blocks when settings are missing", async () => {
    expect(await engine({ settings: null })(input())).toEqual({ action: "BLOCK", reason: "Settings not configured" });
  });

  it("blocks on the kill switch", async () => {
    const v = await engine({ settings: { ...settings, killSwitch: true } })(input());
    expect(v).toEqual({ action: "BLOCK", reason: "Kill switch is active" });
  });

  it("blocks during blackout hours in Nairobi time", async () => {
    const v = await engine()(input({ now: new Date("2026-11-27T02:00:00+03:00") }));
    expect(v.action).toBe("BLOCK");
    expect(v.reason).toMatch(/Blackout/);
  });

  it("blocks with malformed blackout settings instead of crashing", async () => {
    const v = await engine({ settings: { ...settings, blackoutStart: "1am" } })(input());
    expect(v.action).toBe("BLOCK");
    expect(v.reason).toMatch(/invalid/i);
  });

  it("blocks at the daily limit", async () => {
    const v = await engine({ count: 10 })(input());
    expect(v).toEqual({ action: "BLOCK", reason: "Daily reply limit reached (10/10)" });
  });

  it("blocks links and too-short messages", async () => {
    expect((await engine()(input({ content: "see www.x.com" }))).action).toBe("BLOCK");
    expect((await engine()(input({ content: "k" }))).action).toBe("BLOCK");
    expect((await engine()(input({ content: "hi" }))).action).toBe("PROCEED");
  });

  it("fails closed when Redis is down", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const v = await engine({ fail: "redis" })(input());
    expect(v.action).toBe("BLOCK");
    expect(v.reason).toMatch(/ECONNREFUSED/);
    spy.mockRestore();
  });

  it("fails closed when the database is down", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await engine({ fail: "settings" })(input())).action).toBe("BLOCK");
    spy.mockRestore();
  });

  it("hard blocks win over escalation (no review noise during blackout)", async () => {
    const v = await engine({ settings: { ...settings, killSwitch: true } })(input({ group: "CLIENT" }));
    expect(v.action).toBe("BLOCK");
  });
});

describe("checkMessageSafety — tier 3 escalation", () => {
  it.each(["CLIENT", "UNKNOWN"] as const)("escalates %s contacts in impersonator mode", async (group) => {
    expect((await engine()(input({ group }))).action).toBe("ESCALATE");
  });

  it("escalates money requests", async () => {
    const v = await engine()(input({ content: "bro niwai ganji kidogo" }));
    expect(v).toEqual({ action: "ESCALATE", code: "MONEY", reason: "Money request detected — needs Abeddy's decision" });
  });

  it("lets money offers through", async () => {
    expect((await engine()(input({ content: "nimekutumia mpesa, confirm" }))).action).toBe("PROCEED");
  });

  it("escalates location questions", async () => {
    expect((await engine()(input({ content: "uko wapi saa hii?" }))).action).toBe("ESCALATE");
  });
});

describe("evaluateEscalation — per-mode rules", () => {
  const long = Array.from({ length: 60 }, () => "word").join(" ");

  it("TUTOR mode still escalates money and location (the old bypass)", () => {
    expect(evaluateEscalation("unaweza nisendie mpesa?", "UNKNOWN", "TUTOR").shouldFlag).toBe(true);
    expect(evaluateEscalation("where are you right now", "FRIENDS", "TUTOR").shouldFlag).toBe(true);
  });

  it("TUTOR mode answers long study questions and unknown-group students", () => {
    expect(evaluateEscalation(long, "UNKNOWN", "TUTOR").shouldFlag).toBe(false);
    expect(evaluateEscalation("explain recursion please", "UNKNOWN", "TUTOR").shouldFlag).toBe(false);
  });

  it("IMPERSONATOR mode escalates long messages", () => {
    expect(evaluateEscalation(long, "FRIENDS", "IMPERSONATOR").shouldFlag).toBe(true);
  });
});
