import { createHash, timingSafeEqual } from "crypto";

/** Constant-time comparison of a presented token against ADMIN_TOKEN. */
export function isValidAdminToken(presented: string | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface AdminGuardConfig {
  adminToken: string | undefined;
  nodeEnv: "development" | "production" | "test";
}

interface MinimalReq {
  header(name: string): string | undefined;
  query: Record<string, unknown>;
  socket: { remoteAddress?: string };
}
interface MinimalRes {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Builds the admin guard. Accepts `Authorization: Bearer <token>` or `?token=`.
 * With no ADMIN_TOKEN configured, only loopback requests in development pass
 * (so local QR linking works); everything else is 401. Uses the raw socket
 * address, not req.ip, so it can't be spoofed via X-Forwarded-For.
 */
export function createRequireAdmin(config: AdminGuardConfig) {
  return function requireAdmin(req: MinimalReq, res: MinimalRes, next: () => void): void {
    if (!config.adminToken) {
      const addr = req.socket.remoteAddress ?? "";
      if (config.nodeEnv === "development" && LOOPBACK.has(addr)) {
        next();
        return;
      }
      res.status(401).json({ error: "Unauthorized: ADMIN_TOKEN not configured" });
      return;
    }
    const header = req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const query = typeof req.query.token === "string" ? req.query.token : undefined;
    if (isValidAdminToken(bearer ?? query, config.adminToken)) {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  };
}
