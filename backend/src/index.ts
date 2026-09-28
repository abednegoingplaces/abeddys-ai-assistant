import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import QRCode from "qrcode";
import { initWhatsApp, latestQr, whatsappReady } from "./whatsapp/whatsappClient";
import prisma from "./lib/prisma";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ──────────────────────────────────────────

app.use(cors());
app.use(express.json());

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

app.get("/api/status", (_req, res) => {
  res.status(200).json({
    whatsapp: whatsappReady ? "connected" : "disconnected",
    uptime: process.uptime(),
  });
});

app.get("/api/qr", async (_req, res) => {
  if (whatsappReady) {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp — Connected</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
          .card { text-align: center; padding: 40px; border-radius: 16px; background: #1a1a2e; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
          .status { font-size: 48px; margin-bottom: 16px; }
          h2 { color: #25D366; margin: 0; }
          p { color: #888; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="status">✅</div>
          <h2>WhatsApp Connected</h2>
          <p>Session is active. No QR code needed.</p>
        </div>
      </body>
      </html>
    `);
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

  // Ensure default Settings DB row
  await ensureDefaultSettings();

  // Initialize WhatsApp after server is up
  initWhatsApp().catch((err) => {
    console.error("❌ Failed to initialize WhatsApp:", err);
  });
});

// ─── Graceful Shutdown ──────────────────────────────────

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.log("📴 HTTP server closed");
  });

  await prisma.$disconnect();
  console.log("🗄️ Prisma disconnected");

  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export default app;
