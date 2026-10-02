// Tests for the backend: request validation, image validation, prompt/safety
// construction, response handling, and the HTTP layer. The Anthropic client is
// always faked — these tests never make a network call or need an API key.

const test = require("node:test");
const assert = require("node:assert");
const { ask, validateRequest, validateImage, sniffImageType, buildSystemPrompt, buildMessages, AskError, LIMITS } = require("../lib/ask");
const { createApp, createRateLimiter } = require("../server");

// --- helpers ---------------------------------------------------------------
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const jpegB64 = JPEG.toString("base64");

function fakeClient(reply, { capture, stop_reason = "end_turn", throwErr } = {}) {
  return {
    messages: {
      create: async (params) => {
        if (capture) capture.params = params;
        if (throwErr) throw throwErr;
        return { content: [{ type: "text", text: reply }], stop_reason };
      },
    },
  };
}
const deps = (client) => ({ getClient: () => client, model: "test-model" });
const json = (o) => JSON.stringify(o);
const KEY_PREFIX = "sk-" + "ant"; // built dynamically so a repo-wide secret grep stays clean

async function withServer(opts, fn) {
  const app = createApp(opts);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const post = (base, body, raw) => fetch(base + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw !== undefined ? raw : json(body) });

// --- request validation ----------------------------------------------------
test("validateRequest: accepts a normal prompt and defaults lang/mode", () => {
  const r = validateRequest({ prompt: "  my tomato has spots " });
  assert.strictEqual(r.prompt, "my tomato has spots");
  assert.strictEqual(r.lang, "en");
  assert.strictEqual(r.mode, "general");
  assert.strictEqual(r.image, null);
});

test("validateRequest: rejects missing/empty prompt with no image", () => {
  for (const body of [{}, { prompt: "" }, { prompt: "   " }, null, [], "str"]) {
    assert.throws(() => validateRequest(body), (e) => e instanceof AskError && e.status === 400 && e.code === "invalid_request");
  }
});

test("validateRequest: rejects wrong types, bad lang/mode, oversized prompt/context", () => {
  assert.throws(() => validateRequest({ prompt: 123 }), /prompt must be a string/);
  assert.throws(() => validateRequest({ prompt: "x", lang: "fr" }), /lang/);
  assert.throws(() => validateRequest({ prompt: "x", mode: "admin" }), /mode/);
  assert.throws(() => validateRequest({ prompt: "x".repeat(LIMITS.promptChars + 1) }), /at most/);
  assert.throws(() => validateRequest({ prompt: "x", context: "y".repeat(LIMITS.contextChars + 1) }), /context/);
});

test("validateRequest: image with no text gets a default prompt", () => {
  const r = validateRequest({ imageBase64: jpegB64 });
  assert.ok(r.prompt.length > 0);
  assert.strictEqual(r.image.mediaType, "image/jpeg");
});

// --- image validation ------------------------------------------------------
test("validateImage: accepts raw base64 and data URLs; detects type from bytes, not the prefix", () => {
  assert.strictEqual(validateImage(jpegB64).mediaType, "image/jpeg");
  assert.strictEqual(validateImage("data:image/jpeg;base64," + jpegB64).data, jpegB64);
  // lying data-URL prefix: bytes are PNG, claimed JPEG -> we trust the bytes
  assert.strictEqual(validateImage("data:image/jpeg;base64," + PNG.toString("base64")).mediaType, "image/png");
});

test("validateImage: rejects non-image bytes (e.g. an HTML/script payload labelled as an image)", () => {
  const evil = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64");
  assert.throws(() => validateImage(evil), (e) => e.code === "invalid_image" && e.status === 400);
});

test("validateImage: rejects garbage base64 and non-strings", () => {
  assert.throws(() => validateImage("not base64 !!!"), (e) => e.code === "invalid_image");
  assert.throws(() => validateImage(42), (e) => e.code === "invalid_image");
  assert.throws(() => validateImage(""), (e) => e.code === "invalid_image");
});

test("validateImage: rejects images over 5 MB with image_too_large (413)", () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(LIMITS.imageBytes + 10, 7)]).toString("base64");
  assert.throws(() => validateImage(big), (e) => e.code === "image_too_large" && e.status === 413);
});

