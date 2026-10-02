// lib/mandi.js — Live mandi price fetcher with data.gov.in integration.
// Falls back to static demo prices when DATAGOV_API_KEY is not set or the
// API is unreachable. Cache lasts 60 minutes per process.
//
// Free API key: https://data.gov.in/user/register
// Dataset: Current Daily Price of Various Commodities from Various Markets
// Resource ID: 9ef84268-d588-465a-a308-a864a43d0070

const DATAGOV_BASE = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Static fallback prices — clearly labelled as demo/fallback values.
// These are representative values for Tamil Nadu mandis; NOT live or official.
const STATIC_PRICES = [
  { crop: "Tomato",     market: "Koyambedu, Chennai", price: 1850, state: "Tamil Nadu", variety: "Other",   date: null },
  { crop: "Onion",      market: "Koyambedu, Chennai", price: 2100, state: "Tamil Nadu", variety: "Other",   date: null },
  { crop: "Paddy (Rice)",market: "Thanjavur",         price: 2203, state: "Tamil Nadu", variety: "Raw",     date: null },
  { crop: "Brinjal",   market: "Coimbatore",          price: 1600, state: "Tamil Nadu", variety: "Other",   date: null },
  { crop: "Banana",    market: "Theni",               price: 1400, state: "Tamil Nadu", variety: "Other",   date: null },
  { crop: "Wheat",     market: "Thanjavur",           price: 2015, state: "Tamil Nadu", variety: "Other",   date: null },
  { crop: "Maize",     market: "Erode",               price: 1750, state: "Tamil Nadu", variety: "Other",   date: null },
];

// In-memory cache: { data, fetchedAt (ms timestamp) }
let _cache = null;

// Parse a data.gov.in record into our standard price object.
// The API returns string values for prices.
function parseRecord(rec) {
  const price = parseInt(rec["Modal Price"] || rec["modal_price"] || "0", 10);
  if (!price) return null;
  return {
    crop:    rec.Commodity  || rec.commodity  || "Unknown",
    market:  `${rec.Market || rec.market || "Unknown"}, ${rec.District || rec.district || rec.State || ""}`.replace(/,\s*$/, ""),
    price,
    state:   rec.State     || rec.state     || "Tamil Nadu",
    variety: rec.Variety   || rec.variety   || "Other",
    date:    rec.Arrival_Date || rec.arrival_date || null,
  };
}

// Fetch live mandi prices from data.gov.in.
// Accepts an optional `fetchImpl` for testing.
async function fetchMandiPrices({ fetchImpl = fetch } = {}) {
  const apiKey = process.env.DATAGOV_API_KEY;

  // Return cached data if fresh.
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return { prices: _cache.data, source: "cache", fetchedAt: new Date(_cache.fetchedAt).toISOString() };
  }

  // No key — return static fallback immediately.
  if (!apiKey || !apiKey.trim()) {
    return { prices: STATIC_PRICES, source: "static", fetchedAt: null };
  }

  try {
    const params = new URLSearchParams({
      "api-key": apiKey,
      format: "json",
      limit: "100",
      "filters[State.keyword]": "Tamil Nadu",
    });
    const url = `${DATAGOV_BASE}?${params}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000); // 10-second timeout
    let resp;
    try {
      resp = await fetchImpl(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      console.warn(`[mandi] data.gov.in returned HTTP ${resp.status} — using static prices`);
      return { prices: STATIC_PRICES, source: "static", fetchedAt: null };
    }

    const json = await resp.json();
    const records = Array.isArray(json.records) ? json.records : [];
    const prices = records.map(parseRecord).filter(Boolean);

    if (prices.length === 0) {
      // API returned empty — fall back to static
      return { prices: STATIC_PRICES, source: "static", fetchedAt: null };
    }

    // Store in cache
    _cache = { data: prices, fetchedAt: Date.now() };
    return { prices, source: "live", fetchedAt: new Date(_cache.fetchedAt).toISOString() };
  } catch (err) {
    const isTimeout = err && (err.name === "AbortError" || err.name === "TimeoutError");
    console.warn(`[mandi] Fetch ${isTimeout ? "timed out" : "failed"} (${err && err.message}) — using static prices`);
    return { prices: STATIC_PRICES, source: "static", fetchedAt: null };
  }
}

// Reset cache (for testing)
function _resetCache() { _cache = null; }

module.exports = { fetchMandiPrices, STATIC_PRICES, parseRecord, _resetCache };
