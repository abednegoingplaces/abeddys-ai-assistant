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

import { createRequireAdmin } from "./auth";

function run(
  config: Parameters<typeof createRequireAdmin>[0],
  req: { auth?: string; token?: string; addr?: string }
) {
  const guard = createRequireAdmin(config);
  let status: number | null = null;
  let passed = false;
  guard(
    {
      header: (n) => (n.toLowerCase() === "authorization" ? req.auth : undefined),
      query: req.token ? { token: req.token } : {},
      socket: { remoteAddress: req.addr ?? "203.0.113.5" },
    },
    { status: (c) => { status = c; return { json: () => undefined }; } },
    () => { passed = true; }
  );
  return { status, passed };
}

describe("createRequireAdmin", () => {
  const dev = { adminToken: undefined, nodeEnv: "development" as const };
  const prod = { adminToken: TOKEN, nodeEnv: "production" as const };

  it("rejects remote requests when no token is configured, even in development", () => {
    expect(run(dev, {})).toEqual({ status: 401, passed: false });
  });
  it("allows loopback when no token is configured in development", () => {
    for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(run(dev, { addr }).passed).toBe(true);
    }
  });
  it("rejects loopback when no token is configured outside development", () => {
    expect(run({ adminToken: undefined, nodeEnv: "production" }, { addr: "127.0.0.1" }).status).toBe(401);
  });
  it("accepts the right bearer token", () => {
    expect(run(prod, { auth: `Bearer ${TOKEN}` }).passed).toBe(true);
  });
  it("accepts the right query token", () => {
    expect(run(prod, { token: TOKEN }).passed).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(run(prod, { auth: "Bearer nope" })).toEqual({ status: 401, passed: false });
  });
  it("requires the token from loopback when one is configured", () => {
    expect(run(prod, { addr: "127.0.0.1" }).status).toBe(401);
  });
});
