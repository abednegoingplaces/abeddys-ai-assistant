/**
 * Instagram webhook helpers (Instagram API with Instagram Login). Pure functions, no I/O.
 *
 * Meta sends DMs to POST /webhooks/instagram as:
 *   { object: "instagram", entry: [{ id, time, messaging: [{ sender:{id}, recipient:{id}, timestamp, message:{ mid, text, is_echo?, is_self? } }] }] }
 * and verifies the endpoint once with GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 */
import { createHmac, timingSafeEqual } from "crypto";

export interface InstagramTextMessage {
  /** Instagram-scoped id of the person who sent the DM. */
  senderId: string;
  /** Our professional account's id. */
  recipientId: string;
  mid: string;
  /** May be empty when the DM is only a photo, video or voice message. */
  text: string;
  /** First photo/video/audio attachment, if any. */
  attachment?: { type: "image" | "video" | "audio"; url: string };
  timestamp: number;
}

/** Answers Meta's one-time GET verification. Returns the challenge to echo back, or null to reject. */
export function verifySubscription(
  query: Record<string, unknown>,
  expectedToken: string | undefined
): string | null {
  if (!expectedToken) return null;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return null;
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

/** Checks X-Hub-Signature-256 ("sha256=<hex>") against the RAW request body. */
export function isValidSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string | undefined
): boolean {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = signatureHeader.slice("sha256=".length).toLowerCase();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/** Picks the first photo, video or audio attachment that has a download URL. */
function firstMediaAttachment(attachments: unknown): InstagramTextMessage["attachment"] {
  if (!Array.isArray(attachments)) return undefined;
  for (const a of attachments) {
    const type = (a as { type?: unknown })?.type;
    const url = (a as { payload?: { url?: unknown } })?.payload?.url;
    if ((type === "image" || type === "video" || type === "audio") && typeof url === "string" && url.startsWith("https://")) {
      return { type, url };
    }
  }
  return undefined;
}

/**
 * Extracts inbound DMs (text and/or a photo, video or voice message). Skips our own echoes,
 * self-messages, messages from our own account, deleted/unsupported messages and reactions.
 */
export function extractTextMessages(payload: unknown, ownAccountId?: string): InstagramTextMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { object?: unknown; entry?: unknown };
  if (body.object !== "instagram" || !Array.isArray(body.entry)) return [];

  const out: InstagramTextMessage[] = [];
  for (const entry of body.entry) {
    const events = (entry as { messaging?: unknown })?.messaging;
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      const e = ev as {
        sender?: { id?: unknown };
        recipient?: { id?: unknown };
        timestamp?: unknown;
        message?: { mid?: unknown; text?: unknown; attachments?: unknown; is_echo?: unknown; is_self?: unknown; is_deleted?: unknown; is_unsupported?: unknown };
      };
      const m = e.message;
      const senderId = e.sender?.id;
      const recipientId = e.recipient?.id;
      if (!m || typeof senderId !== "string" || typeof recipientId !== "string") continue;
      if (m.is_echo === true || m.is_self === true || m.is_deleted === true || m.is_unsupported === true) continue;
      if (ownAccountId && senderId === ownAccountId) continue;
      const text = typeof m.text === "string" ? m.text.trim() : "";
      const attachment = firstMediaAttachment(m.attachments);
      if (!text && !attachment) continue;
      out.push({
        senderId,
        recipientId,
        mid: typeof m.mid === "string" ? m.mid : "",
        text,
        ...(attachment ? { attachment } : {}),
        timestamp: typeof e.timestamp === "number" ? e.timestamp : Date.now(),
      });
    }
  }
  return out;
}

/** Instagram rejects message text over 1000 UTF-8 bytes; trims on a character boundary. */
export function clampToInstagramLimit(text: string, maxBytes = 1000): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  for (const ch of Array.from(text)) {
    if (Buffer.byteLength(out + ch + "…", "utf8") > maxBytes) break;
    out += ch;
  }
  return `${out}…`;
}
