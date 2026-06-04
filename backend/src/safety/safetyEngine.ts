import prisma from "../lib/prisma";
import { getReplyCount } from "../lib/redis";

interface SafetyCheckResult {
  shouldReply: boolean;
  reason: string;
}

/**
 * Runs a series of safety checks to determine whether the bot should reply.
 * Checks are evaluated in order; the first failing check short-circuits.
 */
export async function checkShouldReply(
  contactId: string,
  platform: string,
  messageContent: string
): Promise<SafetyCheckResult> {
  // Fetch settings (singleton row with id = 1)
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  if (!settings) {
    return { shouldReply: false, reason: "Settings not configured" };
  }

  // ── Rule A: Kill switch ──────────────────────────────
  if (settings.killSwitch) {
    return { shouldReply: false, reason: "Kill switch is active" };
  }

  // ── Rule B: Blackout hours ───────────────────────────
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = settings.blackoutStart.split(":").map(Number);
  const [endH, endM] = settings.blackoutEnd.split(":").map(Number);
  const blackoutStartMinutes = startH * 60 + startM;
  const blackoutEndMinutes = endH * 60 + endM;

  if (blackoutStartMinutes <= blackoutEndMinutes) {
    // Same-day blackout (e.g., 01:00 – 06:00)
    if (currentMinutes >= blackoutStartMinutes && currentMinutes < blackoutEndMinutes) {
      return {
        shouldReply: false,
        reason: `Blackout hours (${settings.blackoutStart} – ${settings.blackoutEnd})`,
      };
    }
  } else {
    // Overnight blackout (e.g., 23:00 – 06:00)
    if (currentMinutes >= blackoutStartMinutes || currentMinutes < blackoutEndMinutes) {
      return {
        shouldReply: false,
        reason: `Blackout hours (${settings.blackoutStart} – ${settings.blackoutEnd})`,
      };
    }
  }

  // ── Rule C: Daily reply limit ────────────────────────
  const replyCount = await getReplyCount(contactId);
  if (replyCount >= settings.dailyReplyLimit) {
    return {
      shouldReply: false,
      reason: `Daily reply limit reached (${replyCount}/${settings.dailyReplyLimit})`,
    };
  }

  // ── Rule D: Message contains a URL ───────────────────
  const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+/i;
  if (urlPattern.test(messageContent)) {
    return { shouldReply: false, reason: "Message contains a URL" };
  }

  // ── Rule E: Message too short ────────────────────────
  if (messageContent.trim().length < 3) {
    return { shouldReply: false, reason: "Message is too short (under 3 characters)" };
  }

  // ── All checks passed ───────────────────────────────
  return { shouldReply: true, reason: "All safety checks passed" };
}