test("sniffImageType: recognises jpeg/png/gif/webp, rejects others", () => {
  assert.strictEqual(sniffImageType(JPEG), "image/jpeg");
  assert.strictEqual(sniffImageType(PNG), "image/png");
  assert.strictEqual(sniffImageType(Buffer.from("GIF89a....")), "image/gif");
  assert.strictEqual(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
  assert.strictEqual(sniffImageType(Buffer.from("hello world, definitely text")), null);
  assert.strictEqual(sniffImageType(Buffer.alloc(0)), null);
});

// --- prompt / message construction ----------------------------------------
test("buildSystemPrompt: carries language, safety rules and JSON format; notes only when given", () => {
  const ta = buildSystemPrompt("ta", "PM-KISAN note", "general");
  assert.match(ta, /Reply in Tamil only/);
  assert.match(ta, /confirm with a local agriculture expert/i);
  assert.match(ta, /cannot decide anyone's eligibility/);
  assert.match(ta, /NOT live market rates|not live market rates/i);
  assert.match(ta, /"needs_expert"/);
  assert.match(ta, /<notes>\nPM-KISAN note\n<\/notes>/);
  assert.doesNotMatch(buildSystemPrompt("en", "", "general"), /<notes>\n/);
  assert.match(buildSystemPrompt("en", "n", "scheme"), /Answer ONLY from the notes/);
});

test("buildMessages: sends the image as a base64 image block before the text", () => {
  const msgs = buildMessages("what is this?", { mediaType: "image/png", data: "QUJD" });
  assert.strictEqual(msgs[0].role, "user");
  assert.deepStrictEqual(msgs[0].content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
  assert.deepStrictEqual(msgs[0].content[1], { type: "text", text: "what is this?" });
  assert.strictEqual(buildMessages("hi", null)[0].content.length, 1);
});

// --- ask(): normal response, low confidence, malformed, failures ----------
test("ask: successful normal response passes the answer through, no handoff", async () => {
  const cap = {};
  const out = await ask({ prompt: "When should I water banana?", lang: "en" }, deps(fakeClient(json({ answer: "Every 3-4 days in summer.", confidence: 0.9, needs_expert: false }), { capture: cap })));
  assert.strictEqual(out.answer, "Every 3-4 days in summer.");
  assert.strictEqual(out.confidence, 0.9);
  assert.strictEqual(out.needsExpert, false);
  assert.strictEqual(out.reason, null);
  assert.strictEqual(cap.params.model, "test-model");
  assert.match(cap.params.system, /UzhavAI/);
});

test("ask: image is forwarded to the model as multimodal content", async () => {
  const cap = {};
  const out = await ask({ prompt: "leaf spots?", imageBase64: "data:image/jpeg;base64," + jpegB64 }, deps(fakeClient(json({ answer: "Possibly a fungal spot.", confidence: 0.7 }), { capture: cap })));
  assert.strictEqual(out.usedImage, true);
  const blocks = cap.params.messages[0].content;
  assert.strictEqual(blocks[0].type, "image");
  assert.strictEqual(blocks[0].source.media_type, "image/jpeg");
  assert.strictEqual(blocks[0].source.data, jpegB64);
});

test("ask: low confidence triggers expert handoff", async () => {
  const out = await ask({ prompt: "Is this a virus?" }, deps(fakeClient(json({ answer: "Not sure.", confidence: 0.3 }))));
  assert.strictEqual(out.needsExpert, true);
  assert.strictEqual(out.reason, "low_confidence");
});

test("ask: model-flagged needs_expert triggers handoff even at high confidence", async () => {
  const out = await ask({ prompt: "Is my crop ok?" }, deps(fakeClient(json({ answer: "Probably.", confidence: 0.95, needs_expert: true }))));
  assert.strictEqual(out.needsExpert, true);
  assert.strictEqual(out.reason, "model_flagged");
});

test("ask: high-stakes question (chemical dose) forces handoff even if the model is confident", async () => {
  const out = await ask({ prompt: "How many ml of pesticide per litre should I spray?" }, deps(fakeClient(json({ answer: "Use 2 ml.", confidence: 0.99 }))));
  assert.strictEqual(out.needsExpert, true);
  assert.strictEqual(out.reason, "high_stakes");
  assert.strictEqual(out.highStakes, true);
});

test("ask: malformed model reply does not throw — raw text shown and flagged as unverified", async () => {
  const out = await ask({ prompt: "hello" }, deps(fakeClient("Sorry, I'm not sure — {broken")));
  assert.strictEqual(out.answer, "Sorry, I'm not sure — {broken");
  assert.strictEqual(out.confidence, null);
  assert.strictEqual(out.needsExpert, true);
  assert.strictEqual(out.reason, "unverified");
});

test("ask: JSON wrapped in markdown fences is still parsed", async () => {
  const out = await ask({ prompt: "hello" }, deps(fakeClient('```json\n{"answer":"Fine.","confidence":0.8}\n```')));
  assert.strictEqual(out.answer, "Fine.");
  assert.strictEqual(out.needsExpert, false);
});

test("ask: out-of-range confidence is not trusted -> unverified handoff", async () => {
  const out = await ask({ prompt: "hello" }, deps(fakeClient(json({ answer: "Sure.", confidence: 95 }))));
  assert.strictEqual(out.confidence, null);
  assert.strictEqual(out.needsExpert, true);
});

test("ask: a reply cut off at max_tokens is treated as unverified", async () => {
  const out = await ask({ prompt: "hello" }, deps(fakeClient(json({ answer: "Half an ans", confidence: 0.9 }), { stop_reason: "max_tokens" })));
  assert.strictEqual(out.needsExpert, true);
  assert.strictEqual(out.reason, "unverified");
});

test("ask: empty model reply -> upstream_error (502)", async () => {
  await assert.rejects(ask({ prompt: "hi" }, deps(fakeClient("   "))), (e) => e.status === 502 && e.code === "upstream_error");
});

test("ask: missing API key surfaces as missing_api_key (503) from getClient", async () => {
  const getClient = () => { throw new AskError(503, "missing_api_key"); };
  await assert.rejects(ask({ prompt: "hi" }, { getClient, model: "m" }), (e) => e.status === 503 && e.code === "missing_api_key");
});

test("ask: upstream failures map to safe codes without leaking details", async () => {
  const cases = [
    [{ status: 429 }, 429, "rate_limited"],
    [{ status: 401 }, 503, "missing_api_key"],
    [{ status: 500, message: "secret internal detail" }, 502, "upstream_error"],
    [{ name: "APIConnectionTimeoutError" }, 504, "upstream_unavailable"],
    [new Error("boom"), 502, "upstream_error"],
  ];
  for (const [err, status, code] of cases) {
    await assert.rejects(ask({ prompt: "hi" }, deps(fakeClient("", { throwErr: err }))), (e) => e.status === status && e.code === code && !/secret/.test(e.message));
  }
});

test("ask: invalid input is rejected BEFORE any model call", async () => {
  let called = false;
  const client = { messages: { create: async () => { called = true; return {}; } } };
  await assert.rejects(ask({ prompt: "x", imageBase64: "bogus!!" }, deps(client)), (e) => e.code === "invalid_image");
  assert.strictEqual(called, false);
});

// --- HTTP layer ------------------------------------------------------------
test("HTTP: POST /api/ask returns 200 with the structured answer", async () => {
  await withServer({ getClient: () => fakeClient(json({ answer: "Hello farmer.", confidence: 0.8 })) }, async (base) => {
    const r = await post(base, { prompt: "hi", lang: "en" });
    assert.strictEqual(r.status, 200);
    const b = await r.json();
    assert.strictEqual(b.answer, "Hello farmer.");
    assert.strictEqual(b.needsExpert, false);
  });
});

test("HTTP: missing API key (either provider) -> 503 missing_api_key, server stays up", async () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, g: process.env.GEMINI_API_KEY, p: process.env.AI_PROVIDER };
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.AI_PROVIDER;
  try {
    await withServer({}, async (base) => { // default getClient reads the env
      const r = await post(base, { prompt: "hi" });
      assert.strictEqual(r.status, 503);
      assert.deepStrictEqual(await r.json(), { error: "missing_api_key" });
      const h = await (await fetch(base + "/api/health")).json();
      assert.strictEqual(h.apiKeyConfigured, false);
      assert.strictEqual((await fetch(base + "/")).status, 200); // UI still loads
    });
  } finally {
    if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.g !== undefined) process.env.GEMINI_API_KEY = saved.g;
    if (saved.p !== undefined) process.env.AI_PROVIDER = saved.p;
  }
});

