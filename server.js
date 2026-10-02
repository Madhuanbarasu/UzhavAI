// UzhavAI server: serves the frontend AND the /api/ask backend from one origin.
// The AI API key (GEMINI_API_KEY or ANTHROPIC_API_KEY) is read from environment
// variables and never leaves this process — the browser only talks to /api/ask.
//
//   node server.js      (then open http://localhost:3000)

const path = require("path");
const express = require("express");
require("./lib/env").loadDotEnv(); // local dev convenience; hosting platforms set real env vars
const { ask, AskError, LIMITS } = require("./lib/ask");
const { createGeminiClient } = require("./lib/gemini");
const { fetchMandiPrices } = require("./lib/mandi");
const { handleVoiceCall, handleVoiceGather, handleWhatsApp } = require("./lib/twilio");
const { retrieveContext, SCHEMES_KNOWLEDGE } = require("./lib/rag");

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"; // override with GEMINI_MODEL if Google retires it

// Tiny fixed-window per-IP limiter so a public deployment can't burn through
// the API budget. In-memory = per-process, which is fine for a single instance.
function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    let e = hits.get(key);
    if (!e || now - e.start >= windowMs) { e = { start: now, n: 0 }; hits.set(key, e); }
    e.n += 1;
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    if (e.n > max) {
      res.set("Retry-After", String(Math.ceil((e.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: "rate_limited" });
    }
    next();
  };
}

// Which AI provider to use. AI_PROVIDER wins if set; otherwise Gemini when a
// GEMINI_API_KEY exists (free key from Google AI Studio), else Anthropic.
const has = (v) => Boolean(v && v.trim());
function currentProvider() {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "gemini" || p === "anthropic") return p;
  return has(process.env.GEMINI_API_KEY) ? "gemini" : "anthropic";
}
function currentModel() {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (currentProvider() === "gemini") return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}
function keyConfigured() {
  return has(currentProvider() === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY);
}

// Lazily build the client so the app still boots (and shows a clear message)
// when the key is missing, instead of crashing at startup.
function defaultGetClient() {
  if (!keyConfigured()) throw new AskError(503, "missing_api_key", "No API key configured for provider " + currentProvider());
  if (currentProvider() === "gemini") return createGeminiClient({ apiKey: process.env.GEMINI_API_KEY });
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 40000, maxRetries: 1 }); // honours ANTHROPIC_BASE_URL
}

