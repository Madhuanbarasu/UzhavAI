// Tests for lib/mandi.js — mandi price fetcher.
// All tests use a fake fetchImpl so no real network calls are made.

const test = require("node:test");
const assert = require("node:assert");
const { fetchMandiPrices, STATIC_PRICES, parseRecord, _resetCache } = require("../lib/mandi");

// Reset cache before each test to avoid cross-test contamination.
function setup() { _resetCache(); }

// --- STATIC_PRICES -----------------------------------------------------------
test("STATIC_PRICES: is a non-empty array with required fields", () => {
  assert.ok(Array.isArray(STATIC_PRICES) && STATIC_PRICES.length > 0, "STATIC_PRICES must be non-empty");
  for (const p of STATIC_PRICES) {
    assert.ok(typeof p.crop === "string" && p.crop, "crop must be a non-empty string");
    assert.ok(typeof p.market === "string" && p.market, "market must be a non-empty string");
    assert.ok(typeof p.price === "number" && p.price > 0, "price must be a positive number");
    assert.ok(typeof p.state === "string", "state must be a string");
    assert.ok(typeof p.variety === "string", "variety must be a string");
  }
});

// --- parseRecord -------------------------------------------------------------
test("parseRecord: parses a well-formed data.gov.in record", () => {
  const rec = {
    State: "Tamil Nadu", District: "Chennai", Market: "Koyambedu",
    Commodity: "Tomato", Variety: "Other", Grade: "FAQ",
    Arrival_Date: "02/10/2026",
    "Min Price": "1600", "Max Price": "2100", "Modal Price": "1850",
  };
  const p = parseRecord(rec);
  assert.strictEqual(p.crop, "Tomato");
  assert.ok(p.market.includes("Koyambedu"), "market should include market name");
  assert.strictEqual(p.price, 1850);
  assert.strictEqual(p.state, "Tamil Nadu");
  assert.strictEqual(p.variety, "Other");
  assert.strictEqual(p.date, "02/10/2026");
});

test("parseRecord: returns null when Modal Price is missing or 0", () => {
  assert.strictEqual(parseRecord({ Commodity: "Tomato", "Modal Price": "0" }), null);
  assert.strictEqual(parseRecord({ Commodity: "Tomato" }), null);
});

// --- fetchMandiPrices: no API key -------------------------------------------
test("fetchMandiPrices: returns static prices with source='static' when no API key is set", async () => {
  setup();
  const saved = process.env.DATAGOV_API_KEY;
  delete process.env.DATAGOV_API_KEY;
  try {
    const result = await fetchMandiPrices();
    assert.strictEqual(result.source, "static");
    assert.deepStrictEqual(result.prices, STATIC_PRICES);
    assert.strictEqual(result.fetchedAt, null);
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
  }
});

// --- fetchMandiPrices: live API success --------------------------------------
test("fetchMandiPrices: fetches live data and parses data.gov.in response format", async () => {
  setup();
  const saved = process.env.DATAGOV_API_KEY;
  process.env.DATAGOV_API_KEY = "testkey";
  const fakeResponse = {
    status: "ok",
    records: [
      {
        State: "Tamil Nadu", District: "Chennai", Market: "Koyambedu",
        Commodity: "Tomato", Variety: "Other", Grade: "FAQ",
        Arrival_Date: "02/10/2026",
        "Min Price": "1600", "Max Price": "2100", "Modal Price": "1850",
      },
      {
        State: "Tamil Nadu", District: "Thanjavur", Market: "Thanjavur",
        Commodity: "Paddy", Variety: "Raw", Grade: "FAQ",
        Arrival_Date: "02/10/2026",
        "Min Price": "2000", "Max Price": "2400", "Modal Price": "2200",
      },
    ],
  };
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => fakeResponse,
  });
  try {
    const result = await fetchMandiPrices({ fetchImpl: fakeFetch });
    assert.strictEqual(result.source, "live");
    assert.ok(result.fetchedAt, "fetchedAt should be set for live data");
    assert.strictEqual(result.prices.length, 2);
    assert.strictEqual(result.prices[0].crop, "Tomato");
    assert.strictEqual(result.prices[0].price, 1850);
    assert.strictEqual(result.prices[1].crop, "Paddy");
    assert.strictEqual(result.prices[1].price, 2200);
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
    setup(); // clear cache set by this test
  }
});

// --- fetchMandiPrices: cache -------------------------------------------------
test("fetchMandiPrices: returns cached data on second call within cache window", async () => {
  setup();
  const saved = process.env.DATAGOV_API_KEY;
  process.env.DATAGOV_API_KEY = "testkey";
  let callCount = 0;
  const fakeResponse = {
    status: "ok",
    records: [{ State: "Tamil Nadu", Market: "Koyambedu", Commodity: "Onion", Variety: "Other", "Modal Price": "2100", Arrival_Date: "02/10/2026" }],
  };
  const fakeFetch = async () => { callCount++; return { ok: true, status: 200, json: async () => fakeResponse }; };
  try {
    await fetchMandiPrices({ fetchImpl: fakeFetch });
    const result2 = await fetchMandiPrices({ fetchImpl: fakeFetch }); // should use cache
    assert.strictEqual(callCount, 1, "fetch should only be called once (cache hit on second call)");
    assert.strictEqual(result2.source, "cache");
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
    setup();
  }
});

// --- fetchMandiPrices: fallback on error -------------------------------------
test("fetchMandiPrices: falls back to static prices on network error", async () => {
  setup();
  const saved = process.env.DATAGOV_API_KEY;
  process.env.DATAGOV_API_KEY = "testkey";
  const fakeFetch = async () => { throw new Error("Network failure"); };
  try {
    const result = await fetchMandiPrices({ fetchImpl: fakeFetch });
    assert.strictEqual(result.source, "static");
    assert.deepStrictEqual(result.prices, STATIC_PRICES);
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
    setup();
  }
});

test("fetchMandiPrices: falls back to static on HTTP error (non-200)", async () => {
  setup();
  const saved = process.env.DATAGOV_API_KEY;
  process.env.DATAGOV_API_KEY = "testkey";
  const fakeFetch = async () => ({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
  try {
    const result = await fetchMandiPrices({ fetchImpl: fakeFetch });
    assert.strictEqual(result.source, "static");
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
    setup();
  }
});

test("fetchMandiPrices: falls back to static when API returns empty records", async () => {
  setup();
  const saved = process.env.DATAGOV_API_KEY;
  process.env.DATAGOV_API_KEY = "testkey";
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ status: "ok", records: [] }) });
  try {
    const result = await fetchMandiPrices({ fetchImpl: fakeFetch });
    assert.strictEqual(result.source, "static");
  } finally {
    if (saved !== undefined) process.env.DATAGOV_API_KEY = saved;
    else delete process.env.DATAGOV_API_KEY;
    setup();
  }
});
