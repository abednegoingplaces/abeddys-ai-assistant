import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { handleInbound } from "../pipeline/handleInbound";
import { isFromTheBot, isOwnSelfChat, neoReply, parseNeoCommand } from "../neo/command";
import { askNeo, voiceTaskForNeo } from "../neo/neoEngine";
import { createNeoDeps } from "../neo/liveDeps";
import {
  MAX_MEDIA_BYTES,
  decodedSize,
  mediaKindFor,
  mediaLabel,
  normalizeMimeType,
  type InboundMedia,
} from "../media/media";
import { env } from "../config/env";
import { shouldIgnoreChat } from "./filters";

// ─── Client Setup ────────────────────────────────────────

const LOW_MEMORY_ARGS = [
  "--disable-gpu",
  "--no-zygote",
  "--single-process",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--mute-audio",
  "--no-first-run",
  "--renderer-process-limit=1",
  "--js-flags=--max-old-space-size=192",
];

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./sessions" }),
  // Free hosts have very little CPU, so WhatsApp Web can take well over the default 30s to load.
  authTimeoutMs: 120_000,
  puppeteer: {
    // PUPPETEER_EXECUTABLE_PATH (set in the Dockerfile) points at the system Chromium.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      ...(env.CHROMIUM_LOW_MEMORY ? LOW_MEMORY_ARGS : []),
    ],
  },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
});

export default client;

// ─── QR & Client State ───────────────────────────────────

export let latestQr: string | null = null;
export let whatsappReady = false;

// ─── Event Handlers ──────────────────────────────────────

client.on("qr", (qr) => {
  latestQr = qr;
  console.log("📱 Scan this QR code to connect WhatsApp:\n");
  qrcode.generate(qr, { small: true });
  console.log(`🌐 Or visit http://localhost:${env.PORT}/api/qr`);
});

/** Abeddy's own chat ids: his phone id (…@c.us) and hidden id (…@lid). Used to find "Message yourself". */
const ownIds = new Set<string>();
/** Ids of messages the bot itself sent to Abeddy (alerts, Neo replies), so Neo never answers them. */
const sentByBot = new Set<string>();

function rememberSent(id: string): void {
  sentByBot.add(id);
  if (sentByBot.size > 500) sentByBot.delete(sentByBot.values().next().value as string);
}

client.on("ready", async () => {
  latestQr = null;
  whatsappReady = true;
  console.log("✅ WhatsApp client is ready!");

  const own = client.info?.wid?._serialized;
  if (own) {
    ownIds.add(own);
    try {
      const [ids] = await client.getContactLidAndPhone([own]);
      if (ids?.lid) ownIds.add(ids.lid);
      if (ids?.pn) ownIds.add(ids.pn);
    } catch (err) {
      console.warn("Could not look up your hidden WhatsApp id:", err instanceof Error ? err.message : err);
    }
  }
  console.log(`🤖 Neo is listening in "Message yourself" for messages starting with /neo`);
});

client.on("auth_failure", (msg) => {
  console.error("❌ WhatsApp auth failure:", msg);
});

let shuttingDown = false;
let reconnecting = false;

client.on("disconnected", async (reason) => {
  whatsappReady = false;
  console.warn("⚠️ WhatsApp disconnected:", reason);
  if (shuttingDown || reconnecting) return;
  reconnecting = true;
  if (reason === "LOGOUT") {
    console.log("🔑 This device was logged out. A new QR code will appear; scan it to link again.");
  }
  // Close the old browser fully, then start fresh. Every step is caught so a
  // half-dead browser can never crash the bot.
  try {
    await client.destroy();
  } catch (err) {
    console.warn("Could not close the old WhatsApp browser cleanly:", err instanceof Error ? err.message : err);
  }
  setTimeout(() => {
    console.log("🔄 Reconnecting WhatsApp...");
    client
      .initialize()
      .catch((err) => console.error("❌ WhatsApp reconnect failed:", err instanceof Error ? err.message : err))
      .finally(() => {
        reconnecting = false;
      });
  }, 5000);
});

// ─── Message Handler ─────────────────────────────────────

/**
 * Sends an alert to Abeddy's own "Message yourself" chat (or OWNER_WID if set).
 * Used by every channel. The bot ignores its own messages, so alerts never trigger replies.
 */
