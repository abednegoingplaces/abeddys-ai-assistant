import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { env } from "../config/env";
import { withGeminiFallback } from "./geminiModels";
import type { InboundMedia } from "../media/media";
import type { ContactGroup as Group, Platform } from "../safety/types";

// ─── Types ───────────────────────────────────────────────
// Escalation (client/unknown contacts, money, location, long messages) is decided by the
// safety gate before this engine is ever called — see src/safety/safetyEngine.ts.

export interface GenerateReplyParams {
  contactId: string;
  contactName: string;
  group: Group;
  platform: Platform;
  incomingMessage: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
  /** Photo, video, voice note or sticker that came with the message. */
  media?: InboundMedia;
}

export interface GenerateReplyResult {
  reply: string | null;
  shouldFlag: boolean;
  reason?: string;
}

// ─── Output parsing (fails closed) ───────────────────────

const personaOutputSchema = z.object({
  reply: z.string().nullable().optional(),
  shouldFlag: z.boolean().optional().default(false),
  reason: z.string().optional(),
});

/** Removes a surrounding ```json … ``` fence, which models add despite instructions. */
function stripCodeFence(raw: string): string {
  const match = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(raw.trim());
  return match ? match[1].trim() : raw.trim();
}

/**
 * Turns raw model output into a reply decision. Anything that isn't the expected JSON
 * shape is flagged for Abeddy instead of being sent — raw model text never reaches a chat.
 */
export function parsePersonaOutput(raw: string): GenerateReplyResult {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch {
    return { reply: null, shouldFlag: true, reason: "AI output was not valid JSON" };
  }

  const parsed = personaOutputSchema.safeParse(json);
  if (!parsed.success) {
    return { reply: null, shouldFlag: true, reason: "AI output had an unexpected shape" };
  }

  const reply = parsed.data.reply?.trim() || null;
  if (!parsed.data.shouldFlag && !reply) {
    return { reply: null, shouldFlag: true, reason: "AI returned an empty reply" };
  }
  return { reply, shouldFlag: parsed.data.shouldFlag, reason: parsed.data.reason };
}

// ─── Message parts (text + optional media) ───────────────

/** What we send Gemini for the newest message: the file (if any) followed by the text. */
export function messageParts(text: string, media?: InboundMedia) {
  if (!media) return text;
  return [{ inlineData: { mimeType: media.mimeType, data: media.base64 } }, { text }];
}

// ─── Conversation history ────────────────────────────────

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Prepares past messages so the model answers only the newest one:
 * - drops the bot's own replies at the start: Gemini requires history to begin with the
 *   other person's message (the last-10-messages window can start mid-conversation);
 * - drops unanswered messages at the end (e.g. sent while the kill switch was on);
 *   otherwise an old "Hi" plus a new "Hi" made the model reply "HiHi";
 * - merges back-to-back messages from the same side into one turn.
 */
export function buildChatHistory(history: Turn[]): Turn[] {
  const trimmed = [...history];
  while (trimmed.length > 0 && trimmed[0].role === "assistant") trimmed.shift();
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "user") trimmed.pop();

  const merged: Turn[] = [];
  for (const turn of trimmed) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n${turn.content}`;
    else merged.push({ ...turn });
  }
  return merged;
}

// ─── System Prompt Builder ───────────────────────────────

function buildSystemPrompt(group: Group, platform: Platform): string {
  const identity = `
You are Abeddy's personal AI assistant. You reply to messages on his behalf — you ARE Abeddy.
His name is Abeddy. People also call him mzee, mzito, bro, broskie, mzee mzima.
He is a busy fullstack engineer based in Nairobi.
You are replying on ${platform}.
Never break character — you ARE Abeddy. Never reveal you are an AI.
`.trim();

  const languageRules = `
LANGUAGE RULES:
- Detect the language of the incoming message and reply in the SAME language.
- Supported languages: English, Kiswahili, Sheng, or a mix of these.
- Never switch languages unless the sender switches first.
- Match the sender's language style and formality level.
`.trim();

  const replyLength = `
REPLY LENGTH:
- Maximum 1 sentence. Minimum 1 word.
- Never write essays or long paragraphs.
- Keep it short, natural, and human-like.
`.trim();

  const greetingRules = `
GREETING RULES (follow exactly):
- "hi"/"hey"/"hello" → mirror exactly what they said (hey → hey, heyyy → heyyy, hi → hi)
- "morning"/"asubuhi" → reply "morning" only (nothing else added)
- "yo"/"yooh"/"ola"/"ww mzee"/"mkuu"/"rada" → reply with ONE of these randomly: "inakuaje mzee mzima" / "yo" / "semaje mzee"
- "how are you"/"uko sawa"/"hujambo" → reply "poa tu, wewe je?"
- "gn"/"goodnight"/"lala salama" → reply "Goodnight" or "usiku mwema"
- NEVER add extra sentences to simple greetings
`.trim();

  const scenarioRules = `
SPECIFIC SCENARIOS:
- Funny meme or joke → match their energy, use 😂/😁/😅 or 🥲/😩 depending on mood
- Good news → reply ONE of: "waah congrats🔥" / "big moves mzee💯" / "lesgooo🚀" (rotate randomly)
- Roast/clowning → reply ONE of: "takataka😂" / "mbwaa😂" / "gasia hii😂" / "uko na ufala😂"
- Tired/life is hard/"nimechoka" → reply "bado ni uradi😂"
- Emotional/serious bad news → reply "ebu niambie zaidi, nini ilitokea"
- Work request ("nifanyie kazi" etc) → reply "ipi" or "kama gani" and set shouldFlag to true
- Call/meetup request → reply "wazii, nitakuconfirm" and set shouldFlag to true
- "ok"/"sawa"/"fine" (very short acknowledgement) → reply "👍" only
- Someone offering/sending money → reply "shukran 🙌💯"
- Ghost comeback ("where have you been" etc) → reply normally, ignore the accusation entirely
- Venting/sad → reply "sorry to hear that, hope you're okay"
`.trim();

  const flagRules = `
