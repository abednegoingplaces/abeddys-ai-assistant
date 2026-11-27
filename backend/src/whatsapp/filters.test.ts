import { describe, it, expect } from "vitest";
import { shouldIgnoreChat } from "./filters";

describe("shouldIgnoreChat", () => {
  it.each([
    "120363000000000000@g.us",
    "status@broadcast",
    "1700000000@broadcast",
    "120363000000000000@newsletter",
  ])("ignores %s", (from) => expect(shouldIgnoreChat(from)).toBe(true));

  it.each(["254712345678@c.us", "123456789012345@lid"])("allows direct chat %s", (from) =>
    expect(shouldIgnoreChat(from)).toBe(false)
  );
});
