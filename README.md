# UzhavAI — Ask in your language. Farm smarter.

**Build Fast with AI: AI Build Challenge 2026 · PS-06 — AI for Bharat in Indian Languages**
Team Slytherin — Madhu Chandrika A, Mahalakshmi S

**Deployment:** Pending. No deployed app URL is currently configured.

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
| Voice input (browser Web Speech API, `ta-IN` / `en-IN`) | ✅ Implemented; Chrome recommended |
| Spoken answers | ✅ Browser playback uses `speechSynthesis` (Tamil requires an installed Tamil voice); Twilio phone voice uses Google `ta-IN` for Tamil and Polly Aditi (`en-IN`) for English |
| Crop photo analysis (multimodal Gemini / Claude) | ✅ Implemented — photo downscaled in browser, validated and analyzed by AI |
| Mandi prices | ✅ `/api/mandi` supports data.gov.in AgMarkNet when `DATAGOV_API_KEY` is configured and the upstream request succeeds; otherwise it returns clearly labeled static demo fallback data. Successful live access has not been verified for this submission. |
| Government Scheme Navigator | ✅ Implemented (`lib/rag.js`, `/api/schemes`) for PM-KISAN, PMFBY, SMAM, PM-KUSUM, micro-irrigation, KCC, and Soil Health; summaries are informational, not official eligibility decisions |
| Agricultural retrieval (RAG) | ✅ Implemented using knowledge embedded in `lib/rag.js` and mandi endpoint data when available; it does not fetch live ICAR or State Department advisory feeds |
| Indian-language voice call-in | ✅ TwiML routes are implemented; using them with real callers requires Twilio credentials, a public webhook URL configured in Twilio, and an AI provider key. Phone voice uses Google `ta-IN` for Tamil and Polly Aditi (`en-IN`) for English. Real calls are not verified here. |
| WhatsApp intake | ✅ TwiML route is implemented for text and image handling; real delivery requires Twilio credentials, a public webhook URL configured in Twilio, and an AI provider key. Real WhatsApp messages/media are not verified here. |
| Confidence check + human safety net | ✅ Implemented (Kisan Call Centre 1800-180-1551 handoff) |

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

Features marked implemented describe code present in this repository. External integrations are conditional: AI answers require a Gemini or Anthropic key; live mandi data requires `DATAGOV_API_KEY` and a successful data.gov.in response; real Twilio voice and WhatsApp traffic requires Twilio credentials and public webhook configuration. This repository's tests use fakes and do not establish that those external services work with deployed credentials.

## 5. Tech stack

- **Frontend:** vanilla HTML/CSS/JS — no build step, no framework
- **Backend:** Node.js (≥18) + Express 4
- **AI (pick one, both multimodal):** Google Gemini via REST — **free key**, default model `gemini-2.5-flash` — or Anthropic Claude (`@anthropic-ai/sdk`, default `claude-sonnet-4-6`). Both go through the same validation, prompt and safety logic
- **Browser speech:** Web Speech API for speech recognition and `speechSynthesis` for spoken answers. Tamil browser playback requires an installed Tamil voice. For Twilio phone calls, TwiML selects Google `ta-IN` for Tamil and Polly Aditi (`en-IN`) for English.
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
| `DATAGOV_API_KEY` | No | — | Enables live mandi requests to data.gov.in; absent or unsuccessful requests use labeled static demo fallback values |
| `TWILIO_ACCOUNT_SID` | No | — | Twilio account SID; required with the auth token for real Twilio media access and integration |
| `TWILIO_AUTH_TOKEN` | No | — | Twilio auth token; keep secret and configure outside the repository |
| `TWILIO_PHONE_NUMBER` | No | — | Your Twilio voice number; configure the public voice webhook in Twilio |
| `TWILIO_WHATSAPP_NUMBER` | No | — | Your Twilio WhatsApp sender/sandbox number; configure the public messaging webhook in Twilio |

Example placeholder values only (replace locally; never commit credentials): `DATAGOV_API_KEY=your_data_gov_api_key`, `TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`, `TWILIO_AUTH_TOKEN=your_twilio_auth_token`, `TWILIO_PHONE_NUMBER=+1XXXXXXXXXX`, `TWILIO_WHATSAPP_NUMBER=whatsapp:+1XXXXXXXXXX`.

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

Last verified result (Node v22): **105 tests, 105 pass, 0 fail (covering logic, AI providers, mandi API & caching, RAG retrieval, schemes, and Twilio voice/WhatsApp intake).** Covers: price formatting, language fallback, confidence → handoff logic, high-stakes screening (English + Tamil), parsing of malformed / fenced / out-of-range model JSON, request validation, image validation (type sniffed from bytes, 5 MB limit, non-image rejected), correct multimodal request shape, missing API key, the Gemini adapter (request shape, key kept out of the URL, error mapping), provider selection, upstream failures (429 / 401 / 5xx / timeout) without leaking details, rate limiting, malformed JSON bodies, that only `public/` and `lib/logic.js` are served (not `server.js`, `.env`, …), that the frontend contains no key and no claude.ai-artifact dependency, and `.env` parsing.

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
- **Mandi prices:** live data is available when `DATAGOV_API_KEY` is configured and data.gov.in returns usable records. Without a key, or if the request fails or returns no usable records, the app uses clearly labeled static demo values. Live upstream access has not been verified for this submission; cached results are identified as cached data from data.gov.in.
- **Scheme text is a short summary**, not official guidance, and has not been audited against official portals. It never decides eligibility.
- Only English and Tamil. Tamil speech recognition/voices depend on the browser and OS; Chrome works best, and some devices have no Tamil voice.
- Rate limiting is in-memory (per server process). There is no user login or database; questions are not stored or logged by the server.
- **External-service verification:** the test suite uses fake AI clients and fake mandi responses. It does not prove that live Gemini/Anthropic, data.gov.in, Twilio voice calls, or WhatsApp messages/media were successfully used. Configure the required credentials and public webhooks, then verify each service in its deployment environment.
- **Free-tier terms:** Google's free Gemini tier is rate-limited (exact limits are shown in the AI Studio console) and, per Google, free-tier requests may be used to improve Google products — avoid sending sensitive personal data. Hitting the free limit surfaces in the UI as a "busy, try again" message.
- Answer quality, Tamil quality and photo analysis differ between providers and models and have not been compared or measured.

