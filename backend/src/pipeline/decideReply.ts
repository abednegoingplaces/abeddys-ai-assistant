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
  /** alert is set when the bot answered but Abeddy should still look (meetups, favours, work…). */
  | { kind: "AI"; reply: string; engine: "PERSONA" | "TUTOR"; alert?: string };

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
  // The bot couldn't produce an answer: stay silent (message stays "delivered") and alert Abeddy.
  if (reply === "") {
    return { kind: "ESCALATED", reason: result.reason ?? "The bot couldn't work out a reply", draft: null };
  }
  // The bot answered what it safely could, but Abeddy should still look.
  if (result.shouldFlag) {
    return { kind: "AI", reply, engine, alert: result.reason ?? "Needs your attention" };
  }
  return { kind: "AI", reply, engine };
}

/** Text of the alert sent to Abeddy's "Message yourself" chat. */
export function formatEscalationNotice(params: {
  contactName: string;
  reason: string;
  content: string;
  /** What the bot already replied, if it answered. */
  replied?: string | null;
}): string {
  const preview = params.content.length > 500 ? `${params.content.slice(0, 500)}…` : params.content;
  const lines = [
    `🚩 ${params.replied ? "Check this chat" : "Needs your reply"} — ${params.contactName}`,
    `Reason: ${params.reason}`,
    "",
    `They said: "${preview}"`,
    "",
    params.replied ? `Bot replied: "${params.replied}"` : "Bot did not reply (it still shows as delivered).",
  ];
  return lines.join("\n");
}
