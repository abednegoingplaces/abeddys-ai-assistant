import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { generateReply } from "../ai/personaEngine";
import { generateTutorReply } from "../ai/tutorEngine";
import { checkShouldReply } from "../safety/safetyEngine";
import prisma from "../lib/prisma";
import { incrementReplyCount } from "../lib/redis";

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
  console.log(`🌐 Or visit http://localhost:${process.env.PORT || 3001}/api/qr`);
});

client.on("ready", () => {
  latestQr = null;
  whatsappReady = true;
  console.log("✅ WhatsApp client is ready!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ WhatsApp auth failure:", msg);
});

client.on("disconnected", (reason) => {
  console.warn("⚠️ WhatsApp disconnected:", reason);
  console.log("🔄 Attempting reconnect in 5 seconds...");
  setTimeout(() => {
    client.initialize().catch((err) => {
      console.error("❌ Reinitialization error:", err);
    });
  }, 5000);
});

// ─── Message Handler ─────────────────────────────────────

client.on("message", async (msg: Message) => {
  try {
    // Ignore group messages
    if (msg.from.includes("@g.us")) return;

    // Ignore self messages
    if (msg.fromMe) return;

    const phoneOrUsername = msg.from;
    const messageBody = msg.body;

    if (!messageBody || messageBody.trim().length === 0) return;

    // ── 1. Get or create Contact ────────────────────────
    let contact = await prisma.contact.findFirst({
      where: {
        phoneOrUsername,
        platform: "WHATSAPP",
      },
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

    // ── 3. Run Safety Checks ─────────────────────────────
    const safetyResult = await checkShouldReply(
      contact.id,
      "WHATSAPP",
      messageBody
    );

    if (!safetyResult.shouldReply) {
      console.log(
        `🚫 [${phoneOrUsername}] Safety check blocked reply: ${safetyResult.reason}`
      );
      return;
    }

    // ── Fetch Settings for Delay & Behavior ─────────────
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const minDelay = settings?.minDelaySeconds ?? 3;
    const maxDelay = settings?.maxDelaySeconds ?? 15;

    // ── 4. Check Active Rules (Keyword Matching) ─────────
    const activeRules = await prisma.rule.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
    });

    const msgLower = messageBody.toLowerCase();
    const matchedRule = activeRules.find((rule) =>
      msgLower.includes(rule.keyword.toLowerCase())
    );

    if (matchedRule) {
      console.log(
        `⚡ [${phoneOrUsername}] Matched Rule keyword "${matchedRule.keyword}"`
      );

      // Simulate delay & read receipt
      try {
        const chat = await msg.getChat();
        await chat.sendSeen();
      } catch (err) {
        console.warn("Could not mark message as seen:", err);
      }
      await sleep(randomDelay(minDelay, maxDelay));

      // Send rule response
      await msg.reply(matchedRule.response);

      // Save outbound message & auto-reply
      await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "OUTBOUND",
          content: matchedRule.response,
          platform: "WHATSAPP",
        },
      });

      await prisma.autoReply.create({
        data: {
          messageId: savedInboundMessage.id,
          contactId: contact.id,
          generatedReply: matchedRule.response,
          wasSent: true,
        },
      });

      await incrementReplyCount(contact.id);
      console.log(`💬 [${phoneOrUsername}] Rule Replied: "${matchedRule.response}"`);
      return;
    }

    // ── 5. Fetch Recent Conversation History (last 10) ────
    const recentMessages = await prisma.message.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Reverse to chronological order, excluding current inbound message
    const conversationHistory = recentMessages
      .reverse()
      .filter((m) => m.id !== savedInboundMessage.id)
      .map((m) => ({
        role: (m.direction === "INBOUND" ? "user" : "assistant") as
          | "user"
          | "assistant",
        content: m.content,
      }));

    // ── 6. Branch on Contact Mode ────────────────────────
    let replyText: string | null = null;
    let shouldFlag = false;
    let flagReason: string | undefined;

    if (contact.mode === "TUTOR") {
      console.log(`🎓 [${phoneOrUsername}] Generating response using Tutor Engine...`);
      const tutorResult = await generateTutorReply({
        contactId: contact.id,
        contactName: contact.displayName || undefined,
        incomingMessage: messageBody,
        conversationHistory,
      });

      replyText = tutorResult.reply;
      shouldFlag = tutorResult.shouldFlag;
      flagReason = tutorResult.reason;
    } else {
      console.log(`🎭 [${phoneOrUsername}] Generating response using Impersonator Engine...`);
      const contactGroup = contact.group || "UNKNOWN";
      const contactName =
        contact.displayName || phoneOrUsername.replace("@c.us", "");

      const personaResult = await generateReply({
        contactId: contact.id,
        contactName,
        group: contactGroup as "FRIENDS" | "FAMILY" | "COLLEAGUES" | "CLIENT" | "UNKNOWN",
        platform: "WHATSAPP",
        incomingMessage: messageBody,
        conversationHistory,
      });

      replyText = personaResult.reply;
      shouldFlag = personaResult.shouldFlag;
      flagReason = personaResult.reason;
    }

    // ── 7. Handle Flagged Messages ───────────────────────
    if (shouldFlag) {
      console.log(
        `🚩 [${phoneOrUsername}] Message flagged for review: ${flagReason || "Requires manual attention"}`
      );

      await prisma.autoReply.create({
        data: {
          messageId: savedInboundMessage.id,
          contactId: contact.id,
          generatedReply: replyText || "[FLAGGED — no reply sent]",
          wasSent: false,
        },
      });

      return;
    }

    // ── 8. Send Reply & Log Outbound Message ─────────────
    if (replyText) {
      try {
        const chat = await msg.getChat();
        await chat.sendSeen();
      } catch (err) {
        console.warn("Could not mark message as seen:", err);
      }

      await sleep(randomDelay(minDelay, maxDelay));

      await msg.reply(replyText);

      // Log outbound message to DB
      await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "OUTBOUND",
          content: replyText,
          platform: "WHATSAPP",
        },
      });

      // Save AutoReply log
      await prisma.autoReply.create({
        data: {
          messageId: savedInboundMessage.id,
          contactId: contact.id,
          generatedReply: replyText,
          wasSent: true,
        },
      });

      // Increment daily count in Redis
      await incrementReplyCount(contact.id);

      console.log(`💬 [${phoneOrUsername}] Sent AI Reply: "${replyText}"`);
    }
  } catch (error) {
    console.error("❌ Error processing incoming message:", error);
  }
});

// ─── Initialization ──────────────────────────────────────

export async function initWhatsApp(): Promise<void> {
  console.log("🔄 Initializing WhatsApp client...");
  await client.initialize();
}
