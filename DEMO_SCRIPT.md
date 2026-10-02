# UzhavAI — 3-minute demo video script

Record your screen (the deployed app URL — open it once beforehand to wake the free-tier server) with your voice over it. Suggested tool: your phone's screen recorder, or OBS/Loom on a laptop. Practice once before recording — it should feel like a real farmer's conversation, not a pitch.

**Total: ~3:00. Cut anything you go over on.**

---

### 0:00–0:20 — Cold open: the problem (no screen yet, just you or a title card)

> "A farmer near Thanjavur sees brown spots on his tomato leaves. He doesn't read English well, his phone signal is patchy, and the nearest agri-office is 12 km away. Today, getting a trustworthy answer — in his language — is slow. UzhavAI is a phone call away instead."

### 0:20–0:35 — Intro card
Show the title slide of your idea deck for 3–4 seconds: **UzhavAI — Ask in your language. Farm smarter.** PS-06.

### 0:35–1:20 — Core demo: voice + photo pest ID (screen recording starts)
1. Open the deployed app. Switch language to **தமிழ்** on screen — point out it's genuinely bilingual, not just translated labels.
2. Tap the mic button, speak a real question out loud (e.g. "என் தக்காளி இலைகளில் பழுப்பு புள்ளிகள் உள்ளன" / "My tomato leaves have brown spots").
3. Upload a crop photo (any tomato-leaf photo works for the demo).
4. Tap **Ask UzhavAI** — let the "Thinking…" moment play out on camera, don't cut it, it shows this is a live call, not a canned response.
5. When the answer appears, tap **🔊 Speak answer** and let it read aloud. This is the moment that sells the product — say over it: *"That's not a script — that's an AI model answering live, in Tamil, based on what's in the photo."*

### 1:20–1:55 — Mandi prices
1. Switch to the **Mandi Price Snapshot** tab. Point out the table **and the note above it saying these are not live prices.**
2. Say: *"This is a clearly labelled snapshot of sample values, not live government data. A production version would feed the same table from a live mandi source — that part is on our roadmap, not built yet."*

### 1:55–2:30 — Scheme navigator + human handoff (your differentiator)
1. Switch to **Government schemes**. Point out the banner that this is informational guidance, not an official eligibility decision. Open PM-KISAN, type a question, tap Ask, show a real AI answer come back.
2. Then go back to the Ask box and deliberately ask something the AI should be unsure about (e.g. a very specific eligibility edge case, or "how many ml of pesticide X should I use") to trigger the **expert-handoff banner**. The quickest reliable trigger is a chemical-dose question, e.g. *"How many ml of pesticide should I spray per litre of water?"* — the app always routes these to an expert, whatever the model's confidence.
3. Say: *"This is the part we think matters most — when the model isn't confident, especially about money or chemicals, it says so and tells the farmer to confirm with a real expert instead of guessing. That's the human safety net from our deck, working live."*

### 2:30–2:50 — Tech + honesty about scope
Show the deck's "Technical approach" slide for a few seconds.

> "Under the hood: Web Speech API for voice, a multimodal AI model (Gemini or Claude) for reasoning, grounded on mandi and scheme data. For the hackathon MVP, that data is embedded directly; the roadmap — not built yet — is a live mandi data feed, a proper retrieval pipeline over ICAR advisories, and phone/WhatsApp intake so no smartphone is needed at all."

### 2:50–3:00 — Close
> "UzhavAI: no task runs blind, and no farmer has to wait for an answer in a language they don't speak. Thank you."

---

**Recording tips**
- Do the demo pass once *without* recording first — Web Speech API voice recognition can mishear on the first try in a noisy room; a quiet room helps a lot.
- If Tamil text-to-speech has no installed voice on your recording device, say so on camera rather than let it silently fail — judges respect honesty about platform limits more than a hidden bug.
- Keep your cursor movements slow and deliberate; judges are reading the screen, not just listening.
