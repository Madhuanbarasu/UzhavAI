// Tests for lib/twilio.js — Twilio webhook handlers.
// Pure function tests, no network calls, no Twilio SDK needed.

const test = require("node:test");
const assert = require("node:assert");
const { buildTwiML, handleVoiceCall, handleVoiceGather, handleWhatsApp, detectLang, xmlEscape } = require("../lib/twilio");

// --- helpers -----------------------------------------------------------------
const fakeAskFn = async (prompt, lang) => ({
  answer: `Test answer for: ${prompt}`,
  confidence: 0.9,
  needsExpert: false,
  highStakes: false,
});

const fakeAskFnHandoff = async (prompt, lang) => ({
  answer: "Chemical treatment answer.",
  confidence: 0.95,
  needsExpert: true,
  highStakes: true,
});

// --- detectLang --------------------------------------------------------------
test("detectLang: detects Tamil from Tamil Unicode characters", () => {
  assert.strictEqual(detectLang("என் தக்காளி இலைகளில் பழுப்பு புள்ளிகள்"), "ta");
});

test("detectLang: defaults to English for ASCII text", () => {
  assert.strictEqual(detectLang("My tomato leaves have brown spots"), "en");
  assert.strictEqual(detectLang(""), "en");
  assert.strictEqual(detectLang(null), "en");
});

// --- xmlEscape ---------------------------------------------------------------
test("xmlEscape: escapes special XML characters", () => {
  assert.strictEqual(xmlEscape("Tom & Jerry's <farm>"), "Tom &amp; Jerry&apos;s &lt;farm&gt;");
  assert.strictEqual(xmlEscape('Say "hello"'), "Say &quot;hello&quot;");
});

// --- buildTwiML --------------------------------------------------------------
test("buildTwiML: Tamil response uses ta-IN language", () => {
  const twiml = buildTwiML("வணக்கம்", "ta");
  assert.match(twiml, /language="ta-IN"/);
  assert.match(twiml, /வணக்கம்/);
  assert.match(twiml, /<Say/);
  assert.match(twiml, /<Response>/);
  assert.match(twiml, /<\/Response>/);
});

test("buildTwiML: English response uses en-IN language", () => {
  const twiml = buildTwiML("Hello farmer", "en");
  assert.match(twiml, /language="en-IN"/);
  assert.match(twiml, /Hello farmer/);
});

test("buildTwiML: escapes special characters in answer text", () => {
  const twiml = buildTwiML("Spray <neem> oil & water", "en");
  assert.doesNotMatch(twiml, /<neem>/); // must be escaped
  assert.match(twiml, /&lt;neem&gt;/);
});

test("buildTwiML: with gatherUrl produces a Gather element", () => {
  const twiml = buildTwiML("", "ta", { gatherUrl: "/api/twilio/voice/gather" });
  assert.match(twiml, /<Gather/);
  assert.match(twiml, /input="speech"/);
  assert.match(twiml, /action="\/api\/twilio\/voice\/gather"/);
});

// --- handleVoiceCall ---------------------------------------------------------
test("handleVoiceCall: returns TwiML with Gather for incoming calls", () => {
  const twiml = handleVoiceCall({ CallSid: "CA123", From: "+919876543210", To: "+12015551234" });
  assert.match(twiml, /<\?xml/);
  assert.match(twiml, /<Gather/);
  assert.match(twiml, /input="speech"/);
  assert.match(twiml, /\/api\/twilio\/voice\/gather/);
});

test("handleVoiceCall: uses Tamil for +91 caller numbers", () => {
  const twiml = handleVoiceCall({ From: "+919876543210" });
  // Tamil greeting should appear (Tamil Unicode range characters)
  assert.match(twiml, /[\u0B80-\u0BFF]/);
});

test("handleVoiceCall: uses English for non-India numbers", () => {
  const twiml = handleVoiceCall({ From: "+12015551234" });
  assert.match(twiml, /UzhavAI|farm assistant/i);
});

test("handleVoiceCall: handles empty body without throwing", () => {
  assert.doesNotThrow(() => handleVoiceCall({}));
  assert.doesNotThrow(() => handleVoiceCall(null));
});

