/**
 * Render's free plan stops a service after 15 minutes without inbound HTTP traffic.
 * WhatsApp traffic is outbound, so the bot pings its own public /health URL to stay awake.
 */

export const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

/** Builds the URL to ping from KEEP_ALIVE_URL or Render's RENDER_EXTERNAL_URL; null disables keep-alive. */
export function keepAliveTarget(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/health`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function startKeepAlive(baseUrl: string | undefined): NodeJS.Timeout | null {
  const target = keepAliveTarget(baseUrl);
  if (!target) return null;
  console.log(`💓 Keep-alive enabled: pinging ${target} every ${KEEP_ALIVE_INTERVAL_MS / 60000} min`);
  const timer = setInterval(() => {
    fetch(target, { signal: AbortSignal.timeout(30_000) }).catch((err) =>
      console.warn("Keep-alive ping failed:", err instanceof Error ? err.message : err)
    );
  }, KEEP_ALIVE_INTERVAL_MS);
  timer.unref();
  return timer;
}
