/**
 * Message pipeline — decides what to do with one inbound message, without side effects.
 *
 * Order matters and is the whole point of this module:
 *   1. Safety gate (hard rules + escalation)   → BLOCKED / ESCALATED
 *   2. Keyword rules (static replies)          → RULE
 *   3. AI engine for the contact's mode        → AI, or ESCALATED if the engine flags
 *
 * Keyword rules come AFTER the gate, so a CLIENT contact or a money request that happens
 * to contain a rule keyword is still escalated instead of auto-answered.
 */
import type { CheckMessageSafety } from "../safety/safetyEngine";
import type { ContactGroup, ContactMode, Platform } from "../safety/types";
import type { InboundMedia } from "../media/media";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export interface AiResult {
  reply: string | null;
  shouldFlag: boolean;
  reason?: string;
}

export interface KeywordRule {
  keyword: string;
  response: string;
}

export interface InboundMessage {
  contactId: string;
  contactName: string;
  group: ContactGroup;
  mode: ContactMode;
  platform: Platform;
  content: string;
  /** Photo, video, voice note or sticker, passed to the AI so it can see or hear it. */
  media?: InboundMedia;
  now?: Date;
}

export interface PipelineDeps {
  checkSafety: CheckMessageSafety;
  /** Active rules, highest priority first. */
  getActiveRules(): Promise<KeywordRule[]>;
  getHistory(): Promise<ChatTurn[]>;
  generatePersonaReply(params: {
    contactId: string;
    contactName: string;
    group: ContactGroup;
    platform: Platform;
    incomingMessage: string;
    conversationHistory: ChatTurn[];
    media?: InboundMedia;
  }): Promise<AiResult>;
  generateTutorReply(params: {
    contactId: string;
    contactName?: string;
    incomingMessage: string;
    conversationHistory: ChatTurn[];
    media?: InboundMedia;
  }): Promise<AiResult>;
}

export type ReplyDecision =
  | { kind: "BLOCKED"; reason: string }
  | { kind: "ESCALATED"; reason: string; draft: string | null }
  | { kind: "RULE"; reply: string; keyword: string }
  | { kind: "AI"; reply: string; engine: "PERSONA" | "TUTOR" };

export function findMatchingRule(content: string, rules: KeywordRule[]): KeywordRule | undefined {
  const lower = content.toLowerCase();
  return rules.find((rule) => rule.keyword.trim() !== "" && lower.includes(rule.keyword.toLowerCase()));
}

export async function decideReply(msg: InboundMessage, deps: PipelineDeps): Promise<ReplyDecision> {
  // ── 1. Safety gate ─────────────────────────────────────
  const verdict = await deps.checkSafety({
    contactId: msg.contactId,
    group: msg.group,
    mode: msg.mode,
    platform: msg.platform,
    content: msg.content,
    now: msg.now,
  });
  if (verdict.action === "BLOCK") return { kind: "BLOCKED", reason: verdict.reason };
  if (verdict.action === "ESCALATE") return { kind: "ESCALATED", reason: verdict.reason, draft: null };

  // ── 2. Keyword rules ───────────────────────────────────
  const rule = findMatchingRule(msg.content, await deps.getActiveRules());
  if (rule) return { kind: "RULE", reply: rule.response, keyword: rule.keyword };

  // ── 3. AI engine ───────────────────────────────────────
  const history = await deps.getHistory();
  const engine = msg.mode === "TUTOR" ? "TUTOR" : "PERSONA";
  const result =
    engine === "TUTOR"
      ? await deps.generateTutorReply({
          contactId: msg.contactId,
          contactName: msg.contactName,
          incomingMessage: msg.content,
          conversationHistory: history,
          media: msg.media,
        })
      : await deps.generatePersonaReply({
          contactId: msg.contactId,
          contactName: msg.contactName,
          group: msg.group,
          platform: msg.platform,
          incomingMessage: msg.content,
          conversationHistory: history,
          media: msg.media,
        });

  const reply = result.reply?.trim() ?? "";
  if (result.shouldFlag || reply === "") {
    return {
      kind: "ESCALATED",
      reason: result.reason ?? (reply === "" ? "AI returned an empty reply" : "Flagged by AI engine"),
      draft: reply === "" ? null : reply,
    };
  }
  return { kind: "AI", reply, engine };
}

/** Text of the heads-up sent to Abeddy's own WhatsApp when a message is escalated. */
export function formatEscalationNotice(params: {
  contactName: string;
  reason: string;
  content: string;
  draft: string | null;
}): string {
  const preview = params.content.length > 500 ? `${params.content.slice(0, 500)}…` : params.content;
  const lines = [
    `🚩 Needs your reply — ${params.contactName}`,
    `Reason: ${params.reason}`,
    "",
    `"${preview}"`,
  ];
  if (params.draft) lines.push("", `Suggested reply: ${params.draft}`);
  return lines.join("\n");
}
