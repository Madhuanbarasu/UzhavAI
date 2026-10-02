// Pure functions only — no DOM, no network. Kept separate from index.html
// so they can be unit-tested with plain Node (see tests/logic.test.js) and
// so index.html stays a thin UI layer over logic that's actually verified.

// NOTE: everything below is wrapped in a function scope on purpose. As a plain
// browser <script>, top-level `function formatPrice` would become a global and
// collide with the `const { formatPrice } = window.UzhavLogic` in index.html
// (SyntaxError: Identifier already declared). Only window.UzhavLogic is exposed.
(function () {
"use strict";

  function formatPrice(n) {
    if (typeof n !== "number" || !isFinite(n)) return "₹—";
    return "₹" + n.toLocaleString("en-IN");
  }

  // Below this confidence, don't let the farmer act on the answer alone.
  function isLowConfidence(confidence, threshold = 0.55) {
    return typeof confidence === "number" && confidence < threshold;
  }

  // Looks up a UI string for `lang`, falling back to English, then "".
  // Never throws — a missing translation should degrade, not crash the page.
  function pickString(strings, lang, key) {
    return (strings[lang] && strings[lang][key]) || (strings.en && strings.en[key]) || "";
  }

  // Claude is asked to reply as JSON ({answer, confidence, needs_expert}). Model
  // output is untrusted text: this must survive malformed/partial JSON without
  // throwing, since a farmer's answer should never break on a formatting slip.
  //
  // Returns { answer, confidence, needsExpert, parsed }.
  //   parsed=false means we could NOT read structured JSON, so the confidence is
  //   unknown — callers must not treat that as "certain" (see needsHandoff).
  function safeParseAnswer(raw) {
    if (typeof raw !== "string") return { answer: "", confidence: undefined, needsExpert: false, parsed: false };
    const candidates = [raw.trim()];
    // Models sometimes wrap JSON in ```json fences or add a sentence around it.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidates.push(fenced[1].trim());
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
    for (const c of candidates) {
      try {
        const obj = JSON.parse(c);
        if (obj && typeof obj.answer === "string") {
          // Only accept a confidence that is a real probability-like number in [0,1].
          const ok = typeof obj.confidence === "number" && isFinite(obj.confidence) && obj.confidence >= 0 && obj.confidence <= 1;
          return {
            answer: obj.answer,
            confidence: ok ? obj.confidence : undefined,
            needsExpert: obj.needs_expert === true,
            parsed: true,
          };
        }
      } catch (e) {
        // try the next candidate
      }
    }
    return { answer: raw, confidence: undefined, needsExpert: false, parsed: false };
  }

  // Questions touching chemical doses/pesticides or money are high-stakes no
  // matter how confident the model sounds: a wrong dose can destroy a crop or
  // harm health. This is a deliberately simple keyword screen (English + Tamil),
  // not a classifier — it errs towards sending the farmer to an expert.
  const HIGH_STAKES_PATTERNS = [
    /\b(dose|dosage|dosing)\b/i,
    /\b\d+(\.\d+)?\s*(ml|mls|litre|litres|liter|liters|gm|gms|grams?|kg)\b/i,
    /\b(pesticide|insecticide|fungicide|herbicide|weedicide|chemical|poison|spray|spraying)\b/i,
    /\b(loan|compensation|insurance claim|claim)\b/i,
    /மருந்து/, /கொல்லி/, /தெளி/, /கடன்/, /இழப்பீடு/,
  ];
  function isHighStakes(text) {
    if (typeof text !== "string" || !text) return false;
    return HIGH_STAKES_PATTERNS.some((re) => re.test(text));
  }

  // Crop symptom / pest / disease questions. Without a photo (or more detail) the
  // honest answer is "possible causes", never a confident diagnosis. Keyword
  // screen, English + Tamil. (Tamil "மஞ்சள்" also means turmeric, so
  // the yellow stem only counts next to "இலை" = leaf.)
  const DIAGNOSIS_PATTERNS = [
    /\b(yellow(ing|ish)?|brown(ing)?|black|spots?|spotted|wilt(s|ed|ing)?|curl(s|ed|ing)?|blight|rot(s|ted|ting)?|mildew|mou?ld|fung(us|al)|diseases?|diseased|pests?|insects?|worms?|caterpillars?|aphids?|whiteflies|whitefly|mites?|virus|infect(ed|ion)|dying|stunted|lesions?|holes? in)\b/i,
    // Tamil words take suffixes (மஞ்சள் -> மஞ்சளாக), so match stems, not whole words.
    /புள்ளி/, /நோய்/, /பூச்சி/, /வாட/, /அழுக/, /கருக/, /புழு/, /பூஞ்சை/,
    /இலை[^.?]*மஞ்ச|மஞ்ச[^.?]*இலை/,
  ];
  function isDiagnosisQuestion(text) {
    if (typeof text !== "string" || !text) return false;
    return DIAGNOSIS_PATTERNS.some((re) => re.test(text));
  }

  // Does the ANSWER itself recommend a chemical treatment or give a dose? The
  // question screen alone misses "my leaves are yellow" -> "spray a fungicide".
  // Sentences that warn AGAINST chemicals ("do not apply pesticides", "before
  // using any chemical treatment") are not flagged — those are the safe ones.
  const CHEM_WORDS = /\b(pesticides?|insecticides?|fungicides?|herbicides?|weedicides?|chemicals?|spray(ing|ed)?|pesticide)\b|மருந்து|கொல்லி|தெளி/i;
  const DOSE = /\b\d+(\.\d+)?\s*(ml|mls|litre|litres|liter|liters|gm|gms|grams?|kg|%)(\s*(\/|per)\s*(l|litre|liter|acre|hectare|ha))?/i;
  const NEGATION = /\b(not|no|never|avoid|without|don't|dont|before|unless|until|instead of)\b|வேண்டாம்|கூடாது|தவிர்|முன்|வரை/i;
  function recommendsChemicals(answer) {
    if (typeof answer !== "string" || !answer) return false;
    return answer.split(/[.!?।\n]+/).some((sentence) => {
      if (NEGATION.test(sentence)) return false;
      return CHEM_WORDS.test(sentence) || /\b(dose|dosage)\b/i.test(sentence) || (DOSE.test(sentence) && /\b(ml|mls|litre|litres|liter|liters)\b/i.test(sentence));
    });
  }

  // Final human-handoff decision for one answer. Returns { needsExpert, reason }.
  //   reason: "low_confidence" | "model_flagged" | "high_stakes" | "unverified"
  //           | "needs_more_info" | null
  //
  //   high_stakes     chemicals / doses / money — in the question OR recommended by the answer
  //   needs_more_info a crop symptom question with no photo: possible causes only,
  //                   no confident diagnosis, even if the model sounds sure
  //   unverified      we could not read a trustworthy confidence (malformed, out of
  //                   range, truncated) — we never treat that as certainty
  //
  // A confident answer to an ordinary low-risk question returns reason null: no banner.
  function needsHandoff({ confidence, needsExpert, parsed, question, answer, hasImage }, threshold = 0.55) {
    if (isLowConfidence(confidence, threshold)) return { needsExpert: true, reason: "low_confidence" };
    if (needsExpert === true) return { needsExpert: true, reason: "model_flagged" };
    if (isHighStakes(question) || recommendsChemicals(answer)) return { needsExpert: true, reason: "high_stakes" };
    if (parsed === false || typeof confidence !== "number") return { needsExpert: true, reason: "unverified" };
    if (isDiagnosisQuestion(question) && !hasImage) return { needsExpert: true, reason: "needs_more_info" };
    return { needsExpert: false, reason: null };
  }

  // Maps an error code (from our /api/ask backend or the network layer) to a
  // farmer-facing message key per language. Unknown codes fall back to generic.
  const ERROR_KEYS = {
    rate_limited: "errBusy",
    not_granted: "errPermission",
    missing_api_key: "errConfig",
    invalid_image: "errImage",
    image_too_large: "errImage",
    invalid_request: "errInvalid",
    network_error: "err",
  };
  function errorMessage(strings, lang, code) {
    const key = ERROR_KEYS[code] || "err";
    return pickString(strings, lang, key) || pickString(strings, lang, "err");
  }

  function buildContext(prices, schemesEn) {
    const priceLine = prices.map((p) => {
      const cropName = typeof p.crop === "object" && p.crop ? (p.crop.en || p.crop.name || "") : String(p.crop || "");
      return `${cropName} ${formatPrice(p.price)}/quintal at ${p.market}`;
    }).join("; ");
    const schemeLine = schemesEn.map((s) => s.ctx).join(" ");
    return "Mandi price snapshot (static demo values, NOT live or official market rates): " + priceLine + ". Scheme notes: " + schemeLine;
  }

  const api = { formatPrice, isLowConfidence, isHighStakes, isDiagnosisQuestion, recommendsChemicals, needsHandoff, pickString, safeParseAnswer, errorMessage, buildContext };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.UzhavLogic = api;
  }
})();