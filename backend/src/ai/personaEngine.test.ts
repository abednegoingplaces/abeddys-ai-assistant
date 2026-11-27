import { describe, it, expect } from "vitest";
import { buildChatHistory, generateReply, parsePersonaOutput } from "./personaEngine";

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

describe("buildChatHistory", () => {
  it("drops unanswered messages at the end (the old Hi + new Hi = HiHi bug)", () => {
    expect(buildChatHistory([{ role: "user", content: "Hi" }])).toEqual([]);
    expect(
      buildChatHistory([
        { role: "user", content: "yo" },
        { role: "assistant", content: "semaje" },
        { role: "user", content: "uko?" },
      ])
    ).toEqual([
      { role: "user", content: "yo" },
      { role: "assistant", content: "semaje" },
    ]);
  });

  it("starts with the other person's message (Gemini rejects history starting with the bot)", () => {
    expect(
      buildChatHistory([
        { role: "assistant", content: "poa tu" },
        { role: "assistant", content: "wazii" },
        { role: "user", content: "kulikua aje" },
        { role: "assistant", content: "acha tu" },
      ])
    ).toEqual([
      { role: "user", content: "kulikua aje" },
      { role: "assistant", content: "acha tu" },
    ]);
    expect(buildChatHistory([{ role: "assistant", content: "only me" }])).toEqual([]);
  });

  it("merges back-to-back messages from the same side", () => {
    expect(
      buildChatHistory([
        { role: "user", content: "mzee" },
        { role: "user", content: "uko sawa" },
        { role: "assistant", content: "poa" },
      ])
    ).toEqual([
      { role: "user", content: "mzee\nuko sawa" },
      { role: "assistant", content: "poa" },
    ]);
  });

  it("does not modify the input", () => {
    const input = [{ role: "user" as const, content: "a" }, { role: "user" as const, content: "b" }, { role: "assistant" as const, content: "c" }];
    buildChatHistory(input);
    expect(input[0].content).toBe("a");
  });
});

describe("generateReply defence in depth", () => {
  it.each(["CLIENT"] as const)("never calls the model for %s contacts", async (group) => {
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
