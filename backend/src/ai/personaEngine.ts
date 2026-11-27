import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { env } from "../config/env";
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
- Work request ("nifanyie kazi" etc) → reply "ipi" or "kama gani" then set shouldFlag to true
- Call/meetup request → reply "wazii" or "poa" then set shouldFlag to true
- "ok"/"sawa"/"fine" (very short acknowledgement) → reply "👍" only
- Someone offering/sending money → reply "shukran 🙌💯"
- Ghost comeback ("where have you been" etc) → reply normally, ignore the accusation entirely
- Venting/sad → reply "sorry to hear that, hope you're okay"
`.trim();

  const flagRules = `
FLAG RULES — return {"shouldFlag": true, "reply": null} for:
- Group messages
- Anything that needs Abeddy to make a real decision
- Long messages (over 50 words from the sender)
- Rude or aggressive messages
- Location questions ("uko wapi" / "where are you")
- Money requests (keywords: ganji, doooh, okolea, niwai, nitakurefund, mpesa) — UNLESS the sender is OFFERING money
- Client or Unknown contacts (always flag, never reply)
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

    case "CLIENT":
    case "UNKNOWN":
      // These groups should be flagged before reaching the API call,
      // but we include a prompt just in case.
      tonePreamble = `
TONE: This is a CLIENT or UNKNOWN contact.
DO NOT reply. Return shouldFlag: true and reply: null immediately.
`.trim();
      break;
  }

  const responseFormat = `
RESPONSE FORMAT:
You must respond with ONLY a valid JSON object. No markdown, no code fences, no extra text.
The JSON must have this exact shape:
{"reply": "your reply text here", "shouldFlag": false}

If the message should be flagged for Abeddy's attention:
{"reply": null, "shouldFlag": true, "reason": "brief explanation"}

If the message needs a reply AND should also be flagged:
{"reply": "your reply text here", "shouldFlag": true, "reason": "brief explanation"}
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

  // Defence in depth: the safety gate already escalates these, but never impersonate to them.
  if (group === "CLIENT" || group === "UNKNOWN") {
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
    const model = genAI.getGenerativeModel({
      model: env.GEMINI_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: { responseMimeType: "application/json" },
    });

    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    });

    const result = await chat.sendMessage(incomingMessage);
    return parsePersonaOutput(result.response.text());
  } catch (error) {
    console.error("❌ Gemini API error:", error);
    return {
      reply: null,
      shouldFlag: true,
      reason: `AI engine error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
