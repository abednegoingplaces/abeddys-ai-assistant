/** Connects Neo's tools to the real database. */
import prisma from "../lib/prisma";
import { env } from "../config/env";
import { startOfDayInTimeZone } from "../lib/replyCounter";
import type { NeoDeps } from "./tools";

/**
 * @param resolveName looks up a contact's WhatsApp name for contacts saved without one
 *                    (passed in by the WhatsApp client to avoid a circular import).
 */
export function createNeoDeps(resolveName?: (key: string) => Promise<string | null>): NeoDeps {
  return {
    async listContacts() {
      const rows = await prisma.contact.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
      if (resolveName) {
        for (const c of rows.filter((r) => !r.displayName && r.platform === "WHATSAPP").slice(0, 25)) {
          const name = await resolveName(c.phoneOrUsername).catch(() => null);
          if (name) {
            c.displayName = name;
            await prisma.contact.update({ where: { id: c.id }, data: { displayName: name } });
          }
        }
      }
      return rows.map((c) => ({
        id: c.id,
        key: c.phoneOrUsername,
        platform: c.platform,
        displayName: c.displayName,
        group: c.group,
        mode: c.mode,
      }));
    },

    async recentMessages(since, contactId) {
      const rows = await prisma.message.findMany({
        where: { createdAt: { gte: since }, ...(contactId ? { contactId } : {}) },
        orderBy: { createdAt: "asc" },
        take: 300,
        include: { contact: { select: { displayName: true, phoneOrUsername: true } } },
      });
      return rows.map((m) => ({
        contactName: m.contact.displayName ?? `…${m.contact.phoneOrUsername.split("@")[0].slice(-4)}`,
        direction: m.direction,
        content: m.content,
        createdAt: m.createdAt,
      }));
    },

    async updateContact(id, data) {
      await prisma.contact.update({ where: { id }, data });
    },

    async setAutoReplies(enabled) {
      await prisma.settings.update({ where: { id: 1 }, data: { killSwitch: !enabled } });
    },

    async getStatus() {
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      const since = startOfDayInTimeZone(new Date(), env.TZ);
      const [repliesToday, alertsToday] = await Promise.all([
        prisma.autoReply.count({ where: { wasSent: true, createdAt: { gte: since } } }),
        prisma.autoReply.count({ where: { wasSent: false, createdAt: { gte: since } } }),
      ]);
      return {
        autoRepliesOn: settings ? !settings.killSwitch : false,
        blackout: settings ? `${settings.blackoutStart}–${settings.blackoutEnd}` : "unknown",
        repliesToday,
        alertsToday,
      };
    },

    now: () => new Date(),
    timeZone: env.TZ,
  };
}
