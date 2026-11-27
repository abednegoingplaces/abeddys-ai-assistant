/**
 * Platform-agnostic handling of one inbound message: store it, run the decision pipeline
 * (safety gate → keyword rules → AI), then either escalate or send the reply and log it.
 *
 * WhatsApp and Instagram both call this, so every channel goes through the same gate.
 */
import { generateReply } from "../ai/personaEngine";
import { generateTutorReply } from "../ai/tutorEngine";
import { checkMessageSafety } from "../safety/liveSafety";
import prisma from "../lib/prisma";
import type { Platform } from "../safety/types";
import type { InboundMedia } from "../media/media";
import { decideReply, formatEscalationNotice, type PipelineDeps, type ReplyDecision } from "./decideReply";

export interface Channel {
  /** Sends the reply to the sender. Throws on failure. */
  send(text: string): Promise<void>;
  /** Optional read receipt before replying. */
  markSeen?(): Promise<void>;
  /** Heads-up to Abeddy about an escalated message. */
  notifyOwner(text: string): Promise<void>;
}

export interface InboundInput {
  platform: Platform;
  /** WhatsApp id (e.g. 2547…@c.us) or Instagram-scoped id (IGSID). */
  senderKey: string;
  /** Message text. For media this is a label plus caption, e.g. "[photo] nice?". */
  content: string;
  media?: InboundMedia;
  /** Looked up lazily, only for brand-new contacts. */
  resolveDisplayName?: () => Promise<string | null>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomDelayMs = (minSec: number, maxSec: number) =>
  (Math.floor(Math.random() * (Math.max(minSec, maxSec) - minSec + 1)) + minSec) * 1000;

function pipelineDepsFor(contactId: string, inboundId: string): Omit<PipelineDeps, "checkSafety"> {
  return {
    getActiveRules: () => prisma.rule.findMany({ where: { isActive: true }, orderBy: { priority: "desc" } }),
    getHistory: async () => {
      const recent = await prisma.message.findMany({
        where: { contactId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return recent
        .reverse()
        .filter((m) => m.id !== inboundId)
        .map((m) => ({
          role: (m.direction === "INBOUND" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        }));
    },
    generatePersonaReply: generateReply,
    generateTutorReply,
  };
}

/** Finds the sender in the database, or saves them as a new UNKNOWN contact. */
export async function getOrCreateContact(
  platform: Platform,
  senderKey: string,
  resolveDisplayName?: () => Promise<string | null>
) {
  const existing = await prisma.contact.findFirst({ where: { phoneOrUsername: senderKey, platform } });
  if (existing) return existing;
  const displayName = resolveDisplayName ? await resolveDisplayName().catch(() => null) : null;
  const contact = await prisma.contact.create({
    data: { phoneOrUsername: senderKey, platform, group: "UNKNOWN", mode: "IMPERSONATOR", displayName },
  });
  console.log(`📇 New ${platform} contact: ${displayName ?? senderKey} [UNKNOWN, IMPERSONATOR]`);
  return contact;
}

export async function handleInbound(input: InboundInput, channel: Channel): Promise<ReplyDecision> {
  const { platform, senderKey, content } = input;
  const tag = `[${platform} ${senderKey}]`;

  // ── 1. Get or create the contact ──────────────────────
  const contact = await getOrCreateContact(platform, senderKey, input.resolveDisplayName);

  // ── 2. Log the inbound message ────────────────────────
  const inbound = await prisma.message.create({
    data: { contactId: contact.id, direction: "INBOUND", content, platform },
  });

  const contactName = contact.displayName || senderKey.replace(/@c\.us$/, "");

  // ── 3. Decide ─────────────────────────────────────────
  const decision = await decideReply(
    { contactId: contact.id, contactName, group: contact.group, mode: contact.mode, platform, content, media: input.media },
    { checkSafety: checkMessageSafety, ...pipelineDepsFor(contact.id, inbound.id) }
  );

  if (decision.kind === "BLOCKED") {
    console.log(`🚫 ${tag} Blocked: ${decision.reason}`);
    return decision;
  }

  if (decision.kind === "ESCALATED") {
    console.log(`🚩 ${tag} Escalated: ${decision.reason}`);
    await prisma.autoReply.create({
      data: {
        messageId: inbound.id,
        contactId: contact.id,
        generatedReply: decision.draft ?? `[FLAGGED — no reply sent] ${decision.reason}`,
        wasSent: false,
      },
    });
    await channel.notifyOwner(
      formatEscalationNotice({
        contactName: platform === "INSTAGRAM" ? `${contactName} (Instagram)` : contactName,
        reason: decision.reason,
        content,
      })
    );
    return decision;
  }

  // ── 4. Send the reply and log it ──────────────────────
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (channel.markSeen) {
    await channel.markSeen().catch((err) => console.warn(`${tag} Could not mark as seen:`, err));
  }
  await sleep(randomDelayMs(settings?.minDelaySeconds ?? 3, settings?.maxDelaySeconds ?? 15));

  await channel.send(decision.reply);

  await prisma.message.create({
    data: { contactId: contact.id, direction: "OUTBOUND", content: decision.reply, platform },
  });
  await prisma.autoReply.create({
    // This row is also what the daily reply limit counts (lib/replyCounter.ts).
    data: { messageId: inbound.id, contactId: contact.id, generatedReply: decision.reply, wasSent: true },
  });

  if (decision.kind === "AI" && decision.alert) {
    console.log(`🔔 ${tag} Replied and alerted Abeddy: ${decision.alert}`);
    await channel.notifyOwner(
      formatEscalationNotice({
        contactName: platform === "INSTAGRAM" ? `${contactName} (Instagram)` : contactName,
        reason: decision.alert,
        content,
        replied: decision.reply,
      })
    );
  }

  const source = decision.kind === "RULE" ? `rule "${decision.keyword}"` : `${decision.engine} engine`;
  console.log(`💬 ${tag} Replied via ${source}: "${decision.reply}"`);
  return decision;
}
