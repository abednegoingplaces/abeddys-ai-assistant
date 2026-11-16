import { createHash, timingSafeEqual } from "crypto";

/** Constant-time comparison of a presented token against ADMIN_TOKEN. */
export function isValidAdminToken(presented: string | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
