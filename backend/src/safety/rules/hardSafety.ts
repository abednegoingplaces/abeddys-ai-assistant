/**
 * Tier 1 — hard safety rules. Pure functions with no I/O so every boundary can be unit tested.
 */

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parses "HH:MM" into minutes after midnight. Throws on malformed input so bad settings fail loudly. */
export function parseTimeToMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid time "${value}" — expected HH:MM (24-hour)`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes after midnight for `now` as seen on a wall clock in `timeZone` (e.g. "Africa/Nairobi"). */
export function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function isKillSwitchActive(killSwitch: boolean): boolean {
  return killSwitch === true;
}

/**
 * True when `now` falls inside the blackout window [start, end).
 * Handles same-day windows (01:00–06:00) and windows that cross midnight (23:00–06:00).
 * A window whose start equals its end is treated as "no blackout".
 */
export function isWithinBlackoutHours(
  now: Date,
  start: string,
  end: string,
  timeZone: string
): boolean {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === endMin) return false;

  const current = minutesInTimeZone(now, timeZone);
  if (startMin < endMin) {
    return current >= startMin && current < endMin;
  }
  return current >= startMin || current < endMin;
}

export function isDailyLimitExceeded(currentCount: number, limit: number): boolean {
  return currentCount >= limit;
}

// Explicit schemes, "www." hosts, and bare domains with a common TLD (e.g. "bit.ly/x", "example.com").
// Word boundaries keep "awww" or "e.g." from matching.
const URL_PATTERN =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/\S+)|(?:\bwww\.\S+)|(?:\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ke|ly|me|app|dev|xyz|info|biz|link|site|online|shop|gl|gg|tk|ru|cn)(?:\/\S*)?\b)/i;

export function containsUrl(content: string): boolean {
  return URL_PATTERN.test(content);
}

/** Counts user-perceived characters, so a single emoji counts as one. */
function visibleLength(content: string): number {
  return Array.from(content.trim()).length;
}

/** Two characters is enough for "hi", "ok", "yo", "gn"; single letters and lone emoji are noise. */
export const MIN_MESSAGE_LENGTH = 2;

export function isMessageTooShort(content: string, minLength = MIN_MESSAGE_LENGTH): boolean {
  return visibleLength(content) < minLength;
}
