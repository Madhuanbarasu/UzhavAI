// Tests for lib/rag.js — Agricultural RAG module and /api/schemes endpoint.

const test = require("node:test");
const assert = require("node:assert");
const {
  retrieveContext,
  isPriceQuery,
  formatMandiContext,
  tokenize,
  scoreItem,
  SCHEMES_KNOWLEDGE,
  ICAR_PEST_KNOWLEDGE,
} = require("../lib/rag");
const { createApp } = require("../server");

async function withServer(opts, fn) {
  const app = createApp(opts);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

// --- Knowledge base completeness --------------------------------------------
test("SCHEMES_KNOWLEDGE: covers PM-KISAN, PMFBY, SMAM, PM-KUSUM, Micro-Irrigation, KCC, and Soil Health", () => {
  assert.ok(Array.isArray(SCHEMES_KNOWLEDGE) && SCHEMES_KNOWLEDGE.length >= 7);
  const ids = SCHEMES_KNOWLEDGE.map((s) => s.id);
  assert.ok(ids.includes("pm-kisan"), "Must include PM-KISAN");
  assert.ok(ids.includes("pmfby"), "Must include PMFBY crop insurance");
  assert.ok(ids.includes("smam-mechanization"), "Must include agricultural mechanization/tractor subsidy");
  assert.ok(ids.includes("pm-kusum"), "Must include PM-KUSUM solar pump");
  assert.ok(ids.includes("micro-irrigation"), "Must include micro irrigation subsidy");
  assert.ok(ids.includes("kcc"), "Must include Kisan Credit Card");
  assert.ok(ids.includes("soil-health-card"), "Must include Soil Health Card");

  for (const s of SCHEMES_KNOWLEDGE) {
    assert.ok(s.name && s.name_ta, "Scheme must have bilingual names");
    assert.ok(s.summary_en && s.summary_ta, "Scheme must have bilingual summaries");
    assert.ok(s.eligibility_en && s.eligibility_ta, "Scheme must have bilingual eligibility");
    assert.ok(s.portal, "Scheme must include official portal URL");
    assert.ok(s.helpline, "Scheme must include helpline number");
  }
});

test("ICAR_PEST_KNOWLEDGE: covers major crops with symptoms, organic care, and safety", () => {
  assert.ok(Array.isArray(ICAR_PEST_KNOWLEDGE) && ICAR_PEST_KNOWLEDGE.length >= 5);
  for (const p of ICAR_PEST_KNOWLEDGE) {
    assert.ok(p.crop && p.crop_ta, "Must have bilingual crop names");
    assert.ok(p.problem && p.problem_ta, "Must have bilingual problem names");
    assert.ok(p.symptoms_en && p.symptoms_ta, "Must have bilingual symptoms");
    assert.ok(p.organic_care_en && p.organic_care_ta, "Must have cultural/organic guidance");
    assert.ok(p.caution_en && p.caution_ta, "Must have safety/expert warning");
  }
});

// --- Tokenize & intent detection --------------------------------------------
test("tokenize: splits text into clean words in English and Tamil", () => {
  const en = tokenize("When should I plant tomato seeds?");
  assert.ok(en.includes("tomato"));
  assert.ok(en.includes("plant"));

  const ta = tokenize("தக்காளி இலை மஞ்சளாக உள்ளது");
  assert.ok(ta.includes("தக்காளி"));
  assert.ok(ta.includes("இலை"));
});

test("isPriceQuery: detects price and mandi intent in English and Tamil", () => {
  assert.strictEqual(isPriceQuery("what is the tomato price today?"), true);
  assert.strictEqual(isPriceQuery("mandi rates for onion"), true);
  assert.strictEqual(isPriceQuery("தக்காளி விலை என்ன?"), true);
  assert.strictEqual(isPriceQuery("மண்டி நிலவரம்"), true);
  assert.strictEqual(isPriceQuery("how to water paddy?"), false);
  assert.strictEqual(isPriceQuery(""), false);
});

// --- RAG context retrieval --------------------------------------------------
test("retrieveContext: retrieves PM-KISAN grounded knowledge for eligibility query", async () => {
  const ctxEn = await retrieveContext("Am I eligible for PM-KISAN 6000?", { lang: "en" });
  assert.match(ctxEn, /PM-KISAN/);
  assert.match(ctxEn, /6,000/);
  assert.match(ctxEn, /Eligibility:/);

  const ctxTa = await retrieveContext("பிஎம் கிசான் தகுதி என்ன?", { lang: "ta" });
  assert.match(ctxTa, /பிஎம்-கிசான்/);
  assert.match(ctxTa, /தகுதி:/);
});

test("retrieveContext: retrieves ICAR guidance for crop disease symptoms", async () => {
  const ctx = await retrieveContext("tomato leaves have brown concentric rings blight", { lang: "en" });
  assert.match(ctx, /Tomato/);
  assert.match(ctx, /Blight/i);
  assert.match(ctx, /Safety:/i);

  const ctxTa = await retrieveContext("நெல் பயிரில் குலை நோய் அறிகுறிகள்", { lang: "ta" });
  assert.match(ctxTa, /நெல்/);
  assert.match(ctxTa, /குலை நோய்/);
});

test("retrieveContext: automatically includes mandi prices when query asks about crop prices", async () => {
  const ctx = await retrieveContext("What is the mandi price of tomato and onion today?", { lang: "en" });
  assert.match(ctx, /Mandi Price Data/);
  assert.match(ctx, /Tomato/);
  assert.match(ctx, /₹/);
});

test("retrieveContext: returns empty string when query has no matching keywords", async () => {
  const ctx = await retrieveContext("xyz abc 123 nothing", { lang: "en" });
  assert.strictEqual(ctx, "");
});

// --- GET /api/schemes endpoint ----------------------------------------------
test("GET /api/schemes: returns all grounded government schemes", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/schemes`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.lang, "en");
    assert.ok(data.count >= 7);
    const ids = data.schemes.map((s) => s.id);
    assert.ok(ids.includes("pm-kisan"));
    assert.ok(ids.includes("pmfby"));
    assert.ok(ids.includes("smam-mechanization"));
  });
});

test("GET /api/schemes?lang=ta: returns schemes in Tamil", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/schemes?lang=ta`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.lang, "ta");
    const pmKisan = data.schemes.find((s) => s.id === "pm-kisan");
    assert.match(pmKisan.name, /பிஎம்-கிசான்/);
    assert.match(pmKisan.summary, /6,000/);
  });
});

test("GET /api/schemes?category=subsidy: filters by category", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/schemes?category=subsidy`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.schemes.length >= 2);
    for (const s of data.schemes) {
      assert.strictEqual(s.category, "subsidy");
    }
  });
});
