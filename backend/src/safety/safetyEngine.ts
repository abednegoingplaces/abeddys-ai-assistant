/**
 * Safety gate — the single place that decides whether a message may be answered automatically.
 *
 * It runs BEFORE keyword rules and BEFORE any LLM, for every contact mode, and it fails closed:
 * if settings or the rate-limit store can't be read, nothing is sent.
 *
 * The rule logic lives in pure functions under ./rules; this module only gathers the data
 * (settings, reply counts) and applies the rules in order. Data access is injected so the
 * whole pipeline is unit-testable without a database.
 */
import {
  MIN_MESSAGE_LENGTH,
  containsUrl,
  isDailyLimitExceeded,
  isKillSwitchActive,
  isMessageTooShort,
  isWithinBlackoutHours,
} from "./rules/hardSafety";
import {
  isLocationInquiry,
  isMoneyRequest,
  isWordCountExceeded,
  shouldEscalateContactGroup,
} from "./rules/escalation";
import type {
  ContactMode,
  EscalationCheckResult,
  SafetyCheckResult,
  SafetyInput,
  SafetySettings,
  SafetyVerdict,
} from "./types";

export interface SafetyDeps {
  getSettings(): Promise<SafetySettings | null>;
  getReplyCount(contactId: string): Promise<number>;
  timeZone: string;
}

export const MAX_IMPERSONATOR_WORDS = 50;

// ─── Tier 1: hard safety ─────────────────────────────────

export function evaluateHardSafety(
  settings: SafetySettings,
  replyCount: number,
  content: string,
  now: Date,
  timeZone: string
): SafetyCheckResult {
  if (isKillSwitchActive(settings.killSwitch)) {
    return { shouldReply: false, reason: "Kill switch is active" };
  }

  let inBlackout: boolean;
  try {
    inBlackout = isWithinBlackoutHours(now, settings.blackoutStart, settings.blackoutEnd, timeZone);
  } catch (err) {
    return {
      shouldReply: false,
      reason: `Blackout settings are invalid (${err instanceof Error ? err.message : "unknown"})`,
    };
  }
  if (inBlackout) {
    return {
      shouldReply: false,
      reason: `Blackout hours (${settings.blackoutStart} – ${settings.blackoutEnd})`,
    };
  }

  if (isDailyLimitExceeded(replyCount, settings.dailyReplyLimit)) {
    return {
      shouldReply: false,
      reason: `Daily reply limit reached (${replyCount}/${settings.dailyReplyLimit})`,
    };
  }

  if (containsUrl(content)) {
    return { shouldReply: false, reason: "Message contains a URL" };
  }

  if (isMessageTooShort(content)) {
    return { shouldReply: false, reason: `Message is too short (under ${MIN_MESSAGE_LENGTH} characters)` };
  }

  return { shouldReply: true, reason: "All safety checks passed" };
}

// ─── Tier 3: escalation ──────────────────────────────────

/**
 * Escalation rules, per mode:
 * - Money requests and location questions escalate in EVERY mode (a tutor contact
 *   asking for M-Pesa still needs Abeddy).
 * - The CLIENT group and the 50-word limit are impersonation rules: the bot never answers
 *   clients as Abeddy, and never answers long messages as him. New chats (UNKNOWN) are answered. Tutor mode is
 *   assigned deliberately and openly says it's an AI, so long study questions are fine.
 */
export function evaluateEscalation(
  content: string,
  group: SafetyInput["group"],
  mode: ContactMode
): EscalationCheckResult {
  if (mode === "IMPERSONATOR" && shouldEscalateContactGroup(group)) {
    return { shouldFlag: true, code: "GROUP", reason: `Contact group is ${group} — requires manual handling` };
  }

  if (mode === "IMPERSONATOR" && isWordCountExceeded(content, MAX_IMPERSONATOR_WORDS)) {
    return {
      shouldFlag: true,
      code: "LONG_MESSAGE",
      reason: `Long message (over ${MAX_IMPERSONATOR_WORDS} words) — needs Abeddy's attention`,
    };
  }

  if (isMoneyRequest(content).isRequest) {
    return { shouldFlag: true, code: "MONEY", reason: "Money request detected — needs Abeddy's decision" };
  }

  if (isLocationInquiry(content)) {
    return { shouldFlag: true, code: "LOCATION", reason: "Location question — needs Abeddy's response" };
  }

  return { shouldFlag: false };
}

// ─── Coordinator ─────────────────────────────────────────

export function createSafetyEngine(deps: SafetyDeps) {
  return async function checkMessageSafety(input: SafetyInput): Promise<SafetyVerdict> {
    const now = input.now ?? new Date();

    let settings: SafetySettings | null;
    let replyCount: number;
    try {
      settings = await deps.getSettings();
      replyCount = await deps.getReplyCount(input.contactId);
    } catch (err) {
      // Fail closed: if we can't check the limits, we don't reply.
      const reason = `Safety data unavailable (${err instanceof Error ? err.message : "unknown error"})`;
      console.error(`🛑 ${reason}`);
      return { action: "BLOCK", reason };
    }

    if (!settings) {
      return { action: "BLOCK", reason: "Settings not configured" };
    }

    const hard = evaluateHardSafety(settings, replyCount, input.content, now, deps.timeZone);
    if (!hard.shouldReply) {
      return { action: "BLOCK", reason: hard.reason };
    }

    const escalation = evaluateEscalation(input.content, input.group, input.mode);
    if (escalation.shouldFlag && escalation.code) {
      return { action: "ESCALATE", reason: escalation.reason ?? "Needs manual review", code: escalation.code };
    }

    return { action: "PROCEED", reason: hard.reason };
  };
}

export type CheckMessageSafety = ReturnType<typeof createSafetyEngine>;
