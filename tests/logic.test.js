const test = require("node:test");
const assert = require("node:assert");
const {
  formatPrice,
  isLowConfidence,
  pickString,
  safeParseAnswer,
  errorMessage,
  buildContext,
} = require("../lib/logic");

test("formatPrice: Indian digit grouping", () => {
  assert.strictEqual(formatPrice(2100), "₹2,100");
  assert.strictEqual(formatPrice(100000), "₹1,00,000");
});

test("formatPrice: non-numeric input degrades instead of throwing", () => {
  assert.strictEqual(formatPrice(undefined), "₹—");
  assert.strictEqual(formatPrice(NaN), "₹—");
});

test("isLowConfidence: flags below threshold, passes at/above it", () => {
  assert.strictEqual(isLowConfidence(0.4), true);
  assert.strictEqual(isLowConfidence(0.55), false);
  assert.strictEqual(isLowConfidence(0.8), false);
});

test("isLowConfidence: missing confidence is not treated as low (avoid false handoffs)", () => {
  assert.strictEqual(isLowConfidence(undefined), false);
});

test("pickString: falls back to English when a translation is missing", () => {
  const strings = { en: { greet: "hi" }, ta: {} };
  assert.strictEqual(pickString(strings, "ta", "greet"), "hi");
});

test("pickString: returns empty string rather than throwing on an unknown key", () => {
  const strings = { en: {} };
  assert.strictEqual(pickString(strings, "en", "nope"), "");
});

test("safeParseAnswer: parses well-formed model JSON", () => {
  const r = safeParseAnswer('{"answer":"Water every 2 days.","confidence":0.9}');
  assert.strictEqual(r.answer, "Water every 2 days.");
  assert.strictEqual(r.confidence, 0.9);
});

test("safeParseAnswer: malformed JSON falls back to raw text, doesn't throw", () => {
  assert.doesNotThrow(() => safeParseAnswer("Sorry, I'm not sure — {broken"));
  const r = safeParseAnswer("Sorry, I'm not sure — {broken");
  assert.strictEqual(r.answer, "Sorry, I'm not sure — {broken");
  assert.strictEqual(r.confidence, undefined);
});

test("safeParseAnswer: ignores a non-numeric confidence field", () => {
  const r = safeParseAnswer('{"answer":"ok","confidence":"high"}');
  assert.strictEqual(r.confidence, undefined);
});

test("errorMessage: maps rate_limited and not_granted to distinct keys", () => {
  const strings = { en: { err: "generic", errBusy: "busy", errPermission: "denied" } };
  assert.strictEqual(errorMessage(strings, "en", "rate_limited"), "busy");
  assert.strictEqual(errorMessage(strings, "en", "not_granted"), "denied");
  assert.strictEqual(errorMessage(strings, "en", "network_error"), "generic");
});

test("buildContext: includes every price row and scheme note", () => {
  const prices = [{ crop: { en: "Tomato" }, price: 1850, market: "Chennai" }];
  const schemes = [{ ctx: "PM-KISAN gives ₹6000/year." }];
  const ctx = buildContext(prices, schemes);
  assert.match(ctx, /Tomato ₹1,850\/quintal at Chennai/);
  assert.match(ctx, /PM-KISAN gives ₹6000\/year\./);
});

// --- additions: parsing robustness, high-stakes screen, handoff decision ---
const { isHighStakes, needsHandoff } = require("../lib/logic");

test("safeParseAnswer: strips ```json fences and surrounding prose", () => {
  assert.strictEqual(safeParseAnswer('```json\n{"answer":"A","confidence":0.7}\n```').answer, "A");
  assert.strictEqual(safeParseAnswer('Here you go: {"answer":"B","confidence":0.6} thanks').confidence, 0.6);
});

test("safeParseAnswer: out-of-range confidence is rejected, parsed flag and needs_expert reported", () => {
  assert.strictEqual(safeParseAnswer('{"answer":"x","confidence":1.5}').confidence, undefined);
  assert.strictEqual(safeParseAnswer('{"answer":"x","confidence":-0.1}').confidence, undefined);
  assert.strictEqual(safeParseAnswer('{"answer":"x","confidence":0.5,"needs_expert":true}').needsExpert, true);
  assert.strictEqual(safeParseAnswer('{"answer":"x","confidence":0.5}').parsed, true);
  assert.strictEqual(safeParseAnswer("plain text").parsed, false);
  assert.strictEqual(safeParseAnswer(null).parsed, false);
});

test("isHighStakes: flags chemical/dose/money questions in English and Tamil, not ordinary ones", () => {
  assert.strictEqual(isHighStakes("How much pesticide should I spray?"), true);
  assert.strictEqual(isHighStakes("Use 5 ml per litre?"), true);
  assert.strictEqual(isHighStakes("Can I get a crop loan?"), true);
  assert.strictEqual(isHighStakes("எந்த மருந்து தெளிக்க வேண்டும்?"), true);
  assert.strictEqual(isHighStakes("My tomato leaves have brown spots."), false);
  assert.strictEqual(isHighStakes("When should I plant paddy?"), false);
  assert.strictEqual(isHighStakes(undefined), false);
});

test("needsHandoff: low confidence, model flag, high stakes and unverified all hand off; confident+safe does not", () => {
  const base = { confidence: 0.9, needsExpert: false, parsed: true, question: "when to plant paddy" };
  assert.deepStrictEqual(needsHandoff(base), { needsExpert: false, reason: null });
  assert.strictEqual(needsHandoff({ ...base, confidence: 0.3 }).reason, "low_confidence");
  assert.strictEqual(needsHandoff({ ...base, needsExpert: true }).reason, "model_flagged");
  assert.strictEqual(needsHandoff({ ...base, question: "pesticide dose" }).reason, "high_stakes");
  assert.strictEqual(needsHandoff({ ...base, parsed: false, confidence: undefined }).reason, "unverified");
  assert.strictEqual(needsHandoff({ ...base, confidence: undefined }).reason, "unverified");
});

test("errorMessage: backend error codes map to specific messages and fall back safely", () => {
  const strings = { en: { err: "generic", errConfig: "cfg", errImage: "img", errInvalid: "inv", errBusy: "busy" } };
  assert.strictEqual(errorMessage(strings, "en", "missing_api_key"), "cfg");
  assert.strictEqual(errorMessage(strings, "en", "invalid_image"), "img");
  assert.strictEqual(errorMessage(strings, "en", "image_too_large"), "img");
  assert.strictEqual(errorMessage(strings, "en", "invalid_request"), "inv");
  assert.strictEqual(errorMessage(strings, "en", "upstream_error"), "generic");
  assert.strictEqual(errorMessage(strings, "en", undefined), "generic");
});

// Regression: loaded as a plain browser <script>, logic.js must not leak its
// function names as globals — index.html destructures the same names with
// `const`, and a clash is a SyntaxError that kills the whole page.
test("logic.js as a classic browser script doesn't collide with index.html's const destructuring", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "logic.js"), "utf8");
  const ctx = vm.createContext({});
  ctx.window = ctx; // browser-like: window === global
  vm.runInContext(src, ctx);
  assert.doesNotThrow(() => vm.runInContext("const { formatPrice, errorMessage, buildContext } = window.UzhavLogic;", ctx));
});
