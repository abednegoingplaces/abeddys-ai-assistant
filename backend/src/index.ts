import express from "express";
import cors from "cors";
import QRCode from "qrcode";
import {
  initWhatsApp,
  shutdownWhatsApp,
  latestQr,
  whatsappReady,
} from "./whatsapp/whatsappClient";
import prisma from "./lib/prisma";
import { createRequireAdmin } from "./lib/auth";
import { startKeepAlive } from "./lib/keepAlive";
import { instagramRouter } from "./instagram/router";

import { env } from "./config/env";
import { mirrorConsoleToFile } from "./lib/fileLog";

// Everything printed also goes to logs/bot.log.
mirrorConsoleToFile();

const app = express();
const PORT = env.PORT;

// ─── Middleware ──────────────────────────────────────────

// CORS is closed unless a dashboard origin is configured.
app.use(cors({ origin: env.DASHBOARD_ORIGIN ?? false }));
// Instagram's webhook needs the raw body for signature checks, so it goes before express.json().
app.use(instagramRouter);
app.use(express.json());

const requireAdmin = createRequireAdmin({ adminToken: env.ADMIN_TOKEN, nodeEnv: env.NODE_ENV });

// ─── Helpers ─────────────────────────────────────────────

async function ensureDefaultSettings(): Promise<void> {
  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        killSwitch: false,
        blackoutStart: "01:00",
        blackoutEnd: "06:00",
        dailyReplyLimit: 10,
        minDelaySeconds: 3,
        maxDelaySeconds: 15,
      },
    });
    console.log("⚙️ Default settings verified (id=1)");
  } catch (error) {
    console.error("⚠️ Failed to initialize default settings:", error);
  }
}

// ─── Routes ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date(),
  });
});

app.get("/api/status", requireAdmin, (_req, res) => {
  res.status(200).json({
    whatsapp: whatsappReady ? "connected" : "disconnected",
    uptime: process.uptime(),
  });
});

app.get("/api/qr", requireAdmin, async (_req, res) => {
  // Once linked, the QR endpoint disappears so it can't be used to link another device.
  if (whatsappReady) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!latestQr) {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp — Waiting</title>
        <meta http-equiv="refresh" content="3">
        <style>
          body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
          .card { text-align: center; padding: 40px; border-radius: 16px; background: #1a1a2e; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
          .spinner { font-size: 48px; animation: pulse 1.5s infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
          h2 { color: #f0c040; margin: 8px 0 0; }
          p { color: #888; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="spinner">⏳</div>
          <h2>Waiting for QR Code</h2>
          <p>WhatsApp is initializing... this page refreshes automatically.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(latestQr, {
      width: 400,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });

    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp — Scan QR</title>
        <meta http-equiv="refresh" content="15">
        <style>
          body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
          .card { text-align: center; padding: 40px; border-radius: 16px; background: #1a1a2e; box-shadow: 0 8px 32px rgba(0,0,0,0.4); max-width: 480px; }
          h2 { color: #25D366; margin: 0 0 8px; }
          p { color: #888; margin: 4px 0 24px; font-size: 14px; }
          img { border-radius: 12px; }
          .hint { font-size: 12px; color: #555; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>📱 Scan to Connect WhatsApp</h2>
          <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
          <img src="${qrDataUrl}" alt="WhatsApp QR Code" width="400" height="400" />
          <p class="hint">This page auto-refreshes every 15 seconds.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

// ─── Start Server ───────────────────────────────────────

const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);

  startKeepAlive(env.KEEP_ALIVE_URL ?? env.RENDER_EXTERNAL_URL);

  // Ensure default Settings DB row
  await ensureDefaultSettings();

  // Initialize WhatsApp after server is up
  initWhatsApp().catch((err) => {
    console.error("❌ Failed to initialize WhatsApp:", err);
  });
});

// ─── Safety net ─────────────────────────────────────────
// whatsapp-web.js can reject promises from inside the browser (e.g. after WhatsApp logs
// the device out). Log them instead of letting one stray error kill the whole bot.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled promise rejection (bot keeps running):", reason);
});

// ─── Graceful Shutdown ──────────────────────────────────

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.log("📴 HTTP server closed");
  });

  try {
    await shutdownWhatsApp();
    console.log("📱 WhatsApp client destroyed");
  } catch (err) {
    console.error("⚠️ Error destroying WhatsApp client:", err);
  }

  await prisma.$disconnect();
  console.log("🗄️ Prisma disconnected");


  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export default app;
