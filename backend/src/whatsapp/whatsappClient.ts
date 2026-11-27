import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { generateReply } from "../ai/personaEngine";
import { generateTutorReply } from "../ai/tutorEngine";
import { checkMessageSafety } from "../safety/liveSafety";
import { decideReply, formatEscalationNotice, type PipelineDeps } from "../pipeline/decideReply";
import prisma from "../lib/prisma";
import { incrementReplyCount } from "../lib/redis";
import { env } from "../config/env";
import { shouldIgnoreChat } from "./filters";

// ─── Client Setup ────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./sessions" }),
  puppeteer: {
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
});

export default client;

// ─── QR & Client State ───────────────────────────────────

export let latestQr: string | null = null;
export let whatsappReady = false;

// ─── Utilities ───────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minSec: number, maxSec: number): number {
  return (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;
}

// ─── Event Handlers ──────────────────────────────────────

client.on("qr", (qr) => {
  latestQr = qr;
  console.log("📱 Scan this QR code to connect WhatsApp:\n");
  qrcode.generate(qr, { small: true });
  console.log(`🌐 Or visit http://localhost:${env.PORT}/api/qr`);
});

client.on("ready", () => {
  latestQr = null;
  whatsappReady = true;
  console.log("✅ WhatsApp client is ready!");
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
  console.log("🔄 Attempting reconnect in 5 seconds...");
  // Tear down the old browser before re-initializing to avoid orphaned Chromium processes.
  try {
    await client.destroy();
  } catch (err) {
    console.warn("Could not destroy client cleanly:", err);
  }
  setTimeout(() => {
    client
      .initialize()
      .catch((err) => console.error("❌ Reinitialization error:", err))
      .finally(() => {
        reconnecting = false;
      });
  }, 5000);
});

// ─── Message Handler ─────────────────────────────────────

const pipelineDepsFor = (contactId: string, inboundId: string): Omit<PipelineDeps, "checkSafety"> => ({
  getActiveRules: () =>
    prisma.rule.findMany({ where: { isActive: true }, orderBy: { priority: "desc" } }),
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
});

async function notifyOwner(text: string): Promise<void> {
  if (!env.OWNER_WID) return;
  try {
    await client.sendMessage(env.OWNER_WID, text);
  } catch (err) {
    console.warn("Could not notify owner of escalation:", err);
  }
}

client.on("message", async (msg: Message) => {
  try {
    // Ignore group messages and status/broadcast updates
    if (shouldIgnoreChat(msg.from)) return;

    // Ignore self messages (this also covers escalation notices sent to OWNER_WID)
    if (msg.fromMe) return;

    const phoneOrUsername = msg.from;
    const messageBody = msg.body;

    if (!messageBody || messageBody.trim().length === 0) return;

    // ── 1. Get or create Contact ────────────────────────
    let contact = await prisma.contact.findFirst({
      where: { phoneOrUsername, platform: "WHATSAPP" },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          phoneOrUsername,
          platform: "WHATSAPP",
          group: "UNKNOWN",
          mode: "IMPERSONATOR",
        },
      });
      console.log(`📇 New contact created: ${phoneOrUsername} [Mode: IMPERSONATOR]`);
    }

    // ── 2. Log Inbound Message ──────────────────────────
    const savedInboundMessage = await prisma.message.create({
      data: {
        contactId: contact.id,
        direction: "INBOUND",
        content: messageBody,
        platform: "WHATSAPP",
      },
    });

    const contactName = contact.displayName || phoneOrUsername.replace(/@c\.us$/, "");

    // ── 3. Decide: safety gate → keyword rules → AI engine ──
    const decision = await decideReply(
      {
        contactId: contact.id,
        contactName,
        group: contact.group,
        mode: contact.mode,
        platform: "WHATSAPP",
        content: messageBody,
      },
      { checkSafety: checkMessageSafety, ...pipelineDepsFor(contact.id, savedInboundMessage.id) }
    );

    if (decision.kind === "BLOCKED") {
      console.log(`🚫 [${phoneOrUsername}] Safety check blocked reply: ${decision.reason}`);
      return;
    }

    if (decision.kind === "ESCALATED") {
      console.log(`🚩 [${phoneOrUsername}] Escalated for review: ${decision.reason}`);
      await prisma.autoReply.create({
        data: {
          messageId: savedInboundMessage.id,
          contactId: contact.id,
          generatedReply: decision.draft ?? `[FLAGGED — no reply sent] ${decision.reason}`,
          wasSent: false,
        },
      });
      await notifyOwner(
        formatEscalationNotice({
          contactName,
          reason: decision.reason,
          content: messageBody,
          draft: decision.draft,
        })
      );
      return;
    }

    // ── 4. Send reply (rule or AI) & log it ─────────────
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const minDelay = settings?.minDelaySeconds ?? 3;
    const maxDelay = settings?.maxDelaySeconds ?? 15;

    try {
      const chat = await msg.getChat();
      await chat.sendSeen();
    } catch (err) {
      console.warn("Could not mark message as seen:", err);
    }
    await sleep(randomDelay(minDelay, Math.max(minDelay, maxDelay)));

    await msg.reply(decision.reply);

    await prisma.message.create({
      data: {
        contactId: contact.id,
        direction: "OUTBOUND",
        content: decision.reply,
        platform: "WHATSAPP",
      },
    });
    await prisma.autoReply.create({
      data: {
        messageId: savedInboundMessage.id,
        contactId: contact.id,
        generatedReply: decision.reply,
        wasSent: true,
      },
    });
    await incrementReplyCount(contact.id);

    const source = decision.kind === "RULE" ? `rule "${decision.keyword}"` : `${decision.engine} engine`;
    console.log(`💬 [${phoneOrUsername}] Replied via ${source}: "${decision.reply}"`);
  } catch (error) {
    console.error("❌ Error processing incoming message:", error);
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
