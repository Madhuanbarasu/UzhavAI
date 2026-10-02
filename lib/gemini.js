// Google Gemini adapter. Exposes the same `client.messages.create(...)` shape
// that lib/ask.js already uses for Anthropic, so the validation, system prompt,
// parsing and safety/handoff logic are shared unchanged. No extra dependency:
// it calls the public REST API with Node's built-in fetch.
//
// Free API key: https://aistudio.google.com/apikey (no billing required).

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function upstreamError(name, status, message) {
  const e = new Error(message);
  e.name = name;
  if (status) e.status = status;
  return e;
}

// Anthropic-style request -> Gemini request body.
function toGeminiBody({ system, messages, max_tokens }) {
  const parts = [];
  for (const block of messages[0].content) {
    if (block.type === "image") parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
    else if (block.type === "text") parts.push({ text: block.text });
  }
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    // Gemini 2.5+ "thinking" tokens count against this budget, so keep it generous
    // (the reply itself stays short because the prompt asks for 2-4 sentences).
    generationConfig: { maxOutputTokens: Math.max(max_tokens || 1024, 4096), responseMimeType: "application/json" },
  };
}

// Gemini response -> Anthropic-style { content:[{type:"text",text}], stop_reason }.
function fromGeminiResponse(data) {
  const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  return { content: [{ type: "text", text }], stop_reason: cand && cand.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn" };
}

function createGeminiClient({ apiKey, baseUrl = process.env.GEMINI_BASE_URL || DEFAULT_BASE, fetchImpl = fetch, timeoutMs = 40000, retries = 2, retryDelayMs = 1500 } = {}) {
  return {
    messages: {
      // Retries only on HTTP 503 ("high demand", temporary) with a short backoff.
      async create(params) {
        for (let attempt = 0; ; attempt++) {
          try {
            return await callOnce(params);
          } catch (err) {
            if (err && err.status === 503 && attempt < retries) {
              await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
              continue;
            }
            throw err;
          }
        }
      },
    },
  };

  async function callOnce(params) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(params.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, // key in a header, never in the URL/logs
        body: JSON.stringify(toGeminiBody(params)),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw upstreamError(err && err.name === "AbortError" ? "APIConnectionTimeoutError" : "APIConnectionError", 0, "Gemini unreachable");
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await resp.json(); } catch (e) { /* non-JSON body */ }
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || "Gemini error";
      // Gemini reports a bad/missing key as HTTP 400 "API key not valid" — treat as an auth problem.
      const status = resp.status === 400 && /api key/i.test(msg) ? 401 : resp.status;
      throw upstreamError("APIError", status, msg);
    }
    return fromGeminiResponse(data);
  }
}

module.exports = { createGeminiClient, toGeminiBody, fromGeminiResponse, DEFAULT_BASE };