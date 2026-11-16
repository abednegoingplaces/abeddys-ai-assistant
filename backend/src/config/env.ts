import { z } from "zod";
import dotenv from "dotenv";

// Load .env variables before validation
dotenv.config();

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Model IDs live in env so a retirement is a config change, not a code change.
  PERSONA_MODEL: z.string().min(1).default("claude-opus-5-5"),
  TUTOR_MODEL: z.string().min(1).default("claude-opus-5-5"),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),

  // Protects /api/qr (and later /api/admin). Required outside development.
  ADMIN_TOKEN: z.string().min(24, "ADMIN_TOKEN must be at least 24 characters").optional(),
  // Allowed browser origin for the dashboard; CORS is closed when unset.
  DASHBOARD_ORIGIN: z.string().url().optional(),
  // Owner's own WhatsApp id (e.g. 2547XXXXXXXX@c.us) for escalations.
  OWNER_WID: z.string().optional(),
  // Timezone used for blackout hours and daily limit resets.
  TZ: z.string().default("Africa/Nairobi"),
}).superRefine((val, ctx) => {
  if (val.NODE_ENV === "production" && !val.ADMIN_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ADMIN_TOKEN"],
      message: "ADMIN_TOKEN is required in production",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates any arbitrary environment map against the application schema.
 * Useful for tests and isolated runtimes.
 */
export function validateEnv(rawEnv: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const errorMessages = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `❌ Invalid environment configuration:\n${errorMessages}\nPlease check your .env file or environment variables.`
    );
  }
  return parsed.data;
}

// In test environment, provide a safe fallback so modules can be imported without throwing if .env is missing
export const env: Env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({
        DATABASE_URL:
          process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/test",
        REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
        PORT: process.env.PORT || "3001",
        NODE_ENV: "test",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "mock-gemini-key",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "mock-anthropic-key",
      })
    : validateEnv(process.env);
