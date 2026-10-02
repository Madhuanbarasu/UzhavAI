// lib/twilio.js — Twilio webhook handlers for phone voice calls and WhatsApp.
//
// These are pure functions that take request body objects and return valid TwiML XML
// strings. The HTTP layer in server.js wires them to Express routes with Content-Type: text/xml.
//
// No Twilio SDK required: voice uses raw TwiML XML (<Say>, <Gather>, <Hangup>);
// WhatsApp messaging uses TwiML XML (<Response><Message>...</Message></Response>).
//
// Setup:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN — from https://console.twilio.com/
//   TWILIO_PHONE_NUMBER  — your Twilio voice number, e.g. +14155551234
//   TWILIO_WHATSAPP_NUMBER — Twilio sandbox or production WhatsApp number
//
// Webhook URLs to configure in the Twilio console:
//   Voice (incoming call): POST https://yourdomain/api/twilio/voice
//   Voice gather callback:  POST https://yourdomain/api/twilio/voice/gather
//   WhatsApp (incoming):    POST https://yourdomain/api/twilio/whatsapp

// Detect Tamil Unicode characters (range U+0B80–U+0BFF).
const TAMIL_RE = /[\u0B80-\u0BFF]/;

function detectLang(text) {
  return TAMIL_RE.test(text || "") ? "ta" : "en";
}

// Escape special XML characters to prevent TwiML injection.
function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Return valid Twilio voice and language configuration.
// Twilio supports Google text-to-speech for Tamil (ta-IN).
// Amazon Polly does not offer a native Tamil voice on Twilio, so Google.ta-IN-Standard-A is used.
// For Indian English, Amazon Polly (Polly.Aditi) or Google en-IN is used.
function getVoiceConfig(lang = "en") {
  if (lang === "ta") {
    return {
      voice: "Google.ta-IN-Standard-A",
      language: "ta-IN",
    };
  }
  return {
    voice: "Polly.Aditi",
    language: "en-IN",
  };
}

