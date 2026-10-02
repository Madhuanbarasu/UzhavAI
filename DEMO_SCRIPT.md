# UzhavAI — 3-minute demo video script

Record your screen (use the deployed app URL if one is available; deployment is otherwise pending) with your voice over it. Suggested tool: your phone's screen recorder, or OBS/Loom on a laptop. Practice once before recording — it should feel like a real farmer's conversation, not a pitch. Configure an AI provider key for live answers. The repository tests use fakes and do not verify real provider, data.gov.in, or Twilio traffic.

**Total: ~3:00. Cut anything you go over on.**

---

### 0:00–0:20 — Cold open: the problem (no screen yet, just you or a title card)

> "A farmer near Thanjavur sees brown spots on his tomato leaves. He doesn't read English well, his phone signal is patchy, and the nearest agri-office is 12 km away. Today, getting a trustworthy answer — in his language — is slow. UzhavAI is a phone call away instead."

### 0:20–0:35 — Intro card
Show the title slide of your idea deck for 3–4 seconds: **UzhavAI — Ask in your language. Farm smarter.** PS-06.

### 0:35–1:20 — Core demo: voice + photo pest ID (screen recording starts)
1. Open the app. Switch language to **தமிழ்** on screen — point out it's genuinely bilingual, not just translated labels.
2. Tap the mic button, speak a real question out loud (e.g. "என் தக்காளி இலைகளில் பழுப்பு புள்ளிகள் உள்ளன" / "My tomato leaves have brown spots").
3. Upload a crop photo (any tomato-leaf photo works for the demo).
4. Tap **Ask UzhavAI** — let the "Thinking…" moment play out on camera, don't cut it, it shows this is a live call, not a canned response.
5. When the answer appears, tap **🔊 Speak answer** and let it read aloud. This is the moment that sells the product — say over it: *"That's not a script — that's an AI model answering live, in Tamil, based on what's in the photo."*

### 1:20–1:55 — Mandi prices
1. Switch to the **Mandi Prices** tab. Point out the source note. When a data.gov.in key is configured and its request succeeds, the app displays live-source prices; cached results are marked as cached. Without a key, or if the request fails or has no usable records, the app shows clearly labeled static demo values.
2. Say: *"This feed can use data.gov.in when configured and available. The fallback is sample data, clearly labeled as not live or official. We have not verified a live data.gov.in request for this demo."*

### 1:55–2:30 — Scheme navigator + human handoff (your differentiator)
1. Switch to **Government schemes**. Point out the banner that this is informational guidance, not an official eligibility decision. The app retrieves from embedded scheme reference content; ask a question and show an AI answer if a provider key is configured.
2. Then go back to the Ask box and deliberately ask something the AI should be unsure about (e.g. a very specific eligibility edge case, or "how many ml of pesticide X should I use") to trigger the **expert-handoff banner**. The quickest reliable trigger is a chemical-dose question, e.g. *"How many ml of pesticide should I spray per litre of water?"* — the app always routes these to an expert, whatever the model's confidence.
3. Say: *"This is the part we think matters most — when the model isn't confident, especially about money or chemicals, it says so and tells the farmer to confirm with a real expert instead of guessing. That's the human safety net from our deck, working live."*

### 2:30–2:50 — Tech + honesty about scope
Show the deck's "Technical approach" slide for a few seconds.

> "Under the hood: browser speech tools, a multimodal AI model (Gemini or Claude), embedded scheme and crop-advisory knowledge, and a mandi endpoint that can use data.gov.in when configured. Twilio voice and WhatsApp webhook handlers are implemented, but real calls and messages require Twilio credentials and public webhook setup. This recording does not claim those external integrations or live data were tested."

### 2:50–3:00 — Close
> "UzhavAI: no task runs blind, and no farmer has to wait for an answer in a language they don't speak. Thank you."

---

**Recording tips**
- Do the demo pass once *without* recording first — Web Speech API voice recognition can mishear on the first try in a noisy room; a quiet room helps a lot.
- If Tamil text-to-speech has no installed voice on your recording device, say so on camera rather than let it silently fail — judges respect honesty about platform limits more than a hidden bug.
- Keep your cursor movements slow and deliberate; judges are reading the screen, not just listening.
