# കായൽ സാഥി · Kayal Saathi

**A voice-first flood and backwater situation room for Alappuzha. Residents report in Malayalam (or Hindi, Tamil, English) by voice. AI combines their reports with live rain and river forecasts. Officials send verified voice alerts back to residents' phones in their own language.**

**🔗 Live demo: https://kayal-saathi.onrender.com** · Situation Room: https://kayal-saathi.onrender.com/dashboard

Built solo for **HackaThoni 2026: The Houseboat Hackathon** (Alappuzha, 21–22 Nov).
Primary track: **02 Beyond English (Sarvam)**. It also covers **01 The Alappuzha Challenge** (floods, backwater waste, livelihoods) and **03 Beyond the Screen** (voice, camera, GPS, offline).

<p align="center">
  <img src="public/icon-192.png" width="88" alt="Kayal Saathi logo: a Kerala houseboat on the backwater" />
</p>

## See it working

All screenshots below are from the real app running with the **live Sarvam AI**: real Malayalam speech, real translations, real forecasts. Nothing is mocked up.

### Resident app (phone)

| 1 · Home | 2 · Speak a report | 3 · Ask by voice |
|:---:|:---:|:---:|
| <img src="docs/screenshots/01-resident-home.png" width="250" alt="Resident home: flood risk near you, numbered steps, big mic button" /> | <img src="docs/screenshots/02-voice-report.png" width="250" alt="Malayalam voice report transcribed, translated, categorised, merged with 3 other residents" /> | <img src="docs/screenshots/03-ask-forecast.png" width="250" alt="Spoken Malayalam answer using the live rain forecast" /> |
| Flood risk for *your* village, numbered steps, one big mic | Malayalam speech → transcript, English translation, category, severity, merged with 3 earlier reports | "Will rain increase in Kuttanad?" → spoken Malayalam answer from the live forecast |

| 4 · Receives an official alert | 5 · No signal on the boat |
|:---:|:---:|
| <img src="docs/screenshots/07-resident-alert.png" width="250" alt="Official voice alert received in Malayalam with Hindi and English options" /> | <img src="docs/screenshots/09-offline-queue.png" width="250" alt="Offline banner: report saved on the phone, sent automatically later" /> |
| Plays in Malayalam; one tap for Hindi or English | Report saved on the phone, sent automatically when signal returns |

### Situation Room (officials)

**Incidents:** duplicate reports merged; each shows every resident's words in their own language.
<img src="docs/screenshots/04-situation-room-incidents.png" alt="Situation Room: incident list and map; Kainakary incident with 4 reports in Malayalam and Hindi" />

**Flood risk:** an explainable 0–100 score per village, built from live rain + river forecasts, reports and terrain.
<img src="docs/screenshots/05-flood-risk.png" alt="Flood-risk detail for Kainakary: reasons, score breakdown, 7-day rainfall and river discharge charts" />

**Voice alert:** AI drafts it, Sarvam Translate makes Malayalam + Hindi, and the official reviews it before sending.
<img src="docs/screenshots/06-alert-review.png" alt="Alert review modal with Malayalam, Hindi and English text and a radius selector" />

**Situation brief:** one click gives an English brief for the district team and a Malayalam voice summary for ward members.
<img src="docs/screenshots/08-situation-brief.png" alt="AI situation brief with overall status, top flood risks, incidents and recommended actions" />

| Phone layout | Dark mode |
|:---:|:---:|
| <img src="docs/screenshots/10-situation-room-mobile.png" width="260" alt="Situation Room on a phone" /> | <img src="docs/screenshots/11-dark-mode.png" width="520" alt="Situation Room in dark mode with dimmed map" /> |

---

## The problem

Much of Kuttanad is farmed **below sea level** behind earthen bunds. When rain and rising rivers combine, the first warning signs are seen by residents, fishers and houseboat crews: water entering homes, a weak bund, a canal choked with water hyacinth. Two gaps stop that information from saving anyone:

1. **Up:** reporting means typing in English on a form, so elderly people, low-literacy residents and Hindi-speaking migrant workers mostly don't report.
2. **Down:** official warnings arrive as generic text, not as a voice message in your language about *your* village.

## The loop

```
  RESIDENT (phone, any language)                       OFFICIAL (Situation Room)
  ─────────────────────────────                        ──────────────────────────
  🎙️ speaks a report  ─┐                          ┌─►  incidents on a live map,
  📷 photo  📍 GPS     │                          │    duplicates merged + confirmed
  📶 no signal? queued │   Sarvam Saaras v4 STT   │
     and sent later    ├─► Sarvam-105B triage ────┤    flood-risk index per village
                       │   (translate, category,  │    = rain forecast + river forecast
                       │    severity, place)      │      + resident reports + terrain
                       │                          │
  🔔 hears an alert  ◄─┼── Bulbul v3 TTS ◄──── Sarvam Translate ◄── 📢 official reviews
     in Malayalam /    │   (ml / hi / en)       (ml + hi, scripts      & sends an alert,
     Hindi / English   │                         and dates verified)   targeted by radius
                       │
  ❓ "Will Kainakary flood?" ─► answer grounded in incidents + risk + alerts, spoken back
```

## Features

