/** Production wiring of the safety gate to Postgres (settings) and Redis (daily counts). */
import prisma from "../lib/prisma";
import { getReplyCount } from "../lib/redis";
import { env } from "../config/env";
import { createSafetyEngine } from "./safetyEngine";

export const checkMessageSafety = createSafetyEngine({
  getSettings: () => prisma.settings.findUnique({ where: { id: 1 } }),
  getReplyCount,
  timeZone: env.TZ,
});
