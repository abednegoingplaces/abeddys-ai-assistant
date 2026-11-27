# Abeddy's AI Assistant 🤖

A personal auto-reply bot for WhatsApp, with Instagram planned. It answers simple, everyday messages in Abeddy's own voice (English, Kiswahili and Sheng) and sends anything sensitive to him instead of replying.

![CI](https://github.com/abednegoingplaces/abeddys-ai-assistant/actions/workflows/ci.yml/badge.svg)

**Built with:** Node.js + TypeScript, whatsapp-web.js, Google Gemini (persona), Claude with Gemini fallback (tutor), PostgreSQL (Neon) via Prisma, Redis, and Railway for hosting.

---

## How it decides what to do

Every incoming message goes through the same pipeline, in this order:

1. **Safety gate.** It runs before anything else, for every contact.
   - **Block silently:** the kill switch is on, it's blackout hours (default 01:00–06:00 Nairobi time), the contact's daily reply limit is reached, the message contains a link, or it is under 3 characters.
   - **Escalate to Abeddy:** money requests (unless someone is *sending* money) and location questions. For impersonated contacts, also messages from **Client** or **Unknown** contacts and messages over 50 words.
   - If the database or Redis can't be reached, the bot stays silent. It never guesses.
2. **Keyword rules.** Fixed replies you define in the `Rule` table.
3. **AI reply**, depending on the contact's mode:
   - **Impersonator:** short replies in Abeddy's voice, matching the sender's language.
   - **Tutor:** patient explanations that are open about being an AI.

Escalated messages are logged and never answered. If you set `OWNER_WID`, you also get a WhatsApp message with the sender, the reason, the text and any suggested reply.

> **New contacts start as `UNKNOWN`, so the bot stays silent with them until you give them a group** (Friends, Family or Colleagues). See [Managing contacts](#managing-contacts).

More detail is in [ARCHITECTURE_NOTES.md](ARCHITECTURE_NOTES.md).

---

## Run it locally

### What you need

- **Node.js 20 or newer**: <https://nodejs.org>
- **Docker Desktop**, for the local Postgres and Redis: <https://www.docker.com/products/docker-desktop>. You can use a Neon database and a hosted Redis instead and skip step 3.
- **A Gemini API key** (<https://aistudio.google.com/apikey>), an **Anthropic API key** (<https://console.anthropic.com>), or both
- **A phone with WhatsApp** to link the bot to

Every command below works in **Command Prompt** and **PowerShell**. Run them one at a time.

### 1. Clone the repository

```
git clone https://github.com/abednegoingplaces/abeddys-ai-assistant.git
```

### 2. Go into the project folder

```
cd abeddys-ai-assistant
```

### 3. Start Postgres and Redis

Make sure Docker Desktop is running first.

```
docker compose up -d
```

### 4. Go into the backend folder

```
cd backend
```

### 5. Install dependencies

```
npm install
```

### 6. Create your `.env` file

```
copy .env.example .env
```

Open `.env` in any editor and fill in:

| Variable | What to put |
| --- | --- |
| `DATABASE_URL` | Leave the default for Docker, or paste your Neon connection string |
| `REDIS_URL` | Leave the default for Docker, or paste your hosted Redis URL |
| `GEMINI_API_KEY` | Your Gemini key (needed for Impersonator mode) |
| `ANTHROPIC_API_KEY` | Your Anthropic key (Tutor mode; it falls back to Gemini if this is empty) |
| `OWNER_WID` | Optional. Your own number as `2547XXXXXXXX@c.us` to receive escalation alerts |
| `ADMIN_TOKEN` | Optional locally, **required in production**. At least 24 random characters |

To generate a strong `ADMIN_TOKEN`:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 7. Create the database tables

```
npx prisma generate
```

```
npx prisma db push
```

### 8. Run the tests (optional, but a good check)

```
npm test
```

```
npm run typecheck
```

### 9. Start the bot

```
npm run dev
```

A QR code appears in the terminal. You can also open <http://localhost:3001/api/qr> in your browser for a bigger one; without an `ADMIN_TOKEN`, that only works from this computer.

### 10. Link WhatsApp

On your phone: **WhatsApp → Settings → Linked devices → Link a device**, then scan the QR code. The terminal prints `✅ WhatsApp client is ready!` when it's connected. The session is saved in `backend/sessions/`, so you only scan once.

To stop the bot, press `Ctrl+C` in the terminal.

---

## Managing contacts

Contacts, keyword rules and settings live in the database. The easiest way to edit them is Prisma Studio:

```
npx prisma studio
```

It opens in your browser. Then:

- **Contact → group:** set `FRIENDS`, `FAMILY` or `COLLEAGUES` for people the bot may reply to as you. Leave clients as `CLIENT`.
- **Contact → mode:** `IMPERSONATOR` (replies as you) or `TUTOR` (an AI study helper that says it's an AI).
- **Rule:** add a `keyword` and a fixed `response`. Higher `priority` wins.
- **Settings (id 1):** `killSwitch`, blackout hours, `dailyReplyLimit`, and the min/max reply delay in seconds.

To stop all replies immediately, set `killSwitch` to `true`.

---

## Useful commands

All of these run from the `backend` folder.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the bot with auto-reload |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Compile to `dist/` for production |
| `npm start` | Run the compiled build |
| `npx prisma studio` | Edit contacts, rules and settings in the browser |

---

## Deploying (Railway)

1. Create a Railway project from this repository and set the **root directory** to `backend`.
2. Add a PostgreSQL database (or use Neon) and a Redis instance.
3. Set these variables: `DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_TOKEN`, `NODE_ENV=production`, `TZ=Africa/Nairobi` and, optionally, `OWNER_WID`.
4. Build command `npm run build`, start command `npm start`.
5. Open `https://<your-app>/api/qr?token=<ADMIN_TOKEN>` once to link WhatsApp. After it's linked, that page returns 404.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Invalid environment configuration` on start | A required `.env` value is missing or wrong. The message names it. In production, `ADMIN_TOKEN` must be at least 24 characters. |
| `Redis connection error` / `ECONNREFUSED 6379` | Redis isn't running. Start Docker Desktop and run `docker compose up -d` from the project folder. The bot stays silent until Redis is back. |
| `Can't reach database server` | Postgres isn't running, or `DATABASE_URL` is wrong. |
| Bot never replies to anyone | New contacts are `UNKNOWN`, so set their group in Prisma Studio. Also check `killSwitch`, blackout hours and the terminal's 🚫 / 🚩 log lines, which say why a message was skipped. |
| Bot ignores "hi" or "ok" | Messages under 3 characters are blocked on purpose. |
| `/api/qr` returns 401 | Add `?token=<ADMIN_TOKEN>`, or open it from the same computer in development. |
| `/api/qr` returns 404 | WhatsApp is already linked. |
| QR keeps reappearing / logged out | Delete the `backend/sessions` folder, restart, and scan again. |
| Chromium / Puppeteer fails to launch | Run `npx puppeteer browsers install chrome` in `backend`, then start again. |
| `npx` or `npm` is not recognised | Install Node.js and reopen the terminal. |

---

## Project layout

```
backend/
├── prisma/schema.prisma      Database models (Contact, Message, AutoReply, Rule, Settings…)
└── src/
    ├── safety/               Safety gate: pure rules + coordinator (tested)
    ├── pipeline/             Gate → rules → AI decision (tested)
    ├── ai/                   Persona (Gemini) and Tutor (Claude/Gemini) engines
    ├── whatsapp/             WhatsApp client and chat filters
    ├── config/env.ts         Validated environment settings
    └── index.ts              HTTP server (/health, /api/status, /api/qr)
```
