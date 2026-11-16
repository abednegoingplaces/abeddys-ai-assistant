import { describe, it, expect } from "vitest";
import { isValidAdminToken } from "./auth";

const TOKEN = "x".repeat(32);

describe("isValidAdminToken", () => {
  it("accepts the exact token", () => expect(isValidAdminToken(TOKEN, TOKEN)).toBe(true));
  it("rejects a wrong token", () => expect(isValidAdminToken("y".repeat(32), TOKEN)).toBe(false));
  it("rejects a prefix of the token", () => expect(isValidAdminToken(TOKEN.slice(0, 10), TOKEN)).toBe(false));
  it("rejects when nothing is presented", () => expect(isValidAdminToken(undefined, TOKEN)).toBe(false));
  it("rejects when no token is configured", () => expect(isValidAdminToken(TOKEN, undefined)).toBe(false));
});
