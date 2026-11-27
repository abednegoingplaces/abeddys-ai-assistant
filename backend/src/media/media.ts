/**
 * Photos, videos, voice notes and stickers that people send.
 *
 * The bot passes the file itself to Gemini, which can look at images, watch short
 * videos and listen to voice notes, so the reply is about what was actually sent.
 * The database and the safety rules see a short text label instead, e.g. "[photo] nice?".
 */

export type MediaKind = "image" | "video" | "audio" | "sticker";

export interface InboundMedia {
  kind: MediaKind;
  /** e.g. "image/jpeg", "video/mp4", "audio/ogg" (no ";codecs=…" part). */
  mimeType: string;
  /** The file, base64-encoded. */
  base64: string;
}

/**
 * Gemini accepts files sent inline up to about 20 MB per request; base64 makes files
 * about a third bigger, so anything over 14 MB is not sent.
 */
export const MAX_MEDIA_BYTES = 14 * 1024 * 1024;

/** "audio/ogg; codecs=opus" → "audio/ogg" */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/** Which kind of media a file is, or null for things the bot doesn't open (PDFs, contacts…). */
export function mediaKindFor(mimeType: string, isSticker = false): MediaKind | null {
  const mime = normalizeMimeType(mimeType);
  if (isSticker || mime === "image/webp") return "sticker";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/** Size of a base64 string once decoded, in bytes. */
export function decodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const LABELS: Record<MediaKind, string> = {
  image: "[photo]",
  video: "[video]",
  audio: "[voice note]",
  sticker: "[sticker]",
};

/** The text stored and checked for a media message: label plus caption, e.g. "[photo] nice?". */
export function mediaLabel(kind: MediaKind, caption: string): string {
  const text = caption.trim();
  return text ? `${LABELS[kind]} ${text}` : LABELS[kind];
}
