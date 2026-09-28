import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Types ───────────────────────────────────────────────

export interface GenerateTutorReplyParams {
  contactId: string;
  contactName?: string;
  incomingMessage: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
}

export interface GenerateTutorReplyResult {
  reply: string | null;
  shouldFlag: boolean;
  reason?: string;
}

// ─── System Prompt ───────────────────────────────────────

const TUTOR_SYSTEM_PROMPT = `
You are a helpful, knowledgeable, and patient AI Tutor on WhatsApp.
Your goal is to help the user learn and understand concepts clearly across any subject (programming, science, mathematics, general knowledge, languages, etc.).

GUIDELINES:
1. Transparency: Be honest and clear that you are an AI assistant and tutor.
2. Structure: Break down complex concepts into step-by-step, digestible points. Use clear formatting (bullet points, bold text for key terms).
3. Tone: Patient, encouraging, friendly, and structured.
4. Active Learning: Ask clarifying questions if the prompt is vague or ambiguous, and end answers with a brief check-for-understanding question or follow-up topic suggestion when appropriate.
5. Conciseness: Keep responses clear and suited for mobile messaging (WhatsApp). Avoid unnecessary fluff, but give complete and accurate explanations.
6. Safety & Integrity: Always provide accurate, helpful, and safe information.
`.trim();

// ─── Main Export ─────────────────────────────────────────

export async function generateTutorReply(
  params: GenerateTutorReplyParams
): Promise<GenerateTutorReplyResult> {
  const { incomingMessage, conversationHistory } = params;

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  // 1. Try Anthropic (Claude) if API key is provided
  if (anthropicApiKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });

      const messages = conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      messages.push({
        role: "user",
        content: incomingMessage,
      });

      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: TUTOR_SYSTEM_PROMPT,
        messages,
      });

      const textBlock = response.content.find((block) => block.type === "text");
      const replyText = textBlock ? textBlock.text : null;

      return {
        reply: replyText,
        shouldFlag: false,
      };
    } catch (error) {
      console.warn("⚠️ Anthropic API call failed, attempting fallback to Gemini:", error);
    }
  }

  // 2. Fallback to Gemini if GEMINI_API_KEY is available
  if (geminiApiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: TUTOR_SYSTEM_PROMPT,
      });

      const chat = model.startChat({
        history: conversationHistory.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      });

      const result = await chat.sendMessage(incomingMessage);
      const replyText = result.response.text().trim();

      return {
        reply: replyText,
        shouldFlag: false,
      };
    } catch (error) {
      console.error("❌ Gemini API call failed in Tutor Engine:", error);
      return {
        reply: null,
        shouldFlag: false,
        reason: `Tutor AI Engine error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  return {
    reply: null,
    shouldFlag: false,
    reason: "No valid AI API keys found (ANTHROPIC_API_KEY or GEMINI_API_KEY)",
  };
}