| | Feature | Depth |
|---|---|---|
| 🎙️ | **Voice reporting in any Indian language** | Auto language detection (`saaras:v4`, `language_code=unknown`), Malayalam + English place-name hints, fuzzy matching of misheard village names |
| 🌧️ | **Flood-risk index for 13 villages (0–100)** | Live **Open-Meteo rainfall** + **GloFAS river-discharge** forecasts, open flood reports within 3 km (severity- and recency-weighted), and terrain (below-sea-level Kuttanad polders score highest). Every score is **explained** ("25 mm on Wednesday 25 November; river rising to 1.4×; 3 flood reports within 3 km") |
| 👥 | **Incidents, not just pins** | Reports of the same problem within 600 m and 72 h merge into one incident with a confirmation count. 2+ reports or a photo marks it **confirmed**, which cuts duplicates and spam |
| 📢 | **Location-targeted voice alerts** | Official picks an area or incident → AI writes the alert in English from verified facts only → **Sarvam Translate** produces Malayalam + Hindi → official reviews and edits → Bulbul voices all three → phones within the chosen radius show it and play it |
| ❓ | **Ask by voice** | Answers are grounded in incidents, the risk index and active alerts; first-hand reports take priority; spoken back in the asker's language |
| 📋 | **AI situation brief** | One click: English brief for the district team + Malayalam voice summary for ward members |
| 📶 | **Works without signal** | Reports made offline (audio + photo) are stored on the phone (IndexedDB) and sent automatically on reconnect, keeping the original capture time. The app shell works offline (service worker) |

## Accuracy and safety: measured, not assumed

`npm run eval` runs the real pipeline against Sarvam and prints everything, including back-translations so non-Malayalam speakers can check the output.

| Check | Result |
|---|---|
| 10 spoken reports (7 Malayalam, 1 Hindi, 1 Tamil, 1 English): language, category, place, severity | **10/10** (first version: 7/10; place names were misheard until fixed) |
| Alert scripts: Malayalam in Malayalam script, Hindi in Devanagari | Verified on every draft, and the server refuses to broadcast otherwise |
| Village names in translated alerts | Placeholder protection keeps the official spelling (കൈനകരി / कैनकरी) |
| Dates in translated alerts | Full dates only; a timing check rejects any translation that adds "today/tomorrow" |

Issues the evaluation caught and fixed: an LLM writing Malayalam into the Hindi field (now translated with Sarvam Translate and script-checked), a translator turning "on Wednesday, in 4 days" into "tomorrow, for four days" (now absolute dates, a timing check and a second-model retry), the translator respelling village names (now placeholder-protected), and a Q&A answer saying a hyacinth-blocked canal was fine to travel (first-hand incidents now take priority).

**Human in the loop:** the AI never sends anything by itself. Every alert is reviewed and editable before broadcast. The risk index is labelled as an *indicative community index, not an official warning*, and points people to IMD and KSDMA.

## Sarvam APIs used

| API | Used for |
|---|---|
| `POST /speech-to-text` · `saaras:v4` | Reports and questions in any Indian language, with keyterms |
| `POST /v1/chat/completions` · `sarvam-105b` (`reasoning_effort: null`) | Triage to JSON, grounded Q&A, alert drafting, situation brief |
| `POST /translate` · `mayura:v1` (fallback `sarvam-translate:v1`) | Alert translation to Malayalam + Hindi |
| `POST /text-to-speech` · `bulbul:v3` | Spoken answers, voice alerts (ml/hi/en), brief audio |

## Tests

```bash
npm test        # 32 unit + API tests, offline (mock mode, no credits)
npm run eval    # live accuracy evaluation against Sarvam (~₹6)
```

A 19-step browser test (Playwright, real Chrome, **live Sarvam AI**) covers: a Malayalam voice report through the real microphone path, photo upload, the offline queue and reconnect, the incident merge, status changes, risk charts, alert draft → edit → broadcast, a resident inside the radius receiving it in Malayalam and Hindi, a resident 20 km away not receiving it, the brief, live fly-to, layer toggles and the mobile layout. **19/19 pass.**

Real output from the final build (unit tests, live browser E2E, live accuracy evaluation):

<img src="docs/screenshots/12-test-results.png" alt="Test results: 32/32 unit and API tests, 19/19 live browser end-to-end steps, 10/10 voice accuracy" />

## Run it

```bash
npm install
cp .env.example .env      # paste SARVAM_API_KEY=...
npm start                 # http://localhost:3000   Situation Room: /dashboard
```

Node 22+. No build step. One Express app with a JSON file store. Weather data needs no key.

> Mic, camera and GPS need HTTPS on phones: use the Render deploy (`render.yaml`) or a tunnel.

## Project layout

```
src/app.js         routes: reports, incidents, risk, alerts, brief, ask (+ per-IP rate limits)
src/sarvam.js      Sarvam client: STT, chat, translate, TTS + usage counters
src/ai.js          triage, grounded Q&A, alert drafting + translation checks, brief
src/risk.js        explainable flood-risk index
src/weather.js     Open-Meteo / MET Norway rain + GloFAS river forecasts (cached, fallback, fail-safe)
src/incidents.js   duplicate-report clustering
src/places.js      Alappuzha gazetteer: coordinates, terrain, ml/hi names, place protection
public/            resident PWA (app.js, offline.js, sw.js) + Situation Room (dashboard.js)
test/              API + unit tests        scripts/eval.mjs   live accuracy evaluation
```

## Credit budget

A voice report costs about ₹0.10, a spoken answer about ₹0.50, and a 3-language voice alert about ₹2. **500 credits (assuming 1 credit ≈ ₹1) cover a full hackathon of demos.** Per-IP rate limits, mock mode and live usage counters (`/api/health`) protect them.

## Roadmap

IVR / WhatsApp voice for feature phones · auto-routing to the right department (irrigation, pollution control board, municipality) · KSDMA / IMD warning ingestion · bund-breach prediction from historical flood maps · photo-based hyacinth and plastic detection.

*Sample reports on first run are illustrative demo data at real Alappuzha locations (labelled "sample"), not real incidents.*

MIT licensed.
