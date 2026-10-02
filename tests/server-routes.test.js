// Tests for new server routes: /api/mandi and /api/twilio/*.
// All tests use fake implementations — no real network calls or Twilio auth.

const test = require("node:test");
const assert = require("node:assert");
const { createApp } = require("../server");
const { _resetCache } = require("../lib/mandi");

// Fake AI client for Twilio route tests
function fakeClient(reply = '{"answer":"Paddy should be watered regularly.","confidence":0.85}') {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text: reply }], stop_reason: "end_turn" }),
    },
  };
}

async function withServer(opts, fn) {
  const app = createApp(opts);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

// --- /api/mandi ---------------------------------------------------------------
test("GET /api/mandi: returns static prices when DATAGOV_API_KEY not set", async () => {
  _resetCache();
  const saved = process.env.DATAGOV_API_KEY;
  delete process.env.DATAGOV_API_KEY;
  try {
    await withServer({ getClient: () => fakeClient() }, async (base) => {
      const r = await fetch(`${base}/api/mandi`);
      assert.strictEqual(r.status, 200);
      const body = await r.json();
      assert.strictEqual(body.source, "static");
      assert.ok(Array.isArray(body.prices) && body.prices.length > 0);
      // Each price should have required fields
      for (const p of body.prices) {
        assert.ok(typeof p.crop === "string");
        assert.ok(typeof p.price === "number");
        assert.ok(typeof p.market === "string");
      }
    });
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
    _resetCache();
  }
});

test("GET /api/health: reports mandiLive and twilioConfigured flags", async () => {
  const savedD = process.env.DATAGOV_API_KEY;
  const savedT = process.env.TWILIO_ACCOUNT_SID;
  delete process.env.DATAGOV_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
  try {
    await withServer({ getClient: () => fakeClient() }, async (base) => {
      const r = await fetch(`${base}/api/health`);
      assert.strictEqual(r.status, 200);
      const body = await r.json();
      assert.strictEqual(body.mandiLive, false);
      assert.strictEqual(body.twilioConfigured, false);
    });
  } finally {
    if (savedD !== undefined) process.env.DATAGOV_API_KEY = savedD;
    if (savedT !== undefined) process.env.TWILIO_ACCOUNT_SID = savedT;
  }
});

// --- /api/twilio/voice -------------------------------------------------------
test("POST /api/twilio/voice: returns TwiML XML with Gather element", async () => {
  await withServer({ getClient: () => fakeClient() }, async (base) => {
    const r = await fetch(`${base}/api/twilio/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA123", From: "+919876543210", To: "+12015551234" }),
    });
    assert.strictEqual(r.status, 200);
    assert.ok((r.headers.get("content-type") || "").includes("text/xml"));
    const text = await r.text();
    assert.match(text, /<\?xml/);
    assert.match(text, /<Gather/);
    assert.match(text, /\/api\/twilio\/voice\/gather/);
  });
});

// --- /api/twilio/voice/gather ------------------------------------------------
test("POST /api/twilio/voice/gather: returns TwiML with the AI answer", async () => {
  await withServer({ getClient: () => fakeClient() }, async (base) => {
    const r = await fetch(`${base}/api/twilio/voice/gather`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SpeechResult: "when to water paddy?", CallSid: "CA123", From: "+919876543210" }),
    });
    assert.strictEqual(r.status, 200);
    assert.ok((r.headers.get("content-type") || "").includes("text/xml"));
    const text = await r.text();
    assert.match(text, /<Say/);
    assert.match(text, /Paddy should be watered/i);
  });
});

// --- /api/twilio/whatsapp ----------------------------------------------------
test("POST /api/twilio/whatsapp: returns TwiML with the AI answer", async () => {
  await withServer({ getClient: () => fakeClient() }, async (base) => {
    const r = await fetch(`${base}/api/twilio/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        Body: "when to water paddy?",
        From: "whatsapp:+919876543210",
        NumMedia: "0"
      }),
    });

    assert.strictEqual(r.status, 200);
    assert.ok((r.headers.get("content-type") || "").includes("text/xml"));

    const text = await r.text();

    assert.match(text, /<Response>/i);
    assert.match(text, /<Message>/i);
    assert.match(text, /Paddy should be watered/i);
    assert.match(text, /<\/Message>/i);
    assert.match(text, /<\/Response>/i);
  });
});

test("POST /api/twilio/whatsapp: handles image-only message (NumMedia=1, no Body)", async () => {
  await withServer({ getClient: () => fakeClient() }, async (base) => {
    const r = await fetch(`${base}/api/twilio/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Body: "", NumMedia: "1", MediaUrl0: "https://api.twilio.com/image.jpg", From: "whatsapp:+919876543210" }),
    });
    assert.strictEqual(r.status, 200);
    const text = await r.text();
    assert.match(text, /describe|words|வார்த்தைகளில்/i);
  });
});
