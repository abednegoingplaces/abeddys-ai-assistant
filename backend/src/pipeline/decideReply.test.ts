import { describe, it, expect, vi } from "vitest";
import { decideReply, findMatchingRule, formatEscalationNotice, type PipelineDeps, type InboundMessage } from "./decideReply";
import { createSafetyEngine } from "../safety/safetyEngine";

const safety = createSafetyEngine({
  timeZone: "Africa/Nairobi",
  getSettings: async () => ({ killSwitch: false, blackoutStart: "01:00", blackoutEnd: "06:00", dailyReplyLimit: 10 }),
  getReplyCount: async () => 0,
});

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    checkSafety: safety,
    getActiveRules: vi.fn(async () => [
      { keyword: "price", response: "Check the price list I sent" },
      { keyword: "mpesa", response: "Till number ni 123456" },
    ]),
    getHistory: vi.fn(async () => []),
    generatePersonaReply: vi.fn(async () => ({ reply: "poa tu, wewe je?", shouldFlag: false })),
    generateTutorReply: vi.fn(async () => ({ reply: "Recursion is a function calling itself.", shouldFlag: false })),
    ...over,
  };
}

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  contactId: "c1",
  contactName: "Kevo",
  group: "FRIENDS",
  mode: "IMPERSONATOR",
  platform: "WHATSAPP",
  content: "uko sawa mzee",
  now: new Date("2026-11-27T12:00:00+03:00"),
  ...over,
});

describe("decideReply — ordering", () => {
  it("blocked messages never reach rules or AI", async () => {
    const d = deps();
    const r = await decideReply(msg({ now: new Date("2026-11-27T03:00:00+03:00") }), d);
    expect(r.kind).toBe("BLOCKED");
    expect(d.getActiveRules).not.toHaveBeenCalled();
    expect(d.generatePersonaReply).not.toHaveBeenCalled();
  });

  it("a CLIENT message matching a keyword rule is escalated, not auto-answered", async () => {
    const d = deps();
    const r = await decideReply(msg({ group: "CLIENT", content: "what's the price?" }), d);
    expect(r).toMatchObject({ kind: "ESCALATED", draft: null, notifyOwner: true });
    expect(d.getActiveRules).not.toHaveBeenCalled();
  });

  it("an UNKNOWN contact is escalated quietly (no owner ping) when only the group fired", async () => {
    const r = await decideReply(msg({ group: "UNKNOWN", content: "habari yako" }), deps());
    expect(r).toMatchObject({ kind: "ESCALATED", notifyOwner: false });
  });

  it("an UNKNOWN contact asking for money in TUTOR mode still pings the owner", async () => {
    const r = await decideReply(msg({ group: "UNKNOWN", mode: "TUTOR", content: "nisendie mpesa" }), deps());
    expect(r).toMatchObject({ kind: "ESCALATED", notifyOwner: true });
  });

  it("a money request matching a keyword rule is escalated", async () => {
    const d = deps();
    const r = await decideReply(msg({ content: "nisendie mpesa bro" }), d);
    expect(r.kind).toBe("ESCALATED");
    expect(d.getActiveRules).not.toHaveBeenCalled();
  });

  it("a TUTOR contact asking for money is escalated before the tutor engine", async () => {
    const d = deps();
    const r = await decideReply(msg({ mode: "TUTOR", group: "UNKNOWN", content: "nikopeshe 1k please" }), d);
    expect(r.kind).toBe("ESCALATED");
    expect(d.generateTutorReply).not.toHaveBeenCalled();
  });

  it("safe messages that match a rule use the rule and skip the AI", async () => {
    const d = deps();
    const r = await decideReply(msg({ content: "what's the PRICE of the hoodie" }), d);
    expect(r).toEqual({ kind: "RULE", reply: "Check the price list I sent", keyword: "price" });
    expect(d.generatePersonaReply).not.toHaveBeenCalled();
  });
});

describe("decideReply — AI engines", () => {
  it("routes IMPERSONATOR contacts to the persona engine", async () => {
    const d = deps();
    expect(await decideReply(msg(), d)).toEqual({ kind: "AI", reply: "poa tu, wewe je?", engine: "PERSONA" });
  });

  it("routes TUTOR contacts (any group) to the tutor engine", async () => {
    const d = deps();
    const r = await decideReply(msg({ mode: "TUTOR", group: "UNKNOWN", content: "explain recursion" }), d);
    expect(r).toMatchObject({ kind: "AI", engine: "TUTOR" });
    expect(d.generatePersonaReply).not.toHaveBeenCalled();
  });

  it("escalates with the draft when the AI flags but still suggests a reply", async () => {
    const d = deps({
      generatePersonaReply: vi.fn(async () => ({ reply: "wazii", shouldFlag: true, reason: "Meetup request" })),
    });
    expect(await decideReply(msg({ content: "tukutane kesho?" }), d)).toEqual({
      kind: "ESCALATED",
      reason: "Meetup request",
      draft: "wazii",
      notifyOwner: true,
    });
  });

  it("never sends an empty AI reply", async () => {
    const d = deps({ generateTutorReply: vi.fn(async () => ({ reply: "   ", shouldFlag: false })) });
    const r = await decideReply(msg({ mode: "TUTOR" }), d);
    expect(r).toEqual({ kind: "ESCALATED", reason: "AI returned an empty reply", draft: null, notifyOwner: true });
  });
});

describe("findMatchingRule", () => {
  const rules = [
    { keyword: "", response: "never" },
    { keyword: "Hours", response: "9 to 5" },
  ];
  it("matches case-insensitively and ignores blank keywords", () => {
    expect(findMatchingRule("what are your hours", rules)?.response).toBe("9 to 5");
    expect(findMatchingRule("hello there", rules)).toBeUndefined();
  });
});

describe("formatEscalationNotice", () => {
  it("includes contact, reason, message and draft", () => {
    const text = formatEscalationNotice({ contactName: "Kevo", reason: "Money request", content: "niwai 500", draft: null });
    expect(text).toContain("Kevo");
    expect(text).toContain("Money request");
    expect(text).toContain('"niwai 500"');
    expect(text).not.toContain("Suggested reply");
    expect(formatEscalationNotice({ contactName: "K", reason: "r", content: "m", draft: "wazii" })).toContain(
      "Suggested reply: wazii"
    );
  });

  it("truncates very long messages", () => {
    const text = formatEscalationNotice({ contactName: "K", reason: "r", content: "a".repeat(800), draft: null });
    expect(text.length).toBeLessThan(600);
    expect(text).toContain("…");
  });
});
