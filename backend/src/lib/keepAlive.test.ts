import { describe, it, expect } from "vitest";
import { keepAliveTarget } from "./keepAlive";

describe("keepAliveTarget", () => {
  it("appends /health to the service URL", () => {
    expect(keepAliveTarget("https://abeddy-bot.onrender.com")).toBe("https://abeddy-bot.onrender.com/health");
    expect(keepAliveTarget("https://abeddy-bot.onrender.com/")).toBe("https://abeddy-bot.onrender.com/health");
  });

  it("drops query strings and fragments", () => {
    expect(keepAliveTarget("https://x.onrender.com/?a=1#b")).toBe("https://x.onrender.com/health");
  });

  it.each([undefined, "", "not a url", "ftp://x.com"])("is disabled for %j", (v) =>
    expect(keepAliveTarget(v)).toBeNull()
  );
});
