import { describe, it, expect } from "vitest";
import { geminiModelsToTry, isQuotaOrOverload } from "./geminiModels";

describe("geminiModelsToTry", () => {
  it("puts the main model first, then fallbacks, without duplicates or blanks", () => {
    expect(geminiModelsToTry("gemini-3.5-flash", " gemini-3.5-flash-lite, ,gemini-3.5-flash,gemini-3.1-flash-lite ")).toEqual([
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ]);
  });

  it("works with no fallbacks", () => {
    expect(geminiModelsToTry("gemini-3.5-flash", "")).toEqual(["gemini-3.5-flash"]);
  });
});

describe("isQuotaOrOverload", () => {
  it("recognises daily-limit and high-demand errors", () => {
    expect(isQuotaOrOverload({ status: 429 })).toBe(true);
    expect(isQuotaOrOverload({ status: 503 })).toBe(true);
    expect(isQuotaOrOverload(new Error("[GoogleGenerativeAI Error]: ... [429 Too Many Requests] quota"))).toBe(true);
    expect(isQuotaOrOverload(new Error("... [503 Service Unavailable] high demand"))).toBe(true);
  });

  it("does not retry other errors (bad key, bad request)", () => {
    expect(isQuotaOrOverload({ status: 400 })).toBe(false);
    expect(isQuotaOrOverload(new Error("[400 Bad Request] API key not valid"))).toBe(false);
    expect(isQuotaOrOverload(new Error("First content should be with role 'user'"))).toBe(false);
  });
});
