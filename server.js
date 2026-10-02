// UzhavAI server: serves the frontend AND the /api/ask backend from one origin.
// The AI API key (GEMINI_API_KEY or ANTHROPIC_API_KEY) is read from environment
// variables and never leaves this process — the browser only talks to /api/ask.
//
//   npm install && npm start      (then open http://localhost:3000)

const path = require("path");
const express = require("express");
require("./lib/env").loadDotEnv(); // local dev convenience; hosting platforms set real env vars
const { ask, AskError, LIMITS } = require("./lib/ask");
const { createGeminiClient } = require("./lib/gemini");

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

  app.get("/api/health", (req, res) => {
    // Reports only whether a key is configured — never the key itself.
    res.json({ ok: true, provider: currentProvider(), apiKeyConfigured: keyConfigured(), model: getModel() });
  });

  app.post("/api/ask", createRateLimiter(rateLimit), async (req, res) => {
    try {
      res.json(await ask(req.body, { getClient, model: getModel() }));
    } catch (err) {
      if (err instanceof AskError) return res.status(err.status).json({ error: err.code });
      console.error("Unexpected /api/ask failure:", err && err.message);
      res.status(500).json({ error: "server_error" });
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
  });
}

module.exports = { createApp, createRateLimiter, currentProvider, DEFAULT_MODEL, DEFAULT_GEMINI_MODEL, LIMITS };
