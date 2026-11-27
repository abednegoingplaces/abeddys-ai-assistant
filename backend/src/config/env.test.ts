import { describe, it, expect } from "vitest";
import { validateEnv, envSchema } from "./env";

describe("Environment Configuration Schema", () => {
  it("should successfully parse valid environment variables with default values", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
    };

    const parsed = validateEnv(raw);
    expect(parsed.DATABASE_URL).toBe(raw.DATABASE_URL);
    expect(parsed.PORT).toBe(3001);
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.GEMINI_API_KEY).toBeUndefined();
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("should coerce string PORT to number", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
      PORT: "8080",
    };

    const parsed = validateEnv(raw);
    expect(parsed.PORT).toBe(8080);
    expect(typeof parsed.PORT).toBe("number");
  });

  it("should throw a descriptive error when DATABASE_URL is missing", () => {
    const raw = {
      PORT: "3001",
    };

    expect(() => validateEnv(raw)).toThrowError(
      /Invalid environment configuration[\s\S]*DATABASE_URL/
    );
  });

  it("should accept valid NODE_ENV values and reject invalid ones", () => {
    const validRaw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
      NODE_ENV: "production",
      ADMIN_TOKEN: "a".repeat(32),
    };
    expect(validateEnv(validRaw).NODE_ENV).toBe("production");

    const invalidRaw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
      NODE_ENV: "invalid-env",
    };
    expect(() => validateEnv(invalidRaw)).toThrowError();
  });

  it("should default model IDs and timezone", () => {
    const parsed = validateEnv({ DATABASE_URL: "postgresql://x@localhost/db" });
    expect(parsed.PERSONA_MODEL).toBe("claude-opus-5-5");
    expect(parsed.TUTOR_MODEL).toBe("claude-opus-5-5");
    expect(parsed.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(parsed.TZ).toBe("Africa/Nairobi");
  });

  it("should require ADMIN_TOKEN in production", () => {
    expect(() =>
      validateEnv({ DATABASE_URL: "postgresql://x@localhost/db", NODE_ENV: "production" })
    ).toThrowError(/ADMIN_TOKEN/);
    expect(
      validateEnv({
        DATABASE_URL: "postgresql://x@localhost/db",
        NODE_ENV: "production",
        ADMIN_TOKEN: "a".repeat(32),
      }).ADMIN_TOKEN
    ).toBe("a".repeat(32));
  });

  it("should reject a short ADMIN_TOKEN", () => {
    expect(() =>
      validateEnv({ DATABASE_URL: "postgresql://x@localhost/db", ADMIN_TOKEN: "short" })
    ).toThrowError(/ADMIN_TOKEN/);
  });

  it("should treat empty strings from a copied .env.example as unset", () => {
    const parsed = validateEnv({
      DATABASE_URL: "postgresql://x@localhost/db",
      ADMIN_TOKEN: "",
      DASHBOARD_ORIGIN: "",
      OWNER_WID: "",
      GEMINI_API_KEY: "",
    });
    expect(parsed.ADMIN_TOKEN).toBeUndefined();
    expect(parsed.DASHBOARD_ORIGIN).toBeUndefined();
    expect(parsed.OWNER_WID).toBeUndefined();
    expect(parsed.GEMINI_API_KEY).toBeUndefined();
  });

  it("should still require ADMIN_TOKEN in production when it is an empty string", () => {
    expect(() =>
      validateEnv({ DATABASE_URL: "postgresql://x@localhost/db", NODE_ENV: "production", ADMIN_TOKEN: "" })
    ).toThrowError(/ADMIN_TOKEN is required/);
  });

  it("should capture API keys when provided", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
      GEMINI_API_KEY: "test-gemini-key",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    };

    const parsed = validateEnv(raw);
    expect(parsed.GEMINI_API_KEY).toBe("test-gemini-key");
    expect(parsed.ANTHROPIC_API_KEY).toBe("test-anthropic-key");
  });
});