// Build a TwiML Voice <Response> string.
function buildTwiML(text, lang = "en", { gatherUrl } = {}) {
  const { voice, language } = getVoiceConfig(lang);
  const safeText = xmlEscape(text);

  if (gatherUrl) {
    // Initial greeting — wrap in a Gather to collect the farmer's question.
    const greeting = lang === "ta"
      ? "வணக்கம்! நான் உழவு AI. உங்கள் விவசாய கேள்வியைக் கேட்கவும்."
      : "Hello! I am UzhavAI, your farm assistant. Please ask your agricultural question after the beep.";
    const listening = lang === "ta" ? "கேட்கிறேன்..." : "Listening...";
    const noSpeech = lang === "ta"
      ? "மன்னிக்கவும், உங்கள் குரல் கேட்கவில்லை. மீண்டும் அழைக்கவும். நன்றி!"
      : "Sorry, I didn't hear anything. Please call again. Thank you!";

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${language}">${xmlEscape(greeting)}</Say>
  <Gather input="speech" language="${language}" timeout="5" speechTimeout="auto" action="${xmlEscape(gatherUrl)}">
    <Say voice="${voice}" language="${language}">${xmlEscape(listening)}</Say>
  </Gather>
  <Say voice="${voice}" language="${language}">${xmlEscape(noSpeech)}</Say>
  <Hangup/>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${language}">${safeText}</Say>
</Response>`;
}

// Build valid WhatsApp TwiML: <Response><Message>...</Message></Response>
function buildWhatsAppTwiML(text) {
  // Ensure message stays within WhatsApp limits (~1600 max, keep concise under 1200)
  const trimmed = String(text || "").trim();
  const safeText = xmlEscape(trimmed.length > 1200 ? trimmed.slice(0, 1190) + "…" : trimmed);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${safeText}</Message>
</Response>`;
}

// Handle an incoming Twilio voice call (initial call, before farmer speaks).
// body: Twilio webhook form body (CallSid, From, To, etc.)
// Returns a TwiML string with a Gather element to collect speech.
function handleVoiceCall(body, { gatherUrl = "/api/twilio/voice/gather" } = {}) {
  // Default to Tamil for India numbers (+91), English otherwise.
  const from = (body && body.From) || "";
  const lang = from.startsWith("+91") ? "ta" : "en";
  return buildTwiML("", lang, { gatherUrl });
}

// Handle the gathered speech result after the farmer speaks.
// body: Twilio webhook form body (SpeechResult, Confidence, CallSid, From, etc.)
// askFn: async (prompt, lang) => { answer, confidence, needsExpert, highStakes }
// Returns a TwiML string with the AI answer spoken back and an option to ask another question.
async function handleVoiceGather(body, askFn, { gatherUrl = "/api/twilio/voice/gather" } = {}) {
  const speech = (body && body.SpeechResult) || "";
  const from = (body && body.From) || "";
  const detected = detectLang(speech);
  const lang = speech.trim() ? detected : (from.startsWith("+91") ? "ta" : "en");
  const { voice, language } = getVoiceConfig(lang);

  // Handle no speech detected
  if (!speech.trim()) {
    const noSpeechPrompt = lang === "ta"
      ? "மன்னிக்கவும், உங்கள் குரல் கேட்கவில்லை. உங்கள் கேள்வியை மீண்டும் தெளிவாகக் கேட்கவும்."
      : "Sorry, I didn't catch that. Please speak your agricultural question clearly.";
    const goodbye = lang === "ta" ? "நன்றி, மீண்டும் அழைக்கவும்." : "Thank you for calling. Goodbye!";

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${language}">${xmlEscape(noSpeechPrompt)}</Say>
  <Gather input="speech" language="${language}" timeout="5" speechTimeout="auto" action="${xmlEscape(gatherUrl)}">
    <Say voice="${voice}" language="${language}">${xmlEscape(lang === "ta" ? "கேட்கிறேன்..." : "Listening...")}</Say>
  </Gather>
  <Say voice="${voice}" language="${language}">${xmlEscape(goodbye)}</Say>
  <Hangup/>
</Response>`;
  }

  let answer = "";
  try {
    const result = await askFn(speech.trim(), lang);
    answer = (result && result.answer) || "";

    // If expert handoff needed, append helpline prompt
    if (result && (result.needsExpert || result.highStakes)) {
      const helpline = lang === "ta"
        ? " உறுதிப்படுத்த, கிசான் அழைப்பு மையத்தை 1800-180-1551 அழைக்கவும்."
        : " Please confirm with an agriculture expert or call Kisan helpline: 1800-180-1551.";
      answer = answer + helpline;
    }
  } catch (err) {
    console.error("[twilio] askFn error:", err && err.message);
    answer = lang === "ta"
      ? "மன்னிக்கவும், இப்போது பதில் கொண்டுவர முடியவில்லை. பின்னர் முயற்சிக்கவும்."
      : "Sorry, I could not get an answer right now. Please try again shortly.";
  }

  const followUpPrompt = lang === "ta"
    ? "வேறேதும் கேள்வி உள்ளதா? கேட்கலாம்."
    : "Do you have another question? You can ask now.";
  const endPrompt = lang === "ta"
    ? "நன்றி, வணக்கம்!"
    : "Thank you for calling UzhavAI. Goodbye!";

  // Speak answer, then gather follow-up question in the same call
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${language}">${xmlEscape(answer)}</Say>
  <Gather input="speech" language="${language}" timeout="4" speechTimeout="auto" action="${xmlEscape(gatherUrl)}">
    <Say voice="${voice}" language="${language}">${xmlEscape(followUpPrompt)}</Say>
  </Gather>
  <Say voice="${voice}" language="${language}">${xmlEscape(endPrompt)}</Say>
  <Hangup/>
</Response>`;
}

// Download incoming media from Twilio (used for WhatsApp crop photos).
async function downloadTwilioMedia(url, fetchImpl = fetch) {
  if (!url || typeof url !== "string") return null;
  // Twilio media requires account credentials
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  try {
    const headers = {
      Authorization: "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let resp;
    try {
      resp = await fetchImpl(url, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch (e) {
    return null;
  }
}

// Handle an incoming WhatsApp message via Twilio.
// body: Twilio webhook form body (Body, From, NumMedia, MediaUrl0, MediaContentType0, etc.)
// askFn: async (prompt, lang, opts) => { answer, confidence, needsExpert, highStakes }
// Returns valid WhatsApp TwiML XML: <Response><Message>...</Message></Response>
async function handleWhatsApp(body, askFn, { fetchMedia = downloadTwilioMedia } = {}) {
  const text = (body && body.Body) || "";
  const lang = detectLang(text);
  const numMedia = parseInt((body && body.NumMedia) || "0", 10);
  const mediaUrl = body && (body.MediaUrl0 || body.MediaUrl);
  const mediaContentType = String((body && (body.MediaContentType0 || body.MediaContentType)) || "").toLowerCase();

  // 1. Non-image audio detection: voice notes on WhatsApp (e.g. audio/ogg, audio/amr)
  if (numMedia > 0 && mediaContentType.startsWith("audio/")) {
    const audioNotice = lang === "ta"
      ? "குரல் பதிவு கிடைத்தது. தற்போது வாட்ஸ்அப் குரல் பதிவுகளை நேரடியாக கேட்க முடியாது. தயவுசெய்து உங்கள் கேள்வியை தட்டச்சு செய்யவும் அல்லது எங்கள் தொலைபேசி எண்ணை அழைத்து தமிழில் பேசவும்."
      : "Voice note received. WhatsApp audio cannot be processed directly yet. Please type your agricultural question or call our phone helpline to speak with UzhavAI.";
    return buildWhatsAppTwiML(audioNotice);
  }

  // 2. Non-image, non-audio unsupported media (e.g. video, pdf)
  if (numMedia > 0 && mediaContentType && !mediaContentType.startsWith("image/")) {
    const mediaNotice = lang === "ta"
      ? "கோப்பு கிடைத்தது. பயிர் புகைப்படங்களை (JPEG/PNG) அல்லது உரை செய்திகளை அனுப்பவும்."
      : "File received. Please send crop photos (JPEG/PNG) or text questions.";
    return buildWhatsAppTwiML(mediaNotice);
  }

  // 3. Image media handling: photo pest/disease diagnosis
  let imageBase64 = null;
  const isImage = mediaContentType.startsWith("image/") || (numMedia > 0 && !mediaContentType);
  if (numMedia > 0 && mediaUrl && isImage) {
    imageBase64 = await fetchMedia(mediaUrl);
  }

  // If photo was received but image could not be downloaded (e.g. credentials not set) and no text:
  if (numMedia > 0 && isImage && !text.trim() && !imageBase64) {
    const photoNotice = lang === "ta"
      ? "புகைப்படம் கிடைத்தது. பயிரில் என்ன பிரச்சனை என்று வார்த்தைகளில் சொல்லுங்கள் — நான் பதில் சொல்கிறேன்."
      : "Photo received! Please describe what you see on the crop in words (e.g. 'yellow leaves', 'brown spots') and I will give you guidance.";
    return buildWhatsAppTwiML(photoNotice);
  }

  // 4. Empty message with no media
  if (!text.trim() && !imageBase64) {
    const greeting = lang === "ta"
      ? "வணக்கம்! நான் உழவு AI. உங்கள் வேளாண் கேள்வியை தமிழிலோ ஆங்கிலத்திலோ அனுப்புங்கள்."
      : "Hello! I am UzhavAI. Send me your farming question in Tamil or English and I will help you.";
    return buildWhatsAppTwiML(greeting);
  }

  // 5. Ask flow (image and/or text)
  const promptText = text.trim() || (lang === "ta"
    ? "இந்தப் பயிர் புகைப்படத்தை பார்த்து என்ன நோய் அல்லது பூச்சி தாக்குதல் என்று சொல்லவும்."
    : "Please inspect this crop photo and diagnose any pest or disease problem.");

  let answer = "";
  try {
    const result = await askFn(promptText, lang, { imageBase64 });
    answer = (result && result.answer) || "";

    if (result && (result.needsExpert || result.highStakes)) {
      const helpline = lang === "ta"
        ? "\n\n⚠ இதை ஒரு வேளாண் நிபுணரிடம் உறுதிப்படுத்துங்கள். கிசான் அழைப்பு மையம்: 1800-180-1551"
        : "\n\n⚠ Please confirm with an agriculture expert before acting. Kisan helpline: 1800-180-1551";
      answer = answer + helpline;
    }
  } catch (err) {
    console.error("[twilio] WhatsApp askFn error:", err && err.message);
    answer = lang === "ta"
      ? "மன்னிக்கவும், இப்போது பதில் கொண்டுவர முடியவில்லை. பின்னர் முயற்சிக்கவும்."
      : "Sorry, could not get an answer right now. Please try again shortly.";
  }

  return buildWhatsAppTwiML(answer);
}

module.exports = {
  buildTwiML,
  buildWhatsAppTwiML,
  getVoiceConfig,
  handleVoiceCall,
  handleVoiceGather,
  handleWhatsApp,
  detectLang,
  xmlEscape,
  downloadTwilioMedia,
};
