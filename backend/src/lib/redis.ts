import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

redis.on("error", (err) => {
  console.error("❌ Redis connection error:", err.message);
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

export default redis;

// ─── Helper Functions ────────────────────────────────────

/**
 * Get the number of replies sent to a contact today.
 */
export async function getReplyCount(contactId: string): Promise<number> {
  const key = `reply_count:${contactId}`;
  const count = await redis.get(key);
  return count ? parseInt(count, 10) : 0;
}

/**
 * Increment the reply count for a contact today.
 * The key automatically expires at midnight (end of current day).
 */
export async function incrementReplyCount(contactId: string): Promise<void> {
  const key = `reply_count:${contactId}`;
  await redis.incr(key);

  // Set expiry to midnight if this is the first increment
  const ttl = await redis.ttl(key);
  if (ttl === -1) {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000);
    await redis.expire(key, secondsUntilMidnight);
  }
}

/**
 * Get the cached conversation context for a contact.
 */
export async function getContactContext(contactId: string): Promise<string | null> {
  const key = `context:${contactId}`;
  return redis.get(key);
}

/**
 * Cache conversation context for a contact.
 * Expires after 1 hour (3600 seconds).
 */
export async function setContactContext(contactId: string, context: string): Promise<void> {
  const key = `context:${contactId}`;
  await redis.set(key, context, "EX", 3600);
}
