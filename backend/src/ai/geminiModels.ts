/**
 * Gemini model fallback. Free-tier keys have a small daily limit per model (e.g. 20 requests),
 * and busy models sometimes answer "503 high demand". When that happens we simply try the
 * next model in the list instead of leaving the message unanswered.
 *
 * Order: GEMINI_MODEL first, then GEMINI_FALLBACK_MODELS (comma-separated) in .env.
 */
import { env } from "../config/env";

export function geminiModelsToTry(primary: string, fallbacks: string): string[] {
  const all = [primary, ...fallbacks.split(",")].map((m) => m.trim()).filter(Boolean);
  return [...new Set(all)];
}

/** True for errors that another model can get around: daily quota (429) or overload (503). */
export function isQuotaOrOverload(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (status === 429 || status === 503) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\[(429|503)\b/.test(message);
}

/** Runs `call` with each model in turn until one succeeds or a non-quota error occurs. */
export async function withGeminiFallback<T>(call: (model: string) => Promise<T>): Promise<T> {
  const models = geminiModelsToTry(env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODELS);
  let lastError: unknown;
  for (const model of models) {
    try {
      return await call(model);
    } catch (error) {
      lastError = error;
      if (!isQuotaOrOverload(error)) throw error;
      console.warn(`⚠️ Gemini model ${model} is over its limit or busy; trying the next one`);
    }
  }
  throw lastError;
}
