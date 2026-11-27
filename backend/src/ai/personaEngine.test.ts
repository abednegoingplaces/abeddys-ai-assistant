import { describe, it, expect } from "vitest";
import { generateReply, parsePersonaOutput } from "./personaEngine";

describe("parsePersonaOutput", () => {
  it("accepts a normal reply", () => {
    expect(parsePersonaOutput('{"reply":"poa tu, wewe je?","shouldFlag":false}')).toEqual({
      reply: "poa tu, wewe je?",
      shouldFlag: false,
      reason: undefined,
    });
  });

  it("strips a ```json fence instead of sending it to the chat", () => {
    const raw = '```json\n{"reply":"semaje mzee","shouldFlag":false}\n```';
    expect(parsePersonaOutput(raw)).toMatchObject({ reply: "semaje mzee", shouldFlag: false });
  });

  it("keeps a flag with its reason", () => {
    expect(parsePersonaOutput('{"reply":null,"shouldFlag":true,"reason":"needs a decision"}')).toEqual({
      reply: null,
      shouldFlag: true,
      reason: "needs a decision",
    });
  });

  it.each([
    ["plain text", "haha sawa"],
    ["broken JSON", '{"reply": "poa"'],
    ["wrong shape", '{"reply": 42}'],
    ["a JSON array", '["poa"]'],
  ])("flags %s instead of sending raw model output", (_label, raw) => {
    const r = parsePersonaOutput(raw);
    expect(r.shouldFlag).toBe(true);
    expect(r.reply).toBeNull();
  });

  it("flags an unflagged empty reply", () => {
    expect(parsePersonaOutput('{"reply":"  ","shouldFlag":false}')).toMatchObject({ shouldFlag: true, reply: null });
  });
});

describe("generateReply defence in depth", () => {
  it.each(["CLIENT", "UNKNOWN"] as const)("never calls the model for %s contacts", async (group) => {
    const r = await generateReply({
      contactId: "c1",
      contactName: "x",
      group,
      platform: "WHATSAPP",
      incomingMessage: "hello there",
      conversationHistory: [],
    });
    expect(r).toMatchObject({ reply: null, shouldFlag: true });
  });
});
