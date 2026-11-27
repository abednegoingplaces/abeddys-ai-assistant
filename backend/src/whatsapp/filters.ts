/** Chats the bot must never reply in: groups, status updates, broadcast lists, newsletters. */
export function shouldIgnoreChat(from: string): boolean {
  return (
    from.endsWith("@g.us") ||
    from === "status@broadcast" ||
    from.endsWith("@broadcast") ||
    from.endsWith("@newsletter")
  );
}
