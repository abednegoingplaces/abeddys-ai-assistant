/** Minimal Instagram Graph API client (Instagram API with Instagram Login). */
import { env } from "../config/env";
import { clampToInstagramLimit } from "./webhook";

const base = () => `https://graph.instagram.com/${env.IG_GRAPH_VERSION}`;

export function instagramConfigured(): boolean {
  return Boolean(env.IG_ACCESS_TOKEN && env.IG_APP_SECRET && env.IG_VERIFY_TOKEN);
}

/** Sends a text DM. Only works within 24 hours of the person's last message to us. */
export async function sendInstagramText(recipientId: string, text: string): Promise<void> {
  const res = await fetch(`${base()}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: clampToInstagramLimit(text) } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Instagram send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/** Best-effort lookup of a sender's @username for the contact list. */
export async function fetchInstagramUsername(igsid: string): Promise<string | null> {
  try {
    const res = await fetch(`${base()}/${encodeURIComponent(igsid)}?fields=username,name`, {
      headers: { Authorization: `Bearer ${env.IG_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { username?: string; name?: string };
    return data.username ? `@${data.username}` : data.name ?? null;
  } catch {
    return null;
  }
}
