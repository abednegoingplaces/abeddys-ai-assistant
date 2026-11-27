/**
 * Neo: Abeddy's personal assistant, reached with "/neo …" in his "Message yourself" chat.
 * Answers questions, writes things, and uses NEO_TOOLS to look at his chats or change bot
 * settings. Separate from the auto-replies: no safety gate, nothing stored in the chat tables.
 */
import { GoogleGenerativeAI, type Content, type Part } from "@google/generative-ai";
import { env } from "../config/env";
import { withGeminiFallback } from "../ai/geminiModels";
import { buildChatHistory, messageParts } from "../ai/personaEngine";
import type { InboundMedia } from "../media/media";
import { NEO_TOOLS, runNeoTool, type NeoDeps } from "./tools";

const MAX_TOOL_ROUNDS = 5;
const MEMORY_TURNS = 10;

function systemPrompt(now: Date, timeZone: string): string {
  const today = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full", timeStyle: "short" }).format(now);
  return `
You are Neo, Abeddy's personal assistant. He talks to you in his own WhatsApp "Message yourself" chat.
Abeddy is a fullstack engineer and Computer Science student in Kenya. It is now ${today} (${timeZone}).

WHAT YOU DO:
- Answer questions accurately and clearly. If you're not sure, say so; never make things up.
- Help with writing: messages, emails, cover letters, essays, code, summaries. Make it ready to copy and send.
- Work through bigger tasks step by step.
- For anything about his chats or the bot, use the tools. Never invent what someone said.
- If a contact is ambiguous, ask which one.

STYLE:
- Reply in the language he uses (English, Kiswahili or Sheng).
- Short and direct for simple things; complete and well structured for writing and complex tasks.
- WhatsApp formatting only: *bold*, _italic_, bullet lists with "-". No markdown headings or tables.
- The automatic replies to other people are a separate part of the bot; you don't reply to people.
`.trim();
}

/** Neo's short-term memory of this chat (lost on restart, which is fine). */
const memory: { role: "user" | "assistant"; content: string }[] = [];

function remember(user: string, assistant: string): void {
  memory.push({ role: "user", content: user }, { role: "assistant", content: assistant });
  while (memory.length > MEMORY_TURNS * 2) memory.shift();
}

export async function askNeo(task: string, deps: NeoDeps, media?: InboundMedia): Promise<string> {
  if (!env.GEMINI_API_KEY) return "I can't think without a GEMINI_API_KEY in the bot's .env.";
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const history: Content[] = buildChatHistory(memory).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const answer = await withGeminiFallback(async (modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt(deps.now(), deps.timeZone),
        tools: [{ functionDeclarations: NEO_TOOLS }],
      });
      // We build the conversation ourselves (instead of the SDK's chat helper) because the
      // API now requires tool results to be sent with role "user".
      const firstParts = messageParts(task, media);
      const contents: Content[] = [
        ...history,
        { role: "user", parts: typeof firstParts === "string" ? [{ text: firstParts }] : firstParts },
      ];
      let result = await model.generateContent({ contents });

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const calls = result.response.functionCalls() ?? [];
        if (calls.length === 0) break;
        contents.push({ role: "model", parts: result.response.candidates?.[0]?.content?.parts ?? [] });
        const responses: Part[] = [];
        for (const call of calls) {
          const output = await runNeoTool(call.name, (call.args ?? {}) as Record<string, unknown>, deps).catch((err) => ({
            error: err instanceof Error ? err.message : String(err),
          }));
          console.log(`🤖 Neo used ${call.name}`);
          responses.push({ functionResponse: { name: call.name, response: output } });
        }
        contents.push({ role: "user", parts: responses });
        result = await model.generateContent({ contents });
      }
      return result.response.text().trim();
    });

    const reply = answer || "Done.";
    remember(media ? `[${media.kind}] ${task}` : task, reply);
    return reply;
  } catch (error) {
    console.error("❌ Neo error:", error);
    return "Sorry, I couldn't do that just now (the AI service didn't answer). Try again in a minute.";
  }
}

/**
 * Voice notes have no caption, so Neo listens to every voice note Abeddy sends himself and
 * only acts if he starts by saying "Neo". Returns the spoken task, or null if it's just a memo.
 */
export async function voiceTaskForNeo(audio: InboundMedia): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  try {
    const raw = await withGeminiFallback(async (modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });
      const result = await model.generateContent([
        { inlineData: { mimeType: audio.mimeType, data: audio.base64 } },
        {
          text:
            'Listen to this voice note. If the speaker begins by addressing "Neo" (for example "Neo, …" or "Hey Neo …"), ' +
            'reply {"addressed": true, "task": "<everything they asked, written out in their own words>"}. ' +
            'Otherwise reply {"addressed": false}.',
        },
      ]);
      return result.response.text();
    });
    const parsed = JSON.parse(raw) as { addressed?: boolean; task?: string };
    return parsed.addressed && parsed.task?.trim() ? parsed.task.trim() : null;
  } catch (error) {
    console.warn("Could not check voice note for Neo:", error instanceof Error ? error.message : error);
    return null;
  }
}
