# കായൽ സാഥി · Kayal Saathi

**Report backwater waste and flooding in Alappuzha by voice: speak Malayalam, snap a photo, done.**

Built solo for **HackaThoni 2026: The Houseboat Hackathon** (Alappuzha, 21–22 Nov).
Primary track: **02 Beyond English (Sarvam)**. It also covers **01 The Alappuzha Challenge** and **03 Beyond the Screen** (photo + GPS).

---

## The problem

The people who see backwater problems first are residents, fishers, houseboat crews and paddy farmers in Kuttanad: plastic piling up at jetties, water hyacinth choking canals, sewage from boats, water entering homes. Many of them are elderly or more comfortable in Malayalam than English. Reporting today means typing into an English form, so most problems go unreported until they become emergencies.

## The solution

| Resident (phone) | Authority (dashboard) |
|---|---|
| Tap the mic and **speak in Malayalam** (or Hindi, Tamil, English: auto-detected) | Every report appears **live on a map**, colour-coded by type and sized by severity |
| Optionally snap a **photo**; **GPS** is attached automatically | Malayalam original + **English translation** side by side |
| Ask by voice: *"കൈനകരിയിൽ വെള്ളപ്പൊക്കമുണ്ടോ?"* (Is there flooding in Kainakary?) and **hear the answer spoken back in Malayalam** | Filter by category/status, mark reports *In progress / Resolved* |

Hindi support matters here: Alappuzha has a large migrant-worker population, and their reports reach the same dashboard in English.

## How it works

```
 🎙️ voice (webm)  ──►  Sarvam Saaras v4 (speech-to-text, auto language detect,
                        keyterms boosted with Alappuzha place names)
                         │
                         ▼
                   Sarvam-105B  ──►  {English translation, category, severity 1–5, place}
                         │
 📷 photo + 📍 GPS ──────┤   (no GPS? fall back to a gazetteer of 18 local places)
                         ▼
                   reports store  ──►  live Leaflet map dashboard (polls every 4 s)

 ❓ voice question ─► Saaras v4 ─► Sarvam-105B (answers only from reports) ─► Bulbul v3 TTS ─► 🔊 Malayalam audio
```

| Sarvam API | Used for |
|---|---|
| `POST /speech-to-text` (`saaras:v4`, `language_code=unknown`, `keyterms`) | Transcribing reports & questions in any Indian language |
| `POST /v1/chat/completions` (`sarvam-105b`) | Translation + triage into structured JSON; grounded Q&A |
| `POST /text-to-speech` (`bulbul:v3`, mp3) | Speaking answers back in the user's language |

## Run it

```bash
npm install
cp .env.example .env      # paste your SARVAM_API_KEY (leave empty for offline demo mode)
npm start                 # http://localhost:3000   dashboard: http://localhost:3000/dashboard
npm test                  # end-to-end API tests in mock mode (uses no credits)
```

Requires Node 22+. No build step, no database server: one Express app and a JSON file store.

> Mic, camera and GPS need HTTPS on phones. Use the deployed URL (Render, see `render.yaml`) or a tunnel such as `npx localtunnel --port 3000`.

## Credit budget (Sarvam)

One voice report = one STT call (~10 s ≈ ₹0.08) + one chat call (~600 tokens ≈ ₹0.01).
One voice question adds TTS (~150 chars ≈ ₹0.45). **500 credits (assuming 1 credit ≈ ₹1) cover several hundred full demo interactions.**
Safeguards: `MOCK=1` for UI work, a per-IP rate limit (30 AI calls / 10 min), and live usage counters at `/api/health`.

## Project layout

```
server.js            entry point (loads .env)
src/app.js           Express routes: /api/reports, /api/ask, /api/health
src/sarvam.js        Sarvam REST client (STT, chat, TTS) + usage counters
src/ai.js            triage + Q&A prompts, language helpers, offline mock mode
src/places.js        Alappuzha gazetteer (STT keyterms + location fallback)
src/seed.js          illustrative sample reports (flagged "sample" in the UI)
src/store.js         JSON-file store
public/              resident PWA (index.html/app.js) + dashboard (dashboard.html/js)
test/api.test.js     end-to-end tests
```

## Roadmap

- WhatsApp / IVR phone-call reporting for people without smartphones
- Auto-routing to the right department (municipality, irrigation, pollution control board)
- Flood early warnings: push a Malayalam voice alert to everyone near a high-severity report
- Photo-based detection of water hyacinth and plastic density

*Sample reports on first run are illustrative demo data at real Alappuzha locations, not real incidents.*

MIT licensed.
