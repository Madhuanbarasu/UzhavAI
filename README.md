# UzhavAI — Ask in your language. Farm smarter.

**Build Fast with AI: AI Build Challenge 2026 · PS-06 — AI for Bharat in Indian Languages**
Team Slytherin — Madhu Chandrika A, Mahalakshmi S

**Live app:** `<PASTE YOUR DEPLOYED URL HERE>`  ·  **Health check:** `<URL>/api/health`

---

## 1. Problem

A farmer who sees brown spots on a tomato leaf, wants to know what a crop is selling for, or wonders whether a government scheme applies to them usually has to travel to an agriculture office or rely on English-language information. Most digital tools assume English literacy, a smartphone, and trust in an answer that may be wrong — and a wrong answer about a pesticide dose or an insurance claim can cost a season's income.

## 2. Solution

UzhavAI lets a farmer ask in **Tamil or English** — by typing, speaking, or sending a **photo of the crop** — and get a short, plain-language answer that can be **read aloud**. Its defining feature is a safety net: when the AI is unsure, or the question involves chemicals, doses or money, the app says so plainly and tells the farmer to confirm with a human agriculture expert instead of pretending to be certain.

## 3. Features — what is actually implemented

| Feature | Status |
|---|---|
| Tamil + English UI and answers | ✅ Implemented |
| Text questions → AI answer (Gemini free tier or Claude, via our backend) | ✅ Implemented |
| Voice input (browser Web Speech API, `ta-IN` / `en-IN`) | ✅ Implemented; depends on the browser (Chrome recommended) |
| Spoken answers (browser `speechSynthesis`) | ✅ Implemented; Tamil needs a Tamil voice installed on the device — the app tells the user if none is found |
| Crop photo analysis (multimodal Gemini / Claude) | ✅ Implemented — photo is downscaled in the browser, validated and forwarded by the backend |
| Mandi prices | ⚠️ **Static "Mandi Price Snapshot"** of 5 representative values — clearly labelled *not live, not official*. No live data feed is wired up |
| Government scheme navigator (PM-KISAN, PMFBY, Soil Health Card) | ✅ Implemented as **informational guidance only**; the UI states it is *not* an official eligibility decision |
| Confidence check + human handoff | ✅ Implemented (see §15) |
| Phone / WhatsApp access (Twilio, Exotel…) | ❌ Not built — roadmap only |
| Live data.gov.in mandi data, RAG over ICAR advisories, more languages | ❌ Not built — roadmap only |

## 4. Architecture

```
 Browser (public/index.html, vanilla JS)
   ├─ Web Speech API ── voice in / voice out (runs in the browser)
   ├─ resizes crop photo to JPEG (<=1280px)
   └─ POST /api/ask  { prompt, imageBase64, lang, context, mode }
            │                         (same origin — no API key in the browser)
            ▼
 Node + Express (server.js)
   ├─ per-IP rate limit
   ├─ lib/ask.js: validate request + image (size, magic-byte type)
   ├─ builds the system prompt (language, safety rules, JSON format)
   ├─ AI provider: Google Gemini (free key) or Anthropic Claude
   │    (key from GEMINI_API_KEY / ANTHROPIC_API_KEY env var)
   └─ parses reply → { answer, confidence, needsExpert, reason }
            │   lib/logic.js: parsing + low-confidence / high-stakes decision
            ▼
 Browser shows the answer, and the expert-handoff banner when needsExpert is true
```

The backend serves the frontend and the API from one origin, so one deployment is all that is needed.

## 5. Tech stack

- **Frontend:** vanilla HTML/CSS/JS — no build step, no framework
- **Backend:** Node.js (≥18) + Express 4
- **AI (pick one, both multimodal):** Google Gemini via REST — **free key**, default model `gemini-2.5-flash` — or Anthropic Claude (`@anthropic-ai/sdk`, default `claude-sonnet-4-6`). Both go through the same validation, prompt and safety logic
- **Speech:** browser Web Speech API
- **Tests:** Node's built-in test runner (`node:test`) — no test framework dependency

## 6. Local setup

Requires Node.js 18 or newer and one AI API key. **A free key works:** get a Gemini key at <https://aistudio.google.com/apikey> (no credit card needed).

```bash
git clone <your-repo-url>
cd uzhavai-repo
npm install
cp .env.example .env        # then edit .env and set GEMINI_API_KEY
```

## 7. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | one of the two keys | — | Free Google AI Studio key. Read **only on the server** |
| `ANTHROPIC_API_KEY` | one of the two keys | — | Paid alternative. Read **only on the server** |
| `AI_PROVIDER` | No | `gemini` if `GEMINI_API_KEY` is set, else `anthropic` | Force `gemini` or `anthropic` |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Change if Google retires or renames the model |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Model when using Anthropic |
| `PORT` | No | `3000` | HTTP port (hosting platforms set this automatically) |
| `RATE_LIMIT_PER_MIN` | No | `20` | Max `/api/ask` requests per IP per minute |

`.env` is git-ignored. If the key is missing the app still starts and the UI shows a clear "not set up" message instead of crashing.

## 8. How to run

```bash
npm start
# open http://localhost:3000
```

`GET /api/health` reports whether a key is configured (never the key itself).

## 9. How to test

```bash
npm test
```

Last verified result (Node v22): **56 tests, 56 pass, 0 fail.** Covers: price formatting, language fallback, confidence → handoff logic, high-stakes screening (English + Tamil), parsing of malformed / fenced / out-of-range model JSON, request validation, image validation (type sniffed from bytes, 5 MB limit, non-image rejected), correct multimodal request shape, missing API key, the Gemini adapter (request shape, key kept out of the URL, error mapping), provider selection, upstream failures (429 / 401 / 5xx / timeout) without leaking details, rate limiting, malformed JSON bodies, that only `public/` and `lib/logic.js` are served (not `server.js`, `.env`, …), that the frontend contains no key and no claude.ai-artifact dependency, and `.env` parsing.