export async function notifyOwner(text: string): Promise<void> {
  const target = env.OWNER_WID || client.info?.wid?._serialized;
  if (!target || !whatsappReady) {
    console.warn("⚠️ Could not alert Abeddy: WhatsApp isn't connected yet");
    return;
  }
  try {
    const sent = await client.sendMessage(target, text);
    rememberSent(sent.id._serialized);
  } catch (err) {
    console.warn("Could not notify owner of escalation:", err);
  }
}

/**
 * Turns a WhatsApp message into text + optional media. Photos, videos, voice notes and
 * stickers are downloaded so the AI can see or hear them. Files that are too big are
 * described by their label only. Documents and other attachments are ignored.
 */
async function readMessage(msg: Message): Promise<{ content: string; media?: InboundMedia }> {
  const caption = msg.body ?? "";
  if (!msg.hasMedia || msg.type === "document") return { content: caption.trim() };

  try {
    const file = await msg.downloadMedia();
    const kind = file ? mediaKindFor(file.mimetype, msg.type === "sticker") : null;
    if (!file || !kind) return { content: caption.trim() };

    const content = mediaLabel(kind, caption);
    if (decodedSize(file.data) > MAX_MEDIA_BYTES) {
      console.log(`📎 ${kind} from ${msg.from} is too big to view; replying from the caption only`);
      return { content };
    }
    return { content, media: { kind, mimeType: normalizeMimeType(file.mimetype), base64: file.data } };
  } catch (err) {
    console.warn("Could not download media:", err instanceof Error ? err.message : err);
    return { content: caption.trim() };
  }
}

// ─── Neo (Abeddy's assistant in "Message yourself") ──────

const neoDeps = createNeoDeps(async (key) => {
  const contact = await client.getContactById(key);
  return contact.name || contact.pushname || null;
});

client.on("message_create", async (msg: Message) => {
  try {
    const chatId = (msg.id as { remote?: string }).remote ?? msg.to;
    // A message the bot sent to itself (an alert) tells us another id for the self-chat.
    if (msg.fromMe && msg.from === msg.to && chatId && ownIds.has(msg.to) === false && msg.to.endsWith("@lid")) {
      ownIds.add(msg.to);
    }
    if (!isOwnSelfChat(msg.fromMe, chatId, ownIds)) return;
    if (isFromTheBot(msg.body ?? "", sentByBot, msg.id._serialized)) return;

    let task = parseNeoCommand(msg.body ?? "");
    let media: InboundMedia | undefined;

    const isVoice = msg.type === "ptt" || msg.type === "audio";
    if (task === null && isVoice) {
      // Voice notes can't have a caption: Neo listens and only acts if you said "Neo" first.
      media = (await readMessage(msg)).media;
      task = media ? await voiceTaskForNeo(media) : null;
      media = undefined;
    } else if (task !== null && msg.hasMedia) {
      media = (await readMessage(msg)).media;
    }
    if (task === null) return;

    console.log(`🤖 Neo task: "${task.slice(0, 60)}"${media ? ` [+${media.kind}]` : ""}`);
    const answer = await askNeo(task || "Say hi, and in a few lines say what you can do for me.", neoDeps, media);
    const sent = await client.sendMessage(chatId, neoReply(answer));
    rememberSent(sent.id._serialized);
  } catch (error) {
    console.error("❌ Neo couldn't handle that message:", error);
  }
});

// ─── Auto-replies to everyone else ───────────────────────

client.on("message", async (msg: Message) => {
  try {
    // Groups, status updates and broadcasts are never answered.
    if (shouldIgnoreChat(msg.from)) return;
    // Our own messages (including escalation notices to OWNER_WID) are ignored.
    if (msg.fromMe) return;

    const { content, media } = await readMessage(msg);
    if (!content) return;

    await handleInbound(
      {
        platform: "WHATSAPP",
        senderKey: msg.from,
        content,
        media,
        resolveDisplayName: async () => {
          const contact = await msg.getContact();
          return contact.name || contact.pushname || null;
        },
      },
      {
        send: async (text) => {
          await msg.reply(text);
        },
        markSeen: async () => {
          const chat = await msg.getChat();
          await chat.sendSeen();
        },
        notifyOwner,
      }
    );
  } catch (error) {
    console.error("❌ Error processing incoming WhatsApp message:", error);
  }
});

// ─── Initialization ──────────────────────────────────────

export async function initWhatsApp(): Promise<void> {
  console.log("🔄 Initializing WhatsApp client...");
  await client.initialize();
}

export async function shutdownWhatsApp(): Promise<void> {
  shuttingDown = true;
  whatsappReady = false;
  await client.destroy();
}
