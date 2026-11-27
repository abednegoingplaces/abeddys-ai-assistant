/**
 * Neo's tools: the only things Neo can *do*, besides answering and writing.
 * Gemini decides when to call them; our code runs them. Data access is injected (NeoDeps)
 * so every tool can be unit-tested without a database.
 */
import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import type { ContactGroup, ContactMode } from "../safety/types";

export interface ContactRow {
  id: string;
  key: string; // WhatsApp id or Instagram id
  platform: string;
  displayName: string | null;
  group: ContactGroup;
  mode: ContactMode;
}

export interface MessageRow {
  contactName: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  createdAt: Date;
}

export interface NeoDeps {
  listContacts(): Promise<ContactRow[]>;
  /** Messages since `since`, oldest first; optionally only one contact's. */
  recentMessages(since: Date, contactId?: string): Promise<MessageRow[]>;
  updateContact(id: string, data: { group?: ContactGroup; mode?: ContactMode }): Promise<void>;
  setAutoReplies(enabled: boolean): Promise<void>;
  getStatus(): Promise<{ autoRepliesOn: boolean; blackout: string; repliesToday: number; alertsToday: number }>;
  now(): Date;
  timeZone: string;
}

const GROUPS: ContactGroup[] = ["FRIENDS", "FAMILY", "COLLEAGUES", "CLIENT", "UNKNOWN"];
const MODES: ContactMode[] = ["IMPERSONATOR", "TUTOR"];

export const NEO_TOOLS: FunctionDeclaration[] = [
  {
    name: "find_contacts",
    description: "Search Abeddy's contacts by name or number. Use before changing a contact.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { query: { type: SchemaType.STRING, description: "Name or part of a number" } },
      required: ["query"],
    },
  },
  {
    name: "read_messages",
    description:
      "Read recent messages the bot handled (what people sent and what the bot replied). Leave contact empty for everyone.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        contact: { type: SchemaType.STRING, description: "Contact name or number (optional)" },
        hours: { type: SchemaType.NUMBER, description: "How many hours back to look (default 24, max 168)" },
      },
    },
  },
  {
    name: "set_contact_group",
    description:
      "Change how the bot treats a contact. FRIENDS/FAMILY/COLLEAGUES get Abeddy's style, UNKNOWN gets polite replies, CLIENT is never auto-answered.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        contact: { type: SchemaType.STRING, description: "Contact name or number" },
        group: { type: SchemaType.STRING, format: "enum", enum: GROUPS },
      },
      required: ["contact", "group"],
    },
  },
  {
    name: "set_contact_mode",
    description: "IMPERSONATOR = the bot replies as Abeddy. TUTOR = an AI study helper that says it's an AI.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        contact: { type: SchemaType.STRING, description: "Contact name or number" },
        mode: { type: SchemaType.STRING, format: "enum", enum: MODES },
      },
      required: ["contact", "mode"],
    },
  },
  {
    name: "set_auto_replies",
    description: "Turn the bot's automatic replies to other people on or off (the kill switch).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { enabled: { type: SchemaType.BOOLEAN, description: "true = replies on, false = replies off" } },
      required: ["enabled"],
    },
  },
  {
    name: "bot_status",
    description: "Whether auto-replies are on, blackout hours, and how many replies and alerts there were today.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
];

// ─── helpers ─────────────────────────────────────────────

export function contactLabel(c: ContactRow): string {
  const tail = c.key.split("@")[0].slice(-4);
  return c.displayName ? `${c.displayName} (…${tail})` : `…${tail}`;
}

/** Contacts whose name contains the query, or whose number/id contains it. */
export function matchContacts(query: string, contacts: ContactRow[]): ContactRow[] {
  const q = query.trim().toLowerCase().replace(/^\+/, "");
  if (!q) return [];
  const exact = contacts.filter((c) => (c.displayName ?? "").toLowerCase() === q);
  if (exact.length) return exact;
  return contacts.filter(
    (c) => (c.displayName ?? "").toLowerCase().includes(q) || c.key.split("@")[0].includes(q.replace(/\s/g, ""))
  );
}

function startOfLookback(now: Date, hours: unknown): Date {
  const h = typeof hours === "number" && hours > 0 ? Math.min(hours, 168) : 24;
  return new Date(now.getTime() - h * 3600_000);
}

function fmtTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

type Result = Record<string, unknown>;

/** Resolves a contact name to exactly one contact, or explains why it can't. */
async function oneContact(deps: NeoDeps, query: unknown): Promise<ContactRow | Result> {
  if (typeof query !== "string" || !query.trim()) return { error: "Which contact?" };
  const found = matchContacts(query, await deps.listContacts());
  if (found.length === 0) return { error: `No contact matches "${query}". Ask Abeddy for their name as saved, or part of their number.` };
  if (found.length > 1) return { error: "More than one contact matches; ask Abeddy which one.", matches: found.slice(0, 8).map(contactLabel) };
  return found[0];
}

const isContact = (x: ContactRow | Result): x is ContactRow => typeof (x as ContactRow).id === "string";

// ─── executor ────────────────────────────────────────────

export async function runNeoTool(name: string, args: Record<string, unknown>, deps: NeoDeps): Promise<Result> {
  switch (name) {
    case "find_contacts": {
      const found = matchContacts(String(args.query ?? ""), await deps.listContacts());
      return { count: found.length, contacts: found.slice(0, 15).map((c) => ({ contact: contactLabel(c), group: c.group, mode: c.mode, platform: c.platform })) };
    }

    case "read_messages": {
      const since = startOfLookback(deps.now(), args.hours);
      let contactId: string | undefined;
      if (typeof args.contact === "string" && args.contact.trim()) {
        const c = await oneContact(deps, args.contact);
        if (!isContact(c)) return c;
        contactId = c.id;
      }
      const rows = await deps.recentMessages(since, contactId);
      const last = rows.slice(-60);
      return {
        note: "Only messages the bot handled are stored, not Abeddy's own manual replies or group chats.",
        count: rows.length,
        messages: last.map((m) => ({
          when: fmtTime(m.createdAt, deps.timeZone),
          contact: m.contactName,
          from: m.direction === "INBOUND" ? "them" : "bot",
          text: m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content,
        })),
      };
    }

    case "set_contact_group": {
      const group = String(args.group ?? "").toUpperCase() as ContactGroup;
      if (!GROUPS.includes(group)) return { error: `Group must be one of ${GROUPS.join(", ")}` };
      const c = await oneContact(deps, args.contact);
      if (!isContact(c)) return c;
      await deps.updateContact(c.id, { group });
      return { done: true, contact: contactLabel(c), group };
    }

    case "set_contact_mode": {
      const mode = String(args.mode ?? "").toUpperCase() as ContactMode;
      if (!MODES.includes(mode)) return { error: `Mode must be one of ${MODES.join(", ")}` };
      const c = await oneContact(deps, args.contact);
      if (!isContact(c)) return c;
      await deps.updateContact(c.id, { mode });
      return { done: true, contact: contactLabel(c), mode };
    }

    case "set_auto_replies": {
      const enabled = args.enabled === true;
      await deps.setAutoReplies(enabled);
      return { done: true, autoReplies: enabled ? "on" : "off" };
    }

    case "bot_status":
      return deps.getStatus();

    default:
      return { error: `Unknown tool ${name}` };
  }
}