function createApp({ getClient = defaultGetClient, model, rateLimit = { max: Number(process.env.RATE_LIMIT_PER_MIN) || 20, windowMs: 60000 } } = {}) {
  const app = express();
  const getModel = () => model || currentModel(); // resolved per request so env changes/tests apply
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // correct client IP behind Render/Railway/Fly proxies
  app.use((req, res, next) => { res.set("X-Content-Type-Options", "nosniff"); next(); });

  // Body limit: a 5 MB image is ~6.7 MB as base64, plus the prompt.
  app.use(express.json({ limit: "8mb" }));
  // URL-encoded parser for Twilio webhooks (Twilio sends form-encoded POST bodies).
  app.use(express.urlencoded({ extended: false }));

  app.get("/api/health", (req, res) => {
    // Reports only whether a key is configured — never the key itself.
    res.json({
      ok: true,
      provider: currentProvider(),
      apiKeyConfigured: keyConfigured(),
      model: getModel(),
      mandiLive: Boolean(process.env.DATAGOV_API_KEY && process.env.DATAGOV_API_KEY.trim()),
      twilioConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      ragConfigured: true,
    });
  });

  app.post("/api/ask", createRateLimiter(rateLimit), async (req, res) => {
    try {
      const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body))
        ? { ...req.body }
        : req.body;
      if (body && typeof body === "object" && !body.context && typeof body.prompt === "string" && body.prompt.trim()) {
        try {
          body.context = await retrieveContext(body.prompt, { lang: body.lang || "en" });
        } catch (e) {
          // degradation: continue without RAG context
        }
      }
      res.json(await ask(body, { getClient, model: getModel() }));
    } catch (err) {
      if (err instanceof AskError) return res.status(err.status).json({ error: err.code });
      console.error("Unexpected /api/ask failure:", err && err.message);
      res.status(500).json({ error: "server_error" });
    }
  });

  // --- Live mandi prices endpoint -------------------------------------------
  // Returns real-time prices from data.gov.in when DATAGOV_API_KEY is set,
  // otherwise returns labelled static fallback prices.
  app.get("/api/mandi", async (req, res) => {
    try {
      const result = await fetchMandiPrices();
      res.json(result);
    } catch (err) {
      console.error("Mandi fetch error:", err && err.message);
      res.status(500).json({ error: "mandi_unavailable" });
    }
  });

  // --- Government Schemes & Subsidies endpoint ------------------------------
  // Returns grounded scheme details, eligibility guidelines, and portals.
  app.get("/api/schemes", (req, res) => {
    const lang = req.query.lang === "ta" ? "ta" : "en";
    const category = req.query.category;
    let list = SCHEMES_KNOWLEDGE;
    if (category) list = list.filter((s) => s.category === category);
    const data = list.map((s) => ({
      id: s.id,
      name: lang === "ta" ? s.name_ta : s.name,
      category: s.category,
      summary: lang === "ta" ? s.summary_ta : s.summary_en,
      eligibility: lang === "ta" ? s.eligibility_ta : s.eligibility_en,
      portal: s.portal,
      helpline: s.helpline,
    }));
    res.json({ ok: true, lang, count: data.length, schemes: data });
  });

  // --- Twilio phone voice webhooks ------------------------------------------
  // These routes are called by Twilio's servers, not the browser.
  // Twilio sends form-encoded bodies; we respond with TwiML XML.
  //
  // Configure in Twilio console:
  //   Voice (incoming): POST https://yourdomain/api/twilio/voice
  //   Gather action:    POST https://yourdomain/api/twilio/voice/gather

  // Helper: wrap ask() for Twilio handlers (takes plain prompt + lang string + optional image).
  async function askWrapper(prompt, lang, opts = {}) {
    let context = opts && opts.context;
    if (!context) {
      try {
        context = await retrieveContext(prompt, { lang });
      } catch (e) {
        context = "";
      }
    }
    return ask({ prompt, lang, context, imageBase64: opts && opts.imageBase64 }, { getClient, model: getModel() });
  }

  app.post("/api/twilio/voice", (req, res) => {
    try {
      const twiml = handleVoiceCall(req.body);
      res.type("text/xml").send(twiml);
    } catch (err) {
      console.error("Twilio voice error:", err && err.message);
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, a technical problem occurred. Please try again.</Say></Response>');
    }
  });

  app.post("/api/twilio/voice/gather", async (req, res) => {
    try {
      const twiml = await handleVoiceGather(req.body, askWrapper);
      res.type("text/xml").send(twiml);
    } catch (err) {
      console.error("Twilio voice gather error:", err && err.message);
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, a technical problem occurred. Please try again.</Say></Response>');
    }
  });

  // --- Twilio WhatsApp webhook -----------------------------------------------
  // Configure in Twilio console: WhatsApp incoming message webhook.
  // Twilio sends form-encoded body; we respond with valid TwiML XML (<Response><Message>...</Message></Response>).
  app.post("/api/twilio/whatsapp", async (req, res) => {
    try {
      const twiml = await handleWhatsApp(req.body, askWrapper);
      res.type("text/xml").send(twiml);
    } catch (err) {
      console.error("Twilio WhatsApp error:", err && err.message);
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, a technical problem occurred. Please try again.</Message></Response>');
    }
  });

  // Only the public/ folder and the one shared logic file are exposed — never
  // the project root (which would leak server.js, package.json, a stray .env…).
  app.get("/lib/logic.js", (req, res) => res.sendFile(path.join(__dirname, "lib", "logic.js")));
  app.use(express.static(path.join(__dirname, "public"), { dotfiles: "ignore" }));

  app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

  // Final error handler: bad JSON -> 400, oversized body -> 413, else generic 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "image_too_large" });
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid_request" });
    console.error("Unhandled error:", err && err.message);
    res.status(500).json({ error: "server_error" });
  });
  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createApp().listen(PORT, () => {
    console.log(`UzhavAI listening on :${PORT} (provider: ${currentProvider()}, model: ${currentModel()})`);
    if (!keyConfigured()) console.warn("WARNING: no API key set (GEMINI_API_KEY or ANTHROPIC_API_KEY) — the UI will load but /api/ask will return missing_api_key.");
    if (process.env.DATAGOV_API_KEY) console.log("INFO: DATAGOV_API_KEY set — live mandi prices enabled at /api/mandi");
    if (process.env.TWILIO_ACCOUNT_SID) console.log("INFO: Twilio configured — phone/WhatsApp webhooks active at /api/twilio/*");
  });
}

module.exports = { createApp, createRateLimiter, currentProvider, DEFAULT_MODEL, DEFAULT_GEMINI_MODEL, LIMITS };