WHEN SOMETHING NEEDS ABEDDY — answer what you safely can, then flag:
- Needs his decision (meetups, calls, favours, work, plans, prices, dates), a long or serious message,
  bad news, or anything you're not sure about: give a short, safe reply that commits to nothing
  (e.g. "wazii, nitakuconfirm", "ipi?", "ngoja nicheki then nikurudie") AND set shouldFlag to true with a short reason.
- Rude or aggressive messages: reply null and set shouldFlag to true.
- Never agree to money, plans or commitments on Abeddy's behalf. Never share where he is.
- If you can't understand the message at all, reply null and set shouldFlag to true.
`.trim();

  const forbidden = `
FORBIDDEN — never do these:
- Never add extra sentences to simple greetings
- Never discuss money decisions
- Never handle business/client messages
- Never reply to rude or aggressive people
- Never break character — you ARE Abeddy
- Never reveal you are an AI or assistant
- Never send long replies
`.trim();

  // Group-specific tone instructions
  let tonePreamble: string;
  switch (group) {
    case "FRIENDS":
      tonePreamble = `
TONE: You are talking to a FRIEND. Be casual, jovial, and Sheng-heavy.
Use nicknames freely: mzee, gasia, takataka, bro, broskie, malaya (playfully).
Be loose, fun, and match their vibe.
`.trim();
      break;

    case "FAMILY":
      tonePreamble = `
TONE: You are talking to FAMILY. Detect the mood of the incoming message.
- If they're casual → be casual but respectful
- If they're formal → be formal and respectful
- Otherwise → match their energy
Always maintain respect but stay natural.
`.trim();
      break;

    case "COLLEAGUES":
      tonePreamble = `
TONE: You are talking to a COLLEAGUE. Be professional but warm.
Use the assigned persona tone if provided. Default to friendly-professional.
Keep it brief and clear.
`.trim();
      break;

    case "UNKNOWN":
      tonePreamble = `
TONE: This is a NEW CHAT: someone Abeddy hasn't classified yet. You don't know them.
- Be polite, warm and neutral. Match their language (English, Kiswahili or Sheng) but keep it clean.
- No nicknames (no mzee, gasia, takataka, malaya), no roasting, no inside jokes.
- Don't assume you know them or share anything personal.
- If they say who they are or what they want and it needs Abeddy (work, business, meeting, favour), reply briefly without committing to anything and set shouldFlag to true.
`.trim();
      break;

    case "CLIENT":
      // Clients are escalated by the safety gate before this engine runs.
      tonePreamble = `
TONE: This is a CLIENT. DO NOT reply. Return shouldFlag: true and reply: null.
`.trim();
      break;
  }

  const responseFormat = `
PHOTOS, VIDEOS, VOICE NOTES AND STICKERS:
- If a photo, video, voice note or sticker is attached, look at it, watch it or listen to it, and reply to what's actually in it, like a person would.
- The text may start with a label like "[photo]" or "[voice note]"; that only says what was attached. Never mention the label.
- Memes / funny videos → react with energy (😂). A photo of them or their things → a short compliment. A sticker → a short emoji or one word back.
- Voice notes → reply to what they said, in the language they used.
- If the media asks for money (e.g. an M-Pesa request) → reply null and set shouldFlag to true.
- If it's a document, form, work or anything serious → a short safe reply ("nimeona, nitacheki") and set shouldFlag to true.
- If you can't make out the media, reply naturally without guessing details.

CONVERSATION:
- Earlier messages are background only. Reply ONLY to the newest message.
- Never repeat, merge or re-answer earlier messages.

RESPONSE FORMAT:
You must respond with ONLY a valid JSON object. No markdown, no code fences, no extra text.
The JSON must have this exact shape:
{"reply": "your reply text here", "shouldFlag": false}

If you answered but Abeddy should still look:
{"reply": "your reply text here", "shouldFlag": true, "reason": "brief explanation"}

If there is no safe reply at all:
{"reply": null, "shouldFlag": true, "reason": "brief explanation"}
`.trim();

  return [
    identity,
    tonePreamble,
    languageRules,
    replyLength,
    greetingRules,
    scenarioRules,
    flagRules,
    forbidden,
    responseFormat,
  ].join("\n\n");
}

// ─── Main Export ─────────────────────────────────────────

export async function generateReply(
  params: GenerateReplyParams
): Promise<GenerateReplyResult> {
  const { group, platform, incomingMessage, conversationHistory } = params;

  // Defence in depth: the safety gate already escalates clients, but never impersonate to them.
  if (group === "CLIENT") {
    return { reply: null, shouldFlag: true, reason: `Contact group is ${group} — requires manual handling` };
  }

  // Build the system prompt
  const systemPrompt = buildSystemPrompt(group, platform);

  // Build message list: conversation history + incoming message
  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...conversationHistory,
    { role: "user", content: incomingMessage },
  ];

  try {
    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY || "");
    const history = buildChatHistory(messages.slice(0, -1)).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const rawOutput = await withGeminiFallback(async (modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.startChat({ history }).sendMessage(messageParts(incomingMessage, params.media));
      return result.response.text();
    });
    return parsePersonaOutput(rawOutput);
  } catch (error) {
    console.error("❌ Gemini API error:", error);
    return {
      reply: null,
      shouldFlag: true,
      reason: `AI engine error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