test("HTTP: invalid body/image/malformed JSON -> 400, oversized -> 413", async () => {
  await withServer({ getClient: () => fakeClient(json({ answer: "x", confidence: 0.9 })) }, async (base) => {
    let r = await post(base, {});
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await r.json()).error, "invalid_request");
    r = await post(base, { prompt: "hi", imageBase64: "data:image/png;base64," + Buffer.from("not an image").toString("base64") });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await r.json()).error, "invalid_image");
    r = await post(base, null, "{not json");
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await r.json()).error, "invalid_request");
    r = await post(base, null, json({ prompt: "hi", imageBase64: "A".repeat(9 * 1024 * 1024) }));
    assert.strictEqual(r.status, 413);
    assert.strictEqual((await r.json()).error, "image_too_large");
  });
});

test("HTTP: upstream API failure -> clean JSON error, no stack/secret leaked, next request still works", async () => {
  let fail = true;
  const client = { messages: { create: async () => { if (fail) { const e = new Error(KEY_PREFIX + "-SECRET stack trace"); e.status = 500; throw e; } return { content: [{ type: "text", text: json({ answer: "ok", confidence: 0.9 }) }], stop_reason: "end_turn" }; } } };
  await withServer({ getClient: () => client }, async (base) => {
    let r = await post(base, { prompt: "hi" });
    assert.strictEqual(r.status, 502);
    const txt = await r.text();
    assert.deepStrictEqual(JSON.parse(txt), { error: "upstream_error" });
    assert.doesNotMatch(txt, new RegExp(KEY_PREFIX + "|stack"));
    fail = false;
    r = await post(base, { prompt: "hi" });
    assert.strictEqual(r.status, 200);
  });
});

