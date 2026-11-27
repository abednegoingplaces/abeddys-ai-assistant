/**
 * Daily reply counter for the safety gate's "max replies per contact per day" rule.
 *
 * Every reply the bot sends is already saved as an AutoReply row (wasSent = true),
 * so "replies today" is simply a count of those rows since midnight in the bot's timezone.
 * No extra service (like Redis) is needed.
 */
import prisma from "./prisma";
import { env } from "../config/env";

/** The instant of the most recent local midnight in `timeZone` (e.g. "Africa/Nairobi"). */
export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const y = Number(parts.year);
  const m = Number(parts.month) - 1;
  const d = Number(parts.day);
  // How far the zone's wall clock is ahead of UTC right now.
  const wallClockAsUtc = Date.UTC(y, m, d, Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMs = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(y, m, d) - offsetMs);
}

/** Replies the bot has sent to this contact since local midnight. */
export async function getReplyCount(contactId: string, now: Date = new Date()): Promise<number> {
  return prisma.autoReply.count({
    where: {
      contactId,
      wasSent: true,
      createdAt: { gte: startOfDayInTimeZone(now, env.TZ) },
    },
  });
}
