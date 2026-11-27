# Architecture

> Comprehensive architectural breakdown of the messaging, safety, escalation, persistence, and AI pipelines in `abeddys-ai-assistant`.

---

## 1. High-Level System Overview

`abeddys-ai-assistant` is an autonomous assistant designed to receive messages on WhatsApp (and Instagram DMs via the official Instagram API), pass them through a strict, deterministic rules-first safety layer, and either escalate sensitive/risky messages to the project owner (Abeddy) or generate safe, contextual, human-like automated responses.

### Tech Stack
- **Runtime & Language:** Node.js, TypeScript (Strict mode).
- **Messaging Interface:** `whatsapp-web.js` (running headless Chromium via Puppeteer with `LocalAuth` session management).
- **Data Persistence:** PostgreSQL (NeonDB) managed through Prisma ORM.
- **In-Memory Cache & Rate Limiting:** Redis via `ioredis` (daily per-contact rate limits with automatic midnight TTL).
- **AI Models:**
  - Google Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash` on Render) for Impersonator replies.
  - Anthropic Claude (`TUTOR_MODEL`) with Gemini as fallback for Tutor mode.
- **Deployment Target:** Render free plan (Docker), defined in `render.yaml`.

---

---

## 2. The safety gate in detail

The decision pipeline (`src/pipeline/decideReply.ts`) runs for both WhatsApp and Instagram, through `src/pipeline/handleInbound.ts`:

1. **Safety gate** (`src/safety/safetyEngine.ts`). Runs for every contact mode, before anything else.
   - **Tier 1, hard safety → BLOCK** (silent): kill switch, blackout hours (evaluated in `TZ`, default `Africa/Nairobi`), daily limit, links, messages under 2 characters.
   - **Tier 3, escalation → ESCALATE** (silent, logged, owner notified):

     | Rule | IMPERSONATOR | TUTOR |
     | --- | --- | --- |
     | CLIENT / UNKNOWN group | escalate | allowed (tutor mode is assigned on purpose) |
     | Over 50 words | escalate | allowed (study questions can be long) |
     | Money request (not an offer) | escalate | escalate |
     | Location question | escalate | escalate |

   - **Fails closed:** if Postgres or Redis can't be read, or the blackout settings are malformed, the message is blocked.
2. **Keyword rules (Tier 2).** These now run *after* the gate, so a keyword can no longer auto-answer a client, a stranger or a money request.
3. **AI engine for the contact's mode.**
   - Persona output is parsed with a zod schema (`parsePersonaOutput`). Gemini is asked for `application/json`, and code fences are stripped.
   - Anything malformed, or an empty reply, is **escalated** instead of sent.
   - An AI flag that still carries a suggested reply is escalated with that reply as a draft.

**Escalations:**
- They are recorded as `AutoReply { wasSent: false }`.
- When `OWNER_WID` is set, a summary goes to the owner's own WhatsApp: contact, reason, message and any suggested reply.
- The exception is a message escalated *only* because the contact is still `UNKNOWN`. It is logged without a ping, so unclassified numbers (spam, OTPs, businesses) don't bury real alerts.
- The handler ignores `fromMe` messages, so these notices never loop.

**Module layout:**

```
src/
├── safety/
│   ├── types.ts              # Shared types and the SafetyVerdict union
│   ├── rules/hardSafety.ts   # Pure Tier 1 rules (+ tests)
│   ├── rules/escalation.ts   # Pure Tier 3 rules (+ tests)
│   ├── safetyEngine.ts       # Coordinator with injected data access (+ tests)
│   └── liveSafety.ts         # Production wiring to Prisma + Redis
├── pipeline/decideReply.ts   # Gate → rules → AI decision, no side effects (+ tests)
└── whatsapp/whatsappClient.ts# Side effects only: DB writes, delays, sending, owner notice
```
