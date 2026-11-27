import { describe, it, expect } from "vitest";
import { isFromTheBot, isOwnSelfChat, neoReply, parseNeoCommand } from "./command";

describe("parseNeoCommand", () => {
  it.each([
    ["/neo what did Kevo say?", "what did Kevo say?"],
    ["/Neo, draft a cover letter", "draft a cover letter"],
    ["  /NEO: summarise today", "summarise today"],
    ["/neo", ""],
    ["/neo\nline one\nline two", "line one\nline two"],
  ])("%j → %j", (input, task) => expect(parseNeoCommand(input)).toBe(task));

  it.each(["neo what's up", "buy milk /neo", "/neon lights", "/neology", "", "test"])("ignores %j", (input) =>
    expect(parseNeoCommand(input)).toBeNull()
  );
});

describe("isOwnSelfChat", () => {
  const own = new Set(["254700000602@c.us", "70600000318@lid"]);
  it("accepts Abeddy's own chat by phone id or hidden id", () => {
    expect(isOwnSelfChat(true, "70600000318@lid", own)).toBe(true);
    expect(isOwnSelfChat(true, "254700000602@c.us", own)).toBe(true);
  });
  it("rejects messages he sends to other people, and anything not from him", () => {
    expect(isOwnSelfChat(true, "92522772701345@lid", own)).toBe(false);
    expect(isOwnSelfChat(false, "70600000318@lid", own)).toBe(false);
    expect(isOwnSelfChat(true, undefined, own)).toBe(false);
  });
});

describe("isFromTheBot", () => {
  it("recognises Neo's replies, alerts and tracked ids", () => {
    expect(isFromTheBot("🤖 Done", new Set(), "x")).toBe(true);
    expect(isFromTheBot("🚩 Needs your reply — Kevo", new Set(), "x")).toBe(true);
    expect(isFromTheBot("/neo hi", new Set(["abc"]), "abc")).toBe(true);
    expect(isFromTheBot("/neo hi", new Set(), "abc")).toBe(false);
  });
});

describe("neoReply", () => {
  it("prefixes the robot mark", () => expect(neoReply("  Done ")).toBe("🤖 Done"));
});

