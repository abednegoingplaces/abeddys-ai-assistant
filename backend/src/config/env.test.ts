import { describe, it, expect } from "vitest";
import { validateEnv, envSchema } from "./env";

describe("Environment Configuration Schema", () => {
  it("should successfully parse valid environment variables with default values", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
    };

    const parsed = validateEnv(raw);
    expect(parsed.DATABASE_URL).toBe(raw.DATABASE_URL);
    expect(parsed.REDIS_URL).toBe("redis://localhost:6379");
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
    };
    expect(validateEnv(validRaw).NODE_ENV).toBe("production");

    const invalidRaw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/abeddy_assistant",
      NODE_ENV: "invalid-env",
    };
    expect(() => validateEnv(invalidRaw)).toThrowError();
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