test("HTTP: rate limiter returns 429 after the cap", async () => {
  await withServer({ getClient: () => fakeClient(json({ answer: "x", confidence: 0.9 })), rateLimit: { max: 2, windowMs: 60000 } }, async (base) => {
    assert.strictEqual((await post(base, { prompt: "a" })).status, 200);
    assert.strictEqual((await post(base, { prompt: "b" })).status, 200);
    const r = await post(base, { prompt: "c" });
    assert.strictEqual(r.status, 429);
    assert.strictEqual((await r.json()).error, "rate_limited");
  });
});

test("createRateLimiter: window resets", () => {
  const rl = createRateLimiter({ max: 1, windowMs: 1 });
  const res = () => ({ set() {}, status() { return this; }, json() { return this; } });
  let passed = 0; const next = () => passed++;
  rl({ ip: "1.1.1.1" }, res(), next);
  return new Promise((r) => setTimeout(() => { rl({ ip: "1.1.1.1" }, res(), next); assert.strictEqual(passed, 2); r(); }, 10));
});

test("HTTP: only public/ and lib/logic.js are served — source/config files are not", async () => {
  await withServer({}, async (base) => {
    assert.strictEqual((await fetch(base + "/")).status, 200);
    assert.match(await (await fetch(base + "/lib/logic.js")).text(), /UzhavLogic/);
    for (const p of ["/server.js", "/package.json", "/.env", "/lib/ask.js", "/node_modules/express/package.json", "/tests/ask.test.js"]) {
      const r = await fetch(base + p);
      assert.notStrictEqual(r.status, 200, p + " must not be served");
    }
  });
});

test("frontend: contains no API key and no claude-artifact dependency", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "index.html"), "utf8");
  assert.doesNotMatch(html, new RegExp(KEY_PREFIX + "-"));
  assert.doesNotMatch(html, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(html, /claude\.use\(/);
  assert.match(html, /fetch\("\/api\/ask"/);
});

// --- .env loader -----------------------------------------------------------
test("env: parseEnv handles comments, quotes, export, blanks", () => {
  const { parseEnv } = require("../lib/env");
  const r = parseEnv('# c\nANTHROPIC_API_KEY="abc123"\n\nexport PORT=4000\nMODEL=m # trailing\nBAD LINE\nQ=\'x y\'\n');
  assert.deepStrictEqual(r, { ANTHROPIC_API_KEY: "abc123", PORT: "4000", MODEL: "m", Q: "x y" });
});

test("env: loadDotEnv fills missing vars but never overrides real environment; missing file is fine", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { loadDotEnv } = require("../lib/env");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uz-")), ".env");
  fs.writeFileSync(f, "A=fromfile\nB=fromfile\n");
  const env = { B: "real" };
  assert.strictEqual(loadDotEnv(f, env), true);
  assert.deepStrictEqual(env, { A: "fromfile", B: "real" });
  assert.strictEqual(loadDotEnv(f + ".missing", {}), false);
});

// --- Gemini adapter (free-tier provider) -----------------------------------
const { createGeminiClient, toGeminiBody, fromGeminiResponse } = require("../lib/gemini");
const { currentProvider } = require("../server");