The tests use fake AI clients, so they need no API key and make no network calls. **No accuracy figures are claimed:** we have not measured answer quality or diagnosis accuracy.

## 10. Deployment (Render, free tier)

1. Push this repository to GitHub.
2. In [Render](https://render.com): **New → Web Service** → connect the repo (or **New → Blueprint** to use the included `render.yaml`).
3. Settings: Runtime **Node**, Build command `npm ci`, Start command `npm start`.
4. **Environment → Add variable:** `GEMINI_API_KEY` = your free key from <https://aistudio.google.com/apikey> (or `ANTHROPIC_API_KEY` if you use Anthropic).
5. Deploy, then open `https://<your-service>.onrender.com/api/health` — it should show `"apiKeyConfigured": true` and the active provider.
6. Open the root URL and ask a question.

Any Node host works the same way (Railway, Fly.io, Heroku…): run `npm install`, start with `npm start`, set the API key variable. Note: Render's free tier sleeps when idle — open the URL once before a demo to wake it. The URL is public, so keep the rate limit on; if you use a paid key, also set a spend limit.

## 11. Known limitations (please read)

- **Confidence is self-reported by the model** and not calibrated. It is a useful signal, not a guarantee; that is why high-stakes topics are routed to a human regardless of reported confidence.
- The high-stakes screen is a simple English/Tamil keyword list, not a classifier. It will miss some phrasings and over-trigger on others.
- **Photo diagnosis is unvalidated.** A photo is often not enough to identify a disease; answers are framed as "possible causes", never certain diagnoses.
- **Mandi prices are a static snapshot** of representative values, not live or official. A production deployment would feed the same table from a live government mandi source (e.g. data.gov.in); this is not implemented.
- **Scheme text is a short summary**, not official guidance, and has not been audited against official portals. It never decides eligibility.
- Only English and Tamil. Tamil speech recognition/voices depend on the browser and OS; Chrome works best, and some devices have no Tamil voice.
- Rate limiting is in-memory (per server process). There is no user login or database; questions are not stored or logged by the server.
- **The live Gemini and Anthropic APIs have not been called by us from this codebase's test runs**: the backend was verified against fake provider servers (request shape, error handling) and the UI in a simulated browser. Run one real question per provider after deploying.
- **Free-tier terms:** Google's free Gemini tier is rate-limited (exact limits are shown in the AI Studio console) and, per Google, free-tier requests may be used to improve Google products — avoid sending sensitive personal data. Hitting the free limit surfaces in the UI as a "busy, try again" message.
- Answer quality, Tamil quality and photo analysis differ between providers and models and have not been compared or measured.

## 12. AI tools used

See [`AI_TOOLS.md`](./AI_TOOLS.md).

## 13. External APIs / data sources

- **Google Gemini API** (free tier, via Google AI Studio) and/or **Anthropic Messages API** — the runtime AI service; one is used per deployment, chosen by environment variables.
- **Browser Web Speech API** — speech recognition and synthesis. In Chrome, recognition is performed by the browser vendor's cloud speech service, so audio leaves the device.
- **Google Fonts** (Fraunces, Hind) — loaded by the browser; the page falls back to system fonts if blocked.
- **Datasets:** none. No model was trained or fine-tuned. Mandi values and scheme summaries are hand-curated demo content embedded in `public/index.html`.

## 14. Repository layout

```
server.js          Express app: static files + POST /api/ask + /api/health
lib/ask.js         Request/image validation, prompt, model call, response shaping
lib/gemini.js      Gemini REST adapter (same interface as the Anthropic client)
lib/logic.js       Pure logic shared by server and browser (parsing, handoff rules)
lib/env.js         Tiny .env loader (no dependency)
public/index.html  The whole frontend
tests/             logic.test.js, ask.test.js
render.yaml        Optional Render blueprint
.env.example       Template for local configuration
AI_TOOLS.md        AI tool / API / library disclosure
DEMO_SCRIPT.md     3-minute demo walkthrough
```

## 15. Safety and human-handoff design

The system must not present uncertain output as fact. Layers, all enforced on the **server** so a modified browser cannot bypass them:

1. **The model is instructed** (identically for either provider) to say when it is unsure, to never invent pesticide doses or loan/insurance amounts, to treat photos as "possible causes", to never decide scheme eligibility, and to describe mandi prices as a non-live sample. It returns `{answer, confidence, needs_expert}`.
2. **Handoff triggers** — the response is flagged `needsExpert` when any of these is true:
   - confidence is below **0.55** (`low_confidence`)
   - the model itself sets `needs_expert` (`model_flagged`)
   - the farmer's question matches the **high-stakes screen** — chemicals, doses, spraying, loans, compensation — regardless of confidence (`high_stakes`)
   - confidence could not be verified: malformed reply, missing or out-of-range confidence, or a truncated reply (`unverified`) — **missing confidence is never treated as certainty**
3. **The UI** then shows a clear banner (English or Tamil) telling the farmer to confirm with an agriculture expert before acting, with the Kisan Call Centre number (1800-180-1551), and colours the answer box as a warning. The app does not itself connect the call — it tells the farmer whom to contact.
4. **Scheme answers** are labelled informational only; final eligibility is decided by the government / local agriculture office.
5. **Failures degrade safely:** API errors, timeouts, rate limits, a missing key, bad images and an unreachable server each produce a specific farmer-facing message (Tamil or English); the page never crashes and error details never reach the browser.
