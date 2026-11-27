/**
 * Neo for everyone: anyone chatting with Abeddy can ask Neo a question with "/neo …".
 * Neo answers openly as his AI assistant ("🤖 Neo: …"), quoting their message.
 * For other people Neo can ONLY answer questions: it has no tools, so it can never read
 * Abeddy's chats, see his contacts or change settings.
 */
import prisma from "../lib/prisma";
import { env } from "../config/env";
import { startOfDayInTimeZone } from "../lib/replyCounter";
import { isWithinBlackoutHours } from "../safety/rules/hardSafety";
import { isLocationInquiry, isMoneyRequest } from "../safety/rules/escalation";
import { formatEscalationNotice } from "../pipeline/decideReply";
import { getOrCreateContact } from "../pipeline/handleInbound";
import type { ContactGroup, Platform } from "../safety/types";
import type { InboundMedia } from "../media/media";
import { askPublicNeo } from "./neoEngine";

export const PUBLIC_NEO_DAILY_LIMIT = 10;
export const PUBLIC_NEO_MARK = "🤖 Neo:";

export type PublicNeoAction =
  | { action: "ignore"; reason: string } // stay silent, no alert
  | { action: "alert"; reason: string } // stay silent (left on "delivered"), alert Abeddy
  | { action: "limit" } // tell them they've hit today's limit
  | { action: "answer" };

/** Decides what to do with someone else's "/neo" question. Pure, so it's easy to test. */
export function decidePublicNeo(p: {
  group: ContactGroup;
  autoRepliesOn: boolean;
  inBlackout: boolean;
  usedToday: number;
  question: string;
}): PublicNeoAction {
  if (!p.autoRepliesOn) return { action: "ignore", reason: "Auto-replies are off" };
  if (p.inBlackout) return { action: "ignore", reason: "Blackout hours" };
  if (p.group === "CLIENT") return { action: "alert", reason: "A client asked Neo a question" };
  if (isMoneyRequest(p.question).isRequest) return { action: "alert", reason: "Money request sent to Neo" };
  if (isLocationInquiry(p.question)) return { action: "alert", reason: "Location question sent to Neo" };
  if (p.usedToday >= PUBLIC_NEO_DAILY_LIMIT) return { action: "limit" };
  return { action: "answer" };
}

export interface PublicNeoChannel {
  /** Replies in their chat, quoting their message. */
  reply(text: string): Promise<void>;
  notifyOwner(text: string): Promise<void>;
}

export async function handlePublicNeo(
  input: {
    platform: Platform;
    senderKey: string;
    question: string;
    /** What they actually sent, for the database ("/neo …"). */
    content: string;
    media?: InboundMedia;
    resolveDisplayName?: () => Promise<string | null>;
  },
  channel: PublicNeoChannel
): Promise<PublicNeoAction> {
  const contact = await getOrCreateContact(input.platform, input.senderKey, input.resolveDisplayName);
  const name = contact.displayName || `…${input.senderKey.split("@")[0].slice(-4)}`;
  const tag = `[${input.platform} ${name}]`;

  await prisma.message.create({
    data: { contactId: contact.id, direction: "INBOUND", content: input.content, platform: input.platform },
  });

  const now = new Date();
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const usedToday = await prisma.message.count({
    where: {
      contactId: contact.id,
      direction: "OUTBOUND",
      content: { startsWith: PUBLIC_NEO_MARK },
      createdAt: { gte: startOfDayInTimeZone(now, env.TZ) },
    },
  });

  let inBlackout = false;
  try {
    inBlackout = settings ? isWithinBlackoutHours(now, settings.blackoutStart, settings.blackoutEnd, env.TZ) : false;
  } catch {
    inBlackout = true; // malformed settings: stay quiet, like the auto-replies
  }

  const decision = decidePublicNeo({
    group: contact.group,
    autoRepliesOn: !!settings && !settings.killSwitch,
    inBlackout,
    usedToday,
    question: input.question,
  });

  if (decision.action === "ignore") {
    console.log(`🤖 ${tag} Neo stayed quiet: ${decision.reason}`);
    return decision;
  }
  if (decision.action === "alert") {
    console.log(`🚩 ${tag} Neo question held for Abeddy: ${decision.reason}`);
    await channel.notifyOwner(formatEscalationNotice({ contactName: name, reason: decision.reason, content: input.content }));
    return decision;
  }

  const text =
    decision.action === "limit"
      ? `${PUBLIC_NEO_MARK} You've reached today's limit of ${PUBLIC_NEO_DAILY_LIMIT} questions. Try again tomorrow 🙂`
      : `${PUBLIC_NEO_MARK} ${await askPublicNeo(input.question, name, input.media)}`;

  await channel.reply(text);
  await prisma.message.create({
    data: { contactId: contact.id, direction: "OUTBOUND", content: text, platform: input.platform },
  });
  console.log(`🤖 ${tag} Neo answered (${usedToday + 1}/${PUBLIC_NEO_DAILY_LIMIT} today)`);
  return decision;
}
