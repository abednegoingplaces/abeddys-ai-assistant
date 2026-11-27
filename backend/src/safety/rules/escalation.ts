/**
 * Tier 3 — escalation rules. Pure functions: they decide whether a message must go to
 * Abeddy instead of being answered automatically. They run before keyword rules and
 * before any LLM call, in every contact mode.
 */
import type { ContactGroup } from "../types";

/** Groups the bot never impersonates Abeddy to. */
const ESCALATED_GROUPS: ReadonlySet<ContactGroup> = new Set<ContactGroup>(["CLIENT", "UNKNOWN"]);

export function shouldEscalateContactGroup(group: ContactGroup): boolean {
  return ESCALATED_GROUPS.has(group);
}

export function countWords(content: string): number {
  const trimmed = content.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function isWordCountExceeded(content: string, maxWords = 50): boolean {
  return countWords(content) > maxWords;
}

// ─── Money ───────────────────────────────────────────────
// Whole-word / whole-phrase matches only, so "equipment" or "nipeleke" don't trip them.

const MONEY_REQUEST_PATTERNS: RegExp[] = [
  /\bganji\b/i,
  /\bdo{2,}h\b/i, // "dooh", "doooh"
  /\bokolea\b/i,
  /\bniwai\b/i,
  /\bnitakurefund\b/i,
  /\bm-?pesa\b/i,
  /\bnisendie\b/i,
  /\bnipe\b/i,
  /\bnikopeshe\b/i,
  /\bpesa\b/i,
  /\bchapaa\b/i,
  /\bmkopo\b/i,
  /\blend me\b/i,
  /\bloan\b/i,
  /\bborrow\b/i,
  /\bsend me (?:some )?(?:money|cash)\b/i,
];

const MONEY_OFFERING_PATTERNS: RegExp[] = [
  /\bnimekutumia\b/i,
  /\bnimekutuma(?:ia)?\b/i,
  /\bnimesend\b/i,
  /\bnimetuma\b/i,
  /\bpokea\b/i,
  /\b(?:i'?ve |i have |just )?sent you\b/i,
  /\bsending you\b/i,
];

export interface MoneyClassification {
  isRequest: boolean;
  isOffering: boolean;
}

/**
 * Classifies money talk. Offering patterns take priority: "nimekutumia mpesa" is someone
 * paying Abeddy, not asking him for money.
 */
export function isMoneyRequest(content: string): MoneyClassification {
  const isOffering = MONEY_OFFERING_PATTERNS.some((p) => p.test(content));
  const mentionsRequest = MONEY_REQUEST_PATTERNS.some((p) => p.test(content));
  return { isRequest: mentionsRequest && !isOffering, isOffering };
}

// ─── Location ────────────────────────────────────────────

const LOCATION_PATTERNS: RegExp[] = [
  /\buko wapi\b/i,
  /\buko side gani\b/i,
  /\buko area gani\b/i,
  /\bunakaa wapi\b/i,
  /\blocation yako\b/i,
  /\bwhere (?:are|r) (?:you|u)\b/i,
  /\bwhere do you (?:stay|live)\b/i,
  /\b(?:send|share|drop|tuma) (?:me )?(?:your |ur )?(?:live )?location\b/i,
];

export function isLocationInquiry(content: string): boolean {
  return LOCATION_PATTERNS.some((p) => p.test(content));
}
