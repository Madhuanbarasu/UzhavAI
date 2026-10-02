# AI tools, models, APIs, datasets and external resources

This file lists what UzhavAI uses at runtime and what AI assistance was used to build it.

## AI at runtime (part of the product)

| Item | Detail |
|---|---|
| **Google Gemini** via the **Gemini API** (Google AI Studio, free tier) | Default provider when `GEMINI_API_KEY` is set. Answers every farmer question (text, and text + crop photo) and scheme questions. Default model `gemini-2.5-flash` (configurable with `GEMINI_MODEL`). Called only from our backend (`lib/gemini.js`); the key lives in an environment variable and the browser never sees it. Google's free tier may use requests to improve its products. |
| **Anthropic Claude** via the **Anthropic Messages API** | Alternative provider, used when `ANTHROPIC_API_KEY` is set instead (or `AI_PROVIDER=anthropic`). Default model `claude-sonnet-4-6`. Same backend path and safety logic. |
| **Browser Web Speech API** | Speech-to-text (`SpeechRecognition`) and text-to-speech (`speechSynthesis`) run in the user's browser. In Chrome, recognition is handled by the browser vendor's cloud speech service. We run no speech model ourselves. |

No model was trained, fine-tuned or hosted by us.

## AI assistance used to build the project

- **Claude (Anthropic), used through the claude.ai chat interface** — used to draft and iterate on the original MVP (`index.html`, `server.js`), this documentation, the idea-submission deck and the LinkedIn announcement post; and used in a later session to convert the claude.ai-artifact prototype into a standalone Node application (backend `/api/ask`, image validation, safety/handoff logic, tests, README).
- **Claude Code:** not used.
- **Other AI coding tools:** none declared. <!-- TEAM: if you used any other AI tool (e.g. Copilot, Cursor, ChatGPT) while building this, add it here before submitting. -->

All product decisions, the feature set, the demo script, and final review of AI-drafted output were done by the team (Madhu Chandrika A, Mahalakshmi S).

## Datasets

None. There is no training or evaluation dataset.

Embedded demo content (hand-curated, not from a dataset or live API):
- **Mandi Price Snapshot** — five representative crop/market/price rows, labelled in the UI as *not live and not official*.
- **Scheme summaries** — short plain-language notes on PM-KISAN, PMFBY and the Soil Health Card, drafted with Claude's help and not audited against official portals. The app states they are informational only.

## External services and resources

- Google Gemini API / AI Studio — https://aistudio.google.com
- Anthropic API (optional provider) — https://www.anthropic.com/api
- Google Fonts (Fraunces, Hind) — loaded by the browser
- Kisan Call Centre helpline number (1800-180-1551) shown in the handoff message — a public government helpline

## Libraries (runtime)

- `express` — web server
- `@anthropic-ai/sdk` — Anthropic API client (only used if the Anthropic provider is selected)
- Gemini is called with Node's built-in `fetch` — no Gemini SDK
- Node.js built-in modules and test runner (`node:test`) — no other dependencies

Exact versions are pinned in `package-lock.json`.
