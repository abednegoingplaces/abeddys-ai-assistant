# Abeddy's AI Assistant 🤖

A personal auto-reply bot for **WhatsApp** and **Instagram DMs**. It answers simple, everyday messages in Abeddy's own voice (English, Kiswahili and Sheng), and passes anything sensitive to him instead of replying.

![CI](https://github.com/abednegoingplaces/abeddys-ai-assistant/actions/workflows/ci.yml/badge.svg)

---

## Tech stack

| Part | Tool | Why |
| --- | --- | --- |
| Language | **TypeScript** on **Node.js 22** | One language for everything, and types catch mistakes early |
| Web server | **Express** | Serves `/health`, the WhatsApp QR page and the Instagram webhook |
| WhatsApp | **whatsapp-web.js** (runs WhatsApp Web in headless Chromium) | Works with a normal personal WhatsApp account |
| Instagram | **Instagram API with Instagram Login** (Meta, official) | The safe, allowed way to read and answer DMs |
| AI replies | **Google Gemini** (persona); **Claude**, with Gemini as fallback (tutor) | Short replies in Abeddy's voice, and patient explanations |
| Database | **PostgreSQL** on **Neon**, through **Prisma** | Stores contacts, messages, rules and settings |
| Cache | **Redis** | Counts replies per contact per day (the daily limit) |
| Validation | **Zod** | Checks the `.env` settings and the AI's JSON output |
| Tests | **Vitest** | Unit tests for every safety rule and the decision pipeline |
| Hosting | **Render** free plan (Docker), via `render.yaml` | Free, no card; GitHub Actions runs the tests on every PR |

---

## How it works

```
WhatsApp message --+
                   +--> handleInbound --> decideReply --+--> BLOCKED   : stay silent
Instagram DM ------+     (save to DB)                   +--> ESCALATED : stay silent, alert Abeddy
                                                        +--> RULE / AI : wait a few seconds, reply
```

`decideReply` always checks things in this order:

1. **Safety gate** (`safety/`). This runs first, for every message.
   - **Block silently:** the kill switch is on, it's blackout hours (default 01:00-06:00 Nairobi time), the daily reply limit is reached, the message contains a link, or it's a single character or emoji.
   - **Escalate to Abeddy:** money requests (unless someone is *sending* money) and location questions. In Impersonator mode, also **Client** or **Unknown** contacts and messages over 50 words.
   - **Fails closed:** if the database or Redis is down, the bot stays silent.
2. **Keyword rules.** Fixed replies you define in the `Rule` table.
3. **AI reply** (`ai/`), depending on the contact's mode:
   - **Impersonator:** short replies in Abeddy's voice.
   - **Tutor:** an AI study helper that says it's an AI.

**Escalated messages:**
- They are logged and never answered.
- If `OWNER_WID` is set, you also get a WhatsApp alert with the sender, the reason, the text and any suggested reply.
- No alert is sent when the *only* reason was that the contact is still `UNKNOWN`. That keeps the alerts from becoming spam.

> **New contacts start as `UNKNOWN`, so the bot stays silent with them until you give them a group** (Friends, Family or Colleagues). See [Managing contacts](#managing-contacts).

The full design, with the reasoning behind each rule, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Project layout

Every file has one job:

```
render.yaml                     Render Blueprint: the bot + a free Redis
backend/
|-- Dockerfile                  Builds the bot with Chromium for hosting
|-- prisma/schema.prisma        Database tables: Contact, Message, AutoReply, Rule, Settings, Persona
`-- src/
    |-- index.ts                Starts the web server, WhatsApp, and the keep-alive ping
    |-- config/env.ts           Reads and checks every setting from .env
    |-- pipeline/
    |   |-- handleInbound.ts    Save message -> decide -> reply or escalate (shared by both apps)
    |   `-- decideReply.ts      The decision itself: safety gate -> keyword rules -> AI
    |-- safety/
    |   |-- rules/hardSafety.ts Kill switch, blackout hours, daily limit, links, length
    |   |-- rules/escalation.ts Money, location, contact group, long messages
    |   |-- safetyEngine.ts     Runs the rules in order and returns BLOCK / ESCALATE / PROCEED
    |   |-- liveSafety.ts       Connects the safety engine to the real database and Redis
    |   `-- types.ts            Shared types
    |-- ai/
    |   |-- personaEngine.ts    Gemini prompt for replies in Abeddy's voice
    |   `-- tutorEngine.ts      Claude (or Gemini) prompt for Tutor mode
    |-- whatsapp/
    |   |-- whatsappClient.ts   Connects to WhatsApp and passes messages to handleInbound
    |   `-- filters.ts          Ignores groups, statuses and broadcasts
    |-- instagram/
    |   |-- router.ts           The /webhooks/instagram endpoint Meta calls
    |   |-- webhook.ts          Checks Meta's signature and pulls the text DMs out
    |   `-- api.ts              Sends a DM reply and looks up @usernames
    `-- lib/                    Small helpers: Prisma client, Redis, admin auth, keep-alive
```

Each `*.test.ts` file sits next to the file it tests.

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

## Instagram DMs (optional)

The bot answers Instagram DMs through Meta's official API. All of it is free. Instagram only lets the bot reply **within 24 hours of the person's last message**.

### One-time setup

1. **Switch to a Professional account.** In the Instagram app: **Settings -> Account type and tools -> Switch to professional account**, then choose **Creator**. It's free, and you can switch back later.
2. **Create a Meta app.** Go to <https://developers.facebook.com/apps>, click **Create app**, and choose the **Instagram** use case ("Manage messaging & content on Instagram").
3. **Add your Instagram account.** Under **API setup with Instagram login**, connect your account and click **Generate token**. Copy the token.
4. **Note two values** from the app's dashboard:
   - your **Instagram account ID**
   - the **Instagram app secret**
5. **Add these to the bot's environment** (Render -> abeddy-bot -> **Environment**, or `backend/.env` locally):

| Variable | Value |
| --- | --- |
| `IG_ACCESS_TOKEN` | The token from step 3 |
| `IG_APP_SECRET` | The Instagram app secret |
| `IG_ACCOUNT_ID` | Your Instagram account ID |
| `IG_VERIFY_TOKEN` | Any random phrase you make up (at least 8 characters) |

6. **Connect the webhook.** In the Meta app, under **Configure webhooks**:
   - **Callback URL:** `https://<your-service>.onrender.com/webhooks/instagram`
   - **Verify token:** the same phrase as `IG_VERIFY_TOKEN`
   - Click **Verify and save**, then subscribe to the **messages** field.
7. **Test it.** Send a DM to your account from another Instagram account. A new contact appears in Prisma Studio. Give it a group, and the next DM gets a reply.

While the Meta app is in **Development** mode, only accounts added as testers in the app can trigger replies. That's fine for personal use.

---

## Deploying for free (Render)

The repo includes a `render.yaml` Blueprint. It creates two things on Render's **free** plan, with no card needed:

- **abeddy-bot:** the bot, built from `backend/Dockerfile`, with Chromium included.
- **abeddy-bot-redis:** a free Key Value (Redis) instance for the daily reply counts.

**Free-plan limits to know about:**

- **Waking up:** a free service sleeps after 15 minutes without web traffic. The bot pings its own `/health` page every 10 minutes to stay awake.
- **Shared hours:** all free services in a Render workspace share **750 hours a month**. A bot running 24/7 uses about 744 of them. If other free services in the same workspace also get traffic, Render can pause *all* of them until the next month.
- **No saved WhatsApp login:** the disk is wiped on every restart or deploy, so you **rescan the QR code after each one**.
- **Memory:** 512 MB is tight for Chromium. If the logs show "out of memory" restarts, the bot needs a bigger host.

### Steps

1. In Render: **New → Blueprint**, sign in with GitHub, and pick this repository.
2. When Render asks for values, paste:
   - `DATABASE_URL`: your Neon connection string
   - `GEMINI_API_KEY`: from <https://aistudio.google.com/apikey>
3. Click **Apply** and wait for the first deploy to say **Live**.
4. Open the **abeddy-bot** service → **Environment** and copy the generated `ADMIN_TOKEN`.
5. Open `https://<your-service>.onrender.com/api/qr?token=<ADMIN_TOKEN>` and scan the QR code with WhatsApp (**Settings → Linked devices → Link a device**).
6. Check the **Logs** tab for `✅ WhatsApp client is ready!`.

**Only run the bot in one place at a time.** If it runs on Render, don't also run `npm run dev` on your PC.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Invalid environment configuration` on start | A required `.env` value is missing or wrong. The message names it. In production, `ADMIN_TOKEN` must be at least 24 characters. |
| `Redis connection error` / `ECONNREFUSED 6379` | Redis isn't running. Start Docker Desktop and run `docker compose up -d` from the project folder. The bot stays silent until Redis is back. |
| `Can't reach database server` | Postgres isn't running, or `DATABASE_URL` is wrong. |
| Bot never replies to anyone | New contacts are `UNKNOWN`, so set their group in Prisma Studio. Also check `killSwitch`, blackout hours and the terminal's 🚫 / 🚩 log lines, which say why a message was skipped. |
| Bot ignores "k" or a lone emoji | Messages under 2 characters are blocked on purpose; "hi", "ok", "yo" and "gn" do get replies. |
| `/api/qr` returns 401 | Add `?token=<ADMIN_TOKEN>`, or open it from the same computer in development. |
| `/api/qr` returns 404 | WhatsApp is already linked. |
| QR keeps reappearing / logged out | Locally: delete the `backend/sessions` folder, restart, and scan again. On Render: this is expected after every restart or deploy, so rescan at `/api/qr?token=…`. |
| Render logs show the service restarting with memory errors | The 512 MB free instance is too small for Chromium at that moment. Redeploy, or move to a host with more RAM. |
| Chromium / Puppeteer fails to launch | Run `npx puppeteer browsers install chrome` in `backend`, then start again. |
| Instagram: Meta says "callback URL couldn't be validated" | The bot must be live, and `IG_VERIFY_TOKEN` must match the verify token exactly. |
| Instagram: DMs arrive but get no reply | Check the logs for "bad signature" (wrong `IG_APP_SECRET`), "Instagram send failed" (expired token, or past the 24-hour window), or a block/escalation line (the safety gate). |
| `npx` or `npm` is not recognised | Install Node.js and reopen the terminal. |