## 12. AI tools used

See [`AI_TOOLS.md`](./AI_TOOLS.md).

## 13. External APIs / data sources

- **Google Gemini API** (free tier, via Google AI Studio) and/or **Anthropic Messages API** — the runtime AI service; one is used per deployment, chosen by environment variables.
- **Browser Web Speech API** — speech recognition and synthesis. In Chrome, recognition is performed by the browser vendor's cloud speech service, so audio leaves the device.
- **Google Fonts** (Fraunces, Hind) — loaded by the browser; the page falls back to system fonts if blocked.
- **Datasets:** none. No model was trained or fine-tuned. Static mandi fallback values and scheme/advisory knowledge are embedded in the app; live mandi values are conditional on data.gov.in access.

## 14. Repository layout

```
server.js          Express app: static files + /api/ask + /api/mandi + /api/schemes + Twilio
lib/ask.js         Request/image validation, prompt, model call, response shaping
lib/gemini.js      Gemini REST adapter (same interface as the Anthropic client)
lib/logic.js       Pure logic shared by server and browser (parsing, handoff rules)
lib/mandi.js       Live mandi price fetcher (data.gov.in AgMarkNet API + 1hr cache)
lib/rag.js         Agricultural RAG engine (ICAR advisories, schemes, mandi data)
lib/twilio.js      Twilio voice call-in and WhatsApp webhook handlers
lib/env.js         Tiny .env loader (no dependency)
public/index.html  The whole frontend (speech, photo analysis, live mandi, schemes)
tests/             logic, ask, mandi, rag, twilio, server-routes (105 tests)
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

## 16. Extended Endpoints & External Integrations

### A. Live Mandi Prices (`/api/mandi`)
- **Endpoint:** `GET /api/mandi`
- **Source:** [data.gov.in AgMarkNet API](https://data.gov.in/user/register) (Current Daily Price of Commodities), when configured and returning usable records.
- **Behavior:**
  - With `DATAGOV_API_KEY` and a successful upstream response: Fetches prices for Tamil Nadu markets, cached in-memory for 1 hour.
  - Without a key, or when the upstream request fails or yields no usable records: Serves clearly labeled static representative demo prices.
- **Response:** `{ prices: [...], source: "live"|"cache"|"static", fetchedAt: "..." }`

### B. Grounded Government Scheme Navigator (`/api/schemes`)
- **Endpoint:** `GET /api/schemes?lang=ta` (or `en`), optional `?category=subsidy`
- **Covered Schemes:**
  - **PM-KISAN:** ₹6,000/yr income support, eligibility criteria, exclusion list.
  - **PMFBY:** Crop insurance coverage, premium rates (1.5%-2%), 72h claim cutoff.
  - **SMAM:** Agricultural mechanization & tractor subsidy (40%-50%).
  - **PM-KUSUM:** Standalone solar irrigation pump subsidy (60%-70%).
  - **Micro-Irrigation (PMKSY):** 100% drip/sprinkler subsidy for small/marginal farmers in TN.
  - **KCC:** Concessional short-term crop loans at 4% effective interest up to ₹3 Lakh.
  - **Soil Health Card:** Free 12-parameter soil testing every 2 years.

### C. Agricultural RAG Engine (`lib/rag.js`)
- Uses embedded crop-protection advisory and government-scheme reference content plus mandi data when available; it does not retrieve live ICAR or State Agriculture Department advisory feeds.
- Automatically searches grounded knowledge for crop pests (Rice blast, stem borer, tomato blight, leaf curl, banana Panama wilt, onion purple blotch) and injects grounded reference notes into the AI reasoning prompt.
- Price questions include the available mandi result in AI context, labeled as live-source, cached, or static fallback according to its source.

### D. Indian-Language Voice Call-In (`/api/twilio/voice`)
- **Inbound call:** Farmer dials your Twilio phone number -> `POST /api/twilio/voice`.
- **Speech intake:** Twilio collects speech in Tamil (`ta-IN`) or English (`en-IN`).
- **Processing:** Answer generated by UzhavAI reasoning engine within 60 seconds.
- **Voice output:** TwiML uses Google `ta-IN` for Tamil and Amazon Polly Aditi (`en-IN`) for English. A real call requires configured Twilio credentials and a publicly reachable webhook; real calls have not been verified for this submission.
- **Safety net:** High-stakes questions automatically append Kisan Call Centre (1800-180-1551) referral.

### E. WhatsApp Intake (`/api/twilio/whatsapp`)
- **Message intake:** The webhook code accepts Twilio form posts containing text and image metadata.
- **Multimodal analysis:** When credentials allow media download, image content is passed to the configured AI provider; the code is not limited to Gemini.
- **Response:** The handler returns TwiML. Real WhatsApp delivery/media handling requires Twilio credentials, public webhook configuration, and deployment verification; it has not been verified for this submission.
