import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Types ───────────────────────────────────────────────

type Group = "FRIENDS" | "FAMILY" | "COLLEAGUES" | "CLIENT" | "UNKNOWN";
type Platform = "WHATSAPP" | "INSTAGRAM";

interface GenerateReplyParams {
  contactId: string;
  contactName: string;
  group: Group;
  platform: Platform;
  incomingMessage: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
}

interface GenerateReplyResult {
  reply: string | null;
  shouldFlag: boolean;
  reason?: string;
}

// ─── Money-request keywords ──────────────────────────────

const MONEY_REQUEST_KEYWORDS = [
  "ganji",
  "doooh",
  "okolea",
  "niwai",
  "nitakurefund",
  "mpesa",
  "nisendie",
  "nipe",
  "nisaidie pesa",
];

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

// ─── Pre-flight checks (before calling the API) ─────────

function preFlightCheck(
  params: GenerateReplyParams
): GenerateReplyResult | null {
  const { group, incomingMessage } = params;
  const msgLower = incomingMessage.toLowerCase().trim();
  const wordCount = incomingMessage.trim().split(/\s+/).length;

  // CLIENT or UNKNOWN → always flag, never reply
  if (group === "CLIENT" || group === "UNKNOWN") {
    return {
      reply: null,
      shouldFlag: true,
      reason: `Contact group is ${group} — requires manual handling`,
    };
  }

  // Long messages (over 50 words) → flag
  if (wordCount > 50) {
    return {
      reply: null,
      shouldFlag: true,
      reason: "Long message (over 50 words) — needs Abeddy's attention",
    };
  }

  // Money request keywords (unless offering)
  const offeringPatterns = /\b(nimekutumia|nimesend|pokea|sent you|sending you)\b/i;
  const isOffering = offeringPatterns.test(incomingMessage);

  if (!isOffering) {
    const hasMoneyRequest = MONEY_REQUEST_KEYWORDS.some((kw) =>
      msgLower.includes(kw)
    );
    if (hasMoneyRequest) {
      return {
        reply: null,
        shouldFlag: true,
        reason: "Money request detected — needs Abeddy's decision",
      };
    }
  }

  // Location questions
  const locationPatterns = /\b(uko wapi|where are you|location yako|uko side gani)\b/i;
  if (locationPatterns.test(incomingMessage)) {
    return {
      reply: null,
      shouldFlag: true,
      reason: "Location question — needs Abeddy's response",
    };
  }

  return null; // No pre-flight issue, proceed to API
}

// ─── Main Export ─────────────────────────────────────────

export async function generateReply(
  params: GenerateReplyParams
): Promise<GenerateReplyResult> {
  // Run pre-flight checks
  const preFlightResult = preFlightCheck(params);
  if (preFlightResult) {
    return preFlightResult;
  }

  const { group, platform, incomingMessage, conversationHistory } = params;

  // Build the system prompt
  const systemPrompt = buildSystemPrompt(group, platform);

  // Build message list: conversation history + incoming message
  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...conversationHistory,
    { role: "user", content: incomingMessage },
  ];

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      system: systemPrompt,
      messages,
    });

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return {
        reply: null,
        shouldFlag: true,
        reason: "AI returned no text content",
      };
    }

    const rawOutput = textBlock.text.trim();

    // Parse the JSON response
    let parsed: { reply: string | null; shouldFlag: boolean; reason?: string };
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      // If the AI didn't return valid JSON, treat the raw text as the reply
      // (fallback for robustness)
      return {
        reply: rawOutput,
        shouldFlag: false,
      };
    }

    return {
      reply: parsed.reply ?? null,
      shouldFlag: parsed.shouldFlag ?? false,
      reason: parsed.reason,
    };
  } catch (error) {
    console.error("❌ Anthropic API error:", error);
    return {
      reply: null,
      shouldFlag: true,
      reason: `AI engine error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