// --- handleVoiceGather -------------------------------------------------------
test("handleVoiceGather: calls askFn with correct lang for Tamil speech", async () => {
  let capturedLang = null;
  const spyAsk = async (prompt, lang) => { capturedLang = lang; return { answer: "பதில்", confidence: 0.9, needsExpert: false }; };
  const body = { SpeechResult: "என் தக்காளி இலை மஞ்சளாக உள்ளது", CallSid: "CA123" };
  await handleVoiceGather(body, spyAsk);
  assert.strictEqual(capturedLang, "ta");
});

test("handleVoiceGather: calls askFn with lang=en for English speech", async () => {
  let capturedLang = null;
  const spyAsk = async (prompt, lang) => { capturedLang = lang; return { answer: "ok", confidence: 0.9, needsExpert: false }; };
  await handleVoiceGather({ SpeechResult: "my tomato leaves have yellow spots" }, spyAsk);
  assert.strictEqual(capturedLang, "en");
});

test("handleVoiceGather: returns TwiML with the answer text", async () => {
  const twiml = await handleVoiceGather({ SpeechResult: "when to water paddy?" }, fakeAskFn);
  assert.match(twiml, /<Say/);
  assert.match(twiml, /Test answer for/);
});

test("handleVoiceGather: appends helpline to expert-handoff answers", async () => {
  const twiml = await handleVoiceGather({ SpeechResult: "pesticide dose?" }, fakeAskFnHandoff);
  assert.match(twiml, /1800-180-1551/);
});

test("handleVoiceGather: handles empty SpeechResult gracefully", async () => {
  const twiml = await handleVoiceGather({ SpeechResult: "" }, fakeAskFn);
  assert.match(twiml, /<Say/);
  // Should return a sorry/retry message
  assert.match(twiml, /sorry|மன்னிக்கவும்/i);
});

test("handleVoiceGather: handles askFn error gracefully (no throw)", async () => {
  const errorAsk = async () => { throw new Error("API down"); };
  const twiml = await handleVoiceGather({ SpeechResult: "question?" }, errorAsk);
  assert.match(twiml, /<Say/);
  assert.match(twiml, /sorry|problem|மன்னிக்கவும்/i);
});

// --- handleWhatsApp ----------------------------------------------------------
test("handleWhatsApp: returns plain text answer for English message", async () => {
  const reply = await handleWhatsApp({ Body: "when to plant paddy?", From: "whatsapp:+12015551234" }, fakeAskFn);
  assert.ok(typeof reply === "string");
  assert.match(reply, /Test answer for/);
});

test("handleWhatsApp: detects Tamil and calls askFn with lang=ta", async () => {
  let capturedLang = null;
  const spyAsk = async (prompt, lang) => { capturedLang = lang; return { answer: "பதில்", confidence: 0.9, needsExpert: false }; };
  await handleWhatsApp({ Body: "என் பயிர் பற்றி கேட்கிறேன்", From: "whatsapp:+919876543210" }, spyAsk);
  assert.strictEqual(capturedLang, "ta");
});

test("handleWhatsApp: appends helpline for expert-handoff answers", async () => {
  const reply = await handleWhatsApp({ Body: "pesticide dose?" }, fakeAskFnHandoff);
  assert.match(reply, /1800-180-1551/);
});

test("handleWhatsApp: handles image-only messages gracefully (no text)", async () => {
  const reply = await handleWhatsApp({ Body: "", NumMedia: "1", MediaUrl0: "https://api.twilio.com/image.jpg" }, fakeAskFn);
  assert.ok(typeof reply === "string" && reply.length > 0);
  // Should ask for text description
  assert.match(reply, /describe|words|வார்த்தைகளில்/i);
});

test("handleWhatsApp: returns greeting for empty message with no media", async () => {
  const reply = await handleWhatsApp({ Body: "", NumMedia: "0" }, fakeAskFn);
  assert.ok(typeof reply === "string" && reply.length > 0);
  assert.match(reply, /UzhavAI|உழவு AI/i);
});

test("handleWhatsApp: handles askFn error without throwing", async () => {
  const errorAsk = async () => { throw new Error("API down"); };
  const reply = await handleWhatsApp({ Body: "question?" }, errorAsk);
  assert.ok(typeof reply === "string");
  assert.match(reply, /sorry|problem|மன்னிக்கவும்/i);
});
