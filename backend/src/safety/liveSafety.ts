/** Production wiring of the safety gate to the database (settings and today's reply count). */
import prisma from "../lib/prisma";
import { getReplyCount } from "../lib/replyCounter";
import { env } from "../config/env";
import { createSafetyEngine } from "./safetyEngine";

export const checkMessageSafety = createSafetyEngine({
  getSettings: () => prisma.settings.findUnique({ where: { id: 1 } }),
  getReplyCount: (contactId) => getReplyCount(contactId),
  timeZone: env.TZ,
});
