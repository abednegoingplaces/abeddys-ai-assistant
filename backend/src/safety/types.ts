// ─── Shared domain types ─────────────────────────────────

export type ContactGroup = "FRIENDS" | "FAMILY" | "COLLEAGUES" | "CLIENT" | "UNKNOWN";
export type ContactMode = "IMPERSONATOR" | "TUTOR";
export type Platform = "WHATSAPP" | "INSTAGRAM";

/** The subset of the Settings row the safety layer needs. */
export interface SafetySettings {
  killSwitch: boolean;
  blackoutStart: string; // "HH:MM"
  blackoutEnd: string; // "HH:MM"
  dailyReplyLimit: number;
}

// ─── Rule results ────────────────────────────────────────

/** Tier 1 (hard safety): may the bot reply at all? */
export interface SafetyCheckResult {
  shouldReply: boolean;
  reason: string;
}

/** Tier 3 (escalation): does a human need to see this first? */
export interface EscalationCheckResult {
  shouldFlag: boolean;
  reason?: string;
}

/**
 * Final verdict of the safety gate, computed before any keyword rule or LLM runs.
 * - BLOCK:    stay silent (kill switch, blackout, limits, links, noise). Nothing to review.
 * - ESCALATE: stay silent and put it in front of Abeddy.
 * - PROCEED:  the message may be answered by a keyword rule or an AI engine.
 */
export type SafetyVerdict =
  | { action: "BLOCK"; reason: string }
  | { action: "ESCALATE"; reason: string }
  | { action: "PROCEED"; reason: string };

export interface SafetyInput {
  contactId: string;
  group: ContactGroup;
  mode: ContactMode;
  platform: Platform;
  content: string;
  now?: Date;
}