function fakeFetch(respond, capture) {
  return async (url, opts) => {
    if (capture) { capture.url = url; capture.opts = opts; capture.body = JSON.parse(opts.body); }
    const { status = 200, body } = respond(url, opts);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}
const gemOk = (text, finishReason = "STOP") => ({ body: { candidates: [{ content: { parts: [{ text }] }, finishReason }] } });

test("gemini: request carries system prompt, image as inlineData, text, and key only in a header", async () => {
  const cap = {};
  const client = createGeminiClient({ apiKey: "KEY123", baseUrl: "http://x/v1beta", fetchImpl: fakeFetch(() => gemOk(json({ answer: "ok", confidence: 0.9 })), cap) });
  const out = await ask({ prompt: "leaf spots?", imageBase64: "data:image/jpeg;base64," + jpegB64, lang: "ta" }, { getClient: () => client, model: "gemini-test" });
  assert.strictEqual(out.answer, "ok");
  assert.strictEqual(out.usedImage, true);
  assert.strictEqual(cap.url, "http://x/v1beta/models/gemini-test:generateContent");
  assert.strictEqual(cap.opts.headers["x-goog-api-key"], "KEY123");
  assert.ok(!cap.url.includes("KEY123"), "key must not be in the URL");
  assert.match(cap.body.systemInstruction.parts[0].text, /Reply in Tamil only/);
  const parts = cap.body.contents[0].parts;
  assert.deepStrictEqual(parts[0], { inlineData: { mimeType: "image/jpeg", data: jpegB64 } });
  assert.deepStrictEqual(parts[1], { text: "leaf spots?" });
});

test("gemini: handoff logic is shared (low confidence, malformed, MAX_TOKENS)", async () => {
  const run = (reply) => ask({ prompt: "hello" }, { getClient: () => createGeminiClient({ apiKey: "k", fetchImpl: fakeFetch(() => reply) }), model: "m" });
  assert.strictEqual((await run(gemOk(json({ answer: "?", confidence: 0.2 })))).reason, "low_confidence");
  assert.strictEqual((await run(gemOk("not json at all"))).reason, "unverified");
  assert.strictEqual((await run(gemOk(json({ answer: "cut", confidence: 0.9 }), "MAX_TOKENS"))).reason, "unverified");
});

test("gemini: errors map to safe codes (bad key, 429, 5xx, blocked/empty, network, timeout)", async () => {
  const run = (fetchImpl) => ask({ prompt: "hi" }, { getClient: () => createGeminiClient({ apiKey: "k", fetchImpl, timeoutMs: 50 }), model: "m" });
  await assert.rejects(run(fakeFetch(() => ({ status: 400, body: { error: { message: "API key not valid. Please pass a valid API key." } } }))), (e) => e.code === "missing_api_key");
  await assert.rejects(run(fakeFetch(() => ({ status: 429, body: { error: { message: "quota" } } }))), (e) => e.code === "rate_limited");
  await assert.rejects(run(fakeFetch(() => ({ status: 500, body: { error: { message: "boom" } } }))), (e) => e.code === "upstream_error");
  await assert.rejects(run(fakeFetch(() => ({ body: { promptFeedback: { blockReason: "SAFETY" } } }))), (e) => e.code === "upstream_error"); // no candidates
  await assert.rejects(run(async () => { throw new TypeError("fetch failed"); }), (e) => e.code === "upstream_unavailable");
  await assert.rejects(run((url, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))), (e) => e.code === "upstream_unavailable");
});

test("gemini: toGeminiBody/fromGeminiResponse ignore 'thought' parts and tolerate odd shapes", () => {
  assert.strictEqual(fromGeminiResponse({ candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "shown" }] } }] }).content[0].text, "shown");
  assert.strictEqual(fromGeminiResponse({}).content[0].text, "");
  assert.strictEqual(fromGeminiResponse(null).content[0].text, "");
  assert.ok(toGeminiBody({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "t" }] }], max_tokens: 10 }).generationConfig.maxOutputTokens >= 4096);
});

test("provider selection: AI_PROVIDER wins; else Gemini if GEMINI_API_KEY set; else Anthropic", () => {
  const saved = { p: process.env.AI_PROVIDER, g: process.env.GEMINI_API_KEY };
  try {
    delete process.env.AI_PROVIDER; delete process.env.GEMINI_API_KEY;
    assert.strictEqual(currentProvider(), "anthropic");
    process.env.GEMINI_API_KEY = "x";
    assert.strictEqual(currentProvider(), "gemini");
    process.env.AI_PROVIDER = "anthropic";
    assert.strictEqual(currentProvider(), "anthropic");
  } finally {
    for (const [k, v] of [["AI_PROVIDER", saved.p], ["GEMINI_API_KEY", saved.g]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
