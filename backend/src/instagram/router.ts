/**
 * Instagram DM webhook: GET for Meta's verification handshake, POST for incoming DMs.
 * Mounted BEFORE express.json() because the signature must be checked on the raw body.
 */
import express, { Router } from "express";
import { env } from "../config/env";
import { handleInbound } from "../pipeline/handleInbound";
import { notifyOwner } from "../whatsapp/whatsappClient";
import { fetchInstagramMedia, fetchInstagramUsername, instagramConfigured, sendInstagramText } from "./api";
import { mediaLabel } from "../media/media";
import { extractTextMessages, isValidSignature, verifySubscription } from "./webhook";

/** Meta retries deliveries; remember recent message ids so a retry never gets a second reply. */
const seenMids = new Set<string>();
function alreadySeen(mid: string): boolean {
  if (!mid) return false;
  if (seenMids.has(mid)) return true;
  seenMids.add(mid);
  if (seenMids.size > 500) seenMids.delete(seenMids.values().next().value as string);
  return false;
}

export const instagramRouter = Router();

instagramRouter.get("/webhooks/instagram", (req, res) => {
  const challenge = verifySubscription(req.query as Record<string, unknown>, env.IG_VERIFY_TOKEN);
  if (challenge === null) {
    res.sendStatus(403);
    return;
  }
  console.log("✅ Instagram webhook verified by Meta");
  res.status(200).type("text/plain").send(challenge);
});

instagramRouter.post(
  "/webhooks/instagram",
  express.raw({ type: "*/*", limit: "1mb" }),
  (req, res) => {
    if (!instagramConfigured()) {
      res.sendStatus(404);
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!isValidSignature(raw, req.header("x-hub-signature-256"), env.IG_APP_SECRET)) {
      console.warn("🚫 Instagram webhook rejected: bad signature");
      res.sendStatus(401);
      return;
    }

    // Acknowledge immediately; Meta retries if we take too long.
    res.sendStatus(200);

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    for (const dm of extractTextMessages(payload, env.IG_ACCOUNT_ID)) {
      if (alreadySeen(dm.mid)) continue;
      (async () => {
        const media = dm.attachment ? await fetchInstagramMedia(dm.attachment) : undefined;
        const kind = media?.kind ?? (dm.attachment?.type === "audio" ? "audio" : dm.attachment?.type);
        const content = kind ? mediaLabel(kind, dm.text) : dm.text;
        await handleInbound(
          {
            platform: "INSTAGRAM",
            senderKey: dm.senderId,
            content,
            media,
            resolveDisplayName: () => fetchInstagramUsername(dm.senderId),
          },
          { send: (text) => sendInstagramText(dm.senderId, text), notifyOwner }
        );
      })().catch((err) => console.error("❌ Error processing Instagram DM:", err));
    }
  }
);
