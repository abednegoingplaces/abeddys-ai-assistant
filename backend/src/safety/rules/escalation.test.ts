import { describe, it, expect } from "vitest";
import {
  countWords,
  isLocationInquiry,
  isMoneyRequest,
  isWordCountExceeded,
  shouldEscalateContactGroup,
} from "./escalation";

describe("shouldEscalateContactGroup", () => {
  it("escalates CLIENT", () => expect(shouldEscalateContactGroup("CLIENT")).toBe(true));
  it.each(["FRIENDS", "FAMILY", "COLLEAGUES", "UNKNOWN"] as const)("allows %s (new chats get replies)", (g) =>
    expect(shouldEscalateContactGroup(g)).toBe(false)
  );
});

describe("word count", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("counts words across any whitespace", () => {
    expect(countWords("  one\ttwo\n three  ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("allows exactly 50 words and escalates 51", () => {
    expect(isWordCountExceeded(words(50))).toBe(false);
    expect(isWordCountExceeded(words(51))).toBe(true);
  });
});

describe("isMoneyRequest", () => {
  it.each([
    "bro niwai ganji kidogo",
    "nisaidie pesa ya fare",
    "okolea mzee",
    "nitakurefund kesho",
    "niko na shida ya doooh",
    "unaweza nisendie mpesa",
    "tuma kwa M-Pesa",
    "nipe 500",
    "can you lend me 2k",
    "can I borrow some money",
    "send me money please",
    "nikopeshe kidogo",
  ])("flags a request: %j", (msg) => expect(isMoneyRequest(msg)).toEqual({ isRequest: true, isOffering: false }));

  it.each([
    "nimekutumia mpesa, confirm",
    "nimesend ganji yako",
    "pokea hii pesa",
    "I've sent you the money via mpesa",
    "sending you the cash now",
    "nimetuma pesa",
  ])("treats an offer as not a request: %j", (msg) => {
    const r = isMoneyRequest(msg);
    expect(r.isOffering).toBe(true);
    expect(r.isRequest).toBe(false);
  });

  it.each([
    "the equipment is ready",
    "nipeleke stage",
    "napenda hiyo picha",
    "how was the match",
    "mpesaaa", // not a whole word
  ])("ignores %j", (msg) => expect(isMoneyRequest(msg).isRequest).toBe(false));
});

describe("isLocationInquiry", () => {
  it.each([
    "uko wapi saa hii",
    "Uko side gani?",
    "where are you",
    "where r u bro",
    "location yako ni?",
    "send me your location",
    "drop your live location",
    "unakaa wapi siku hizi",
  ])("flags %j", (msg) => expect(isLocationInquiry(msg)).toBe(true));

  it.each(["where is the meeting notes", "you are wapi-ing", "nice location for a photo"])(
    "ignores %j",
    (msg) => expect(isLocationInquiry(msg)).toBe(false)
  );
});
