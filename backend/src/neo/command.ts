/**
 * Neo commands: Abeddy talks to his assistant in his own WhatsApp "Message yourself" chat
 * by starting a message with "/neo". Everything else in that chat (his notes, the bot's
 * 🚩 alerts, Neo's own 🤖 replies) is ignored. Pure functions, easy to test.
 */

export const NEO_PREFIX = "/neo";
/** Neo's replies start with this so they're easy to spot, and never mistaken for a command. */
export const NEO_REPLY_MARK = "🤖";

/** "/neo what did Kevo say?" → "what did Kevo say?". Returns null if it isn't a Neo command. */
export function parseNeoCommand(text: string): string | null {
  const match = /^\s*\/neo\b[\s,:.-]*([\s\S]*)$/i.exec(text);
  if (!match) return null;
  return match[1].trim();
}

/**
 * True when a message was sent by Abeddy into his own "Message yourself" chat.
 * WhatsApp may address that chat by his phone number (…@c.us) or by a hidden id (…@lid),
 * so we accept either of his own ids.
 */
export function isOwnSelfChat(fromMe: boolean, chatId: string | undefined, ownIds: ReadonlySet<string>): boolean {
  return fromMe && !!chatId && ownIds.has(chatId);
}

/** Neo must never react to its own replies or to the bot's alerts. */
export function isFromTheBot(text: string, sentByBotIds: ReadonlySet<string>, messageId: string): boolean {
  if (sentByBotIds.has(messageId)) return true;
  const t = text.trimStart();
  return t.startsWith(NEO_REPLY_MARK) || t.startsWith("🚩");
}

/** Formats Neo's reply for the self-chat. */
export function neoReply(text: string): string {
  return `${NEO_REPLY_MARK} ${text.trim()}`;
}

