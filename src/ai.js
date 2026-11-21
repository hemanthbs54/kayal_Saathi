// Report triage + question answering on top of Sarvam (with an offline mock mode for tests/demos).
import * as sarvam from './sarvam.js';
import { KEYTERMS, PLACES, nativePlaceNames, protectPlaces } from './places.js';

export const CATEGORIES = {
  waste: { en: 'Waste dumping', ml: 'മാലിന്യം' },
  flood: { en: 'Flooding', ml: 'വെള്ളപ്പൊക്കം' },
  blocked_canal: { en: 'Blocked canal', ml: 'തോട് അടഞ്ഞു' },
  water_quality: { en: 'Water pollution', ml: 'ജലമലിനീകരണം' },
  other: { en: 'Other', ml: 'മറ്റുള്ളവ' },
};

export const LANG_NAMES = {
  'ml-IN': 'Malayalam', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil', 'en-IN': 'English', 'bn-IN': 'Bengali',
  'kn-IN': 'Kannada', 'te-IN': 'Telugu', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'od-IN': 'Odia',
  'pa-IN': 'Punjabi',
};
const TTS_LANGS = new Set(Object.keys(LANG_NAMES));

export const isMock = () => process.env.MOCK === '1' || !process.env.SARVAM_API_KEY;

/** Guess language of typed text from its script. */
export function detectScript(text) {
  if (/[ഀ-ൿ]/.test(text)) return 'ml-IN';
  if (/[ऀ-ॿ]/.test(text)) return 'hi-IN';
  if (/[஀-௿]/.test(text)) return 'ta-IN';
  if (/[ঀ-৿]/.test(text)) return 'bn-IN';
  return 'en-IN';
}

// ---------- Speech ----------
const MOCK_TRANSCRIPT = 'പുന്നമട ജെട്ടിക്ക് സമീപം പ്ലാസ്റ്റിക് മാലിന്യം കൂട്ടിയിട്ടിരിക്കുന്നു, ദുർഗന്ധം ഉണ്ട്';

export async function transcribe(buffer, mimetype) {
  if (isMock()) return { transcript: MOCK_TRANSCRIPT, languageCode: 'ml-IN' };
  return sarvam.speechToText(buffer, mimetype, { keyterms: KEYTERMS });
}

// ---------- Triage ----------
const KEYWORDS = [
  ['flood', ['flood', 'water level', 'water rising', 'submerged', 'വെള്ളപ്പൊക്ക', 'വെള്ളം കയറ', 'കയറി', 'ഉയരുന്നു', 'മുങ്ങി', 'വെള്ളക്കെട്ട്', 'बाढ़', 'पानी भर']],
  ['water_quality', ['dead fish', 'oil', 'smell', 'sewage', 'colour', 'color', 'മീൻ ചത്ത', 'മലിനജല', 'നിറവ്യത്യാസ', 'എണ്ണ', 'गंदा पानी']],
  ['blocked_canal', ['blocked', 'hyacinth', 'clogged', 'drain', 'പോള', 'അടഞ്ഞ', 'കാന', 'ഒഴുക്കില്ല', 'नाली']],
  ['waste', ['plastic', 'waste', 'garbage', 'trash', 'dump', 'പ്ലാസ്റ്റിക്', 'മാലിന്യ', 'कचरा', 'कूड़ा']],
];

export function heuristicTriage(text) {
  const t = text.toLowerCase();
  const hit = KEYWORDS.find(([, words]) => words.some((w) => t.includes(w)));
  const category = hit ? hit[0] : 'other';
  const danger = /(house|home|വീട|school|സ്കൂൾ|danger|അപകട|life)/i.test(text);
  const severity = category === 'flood' ? (danger ? 5 : 4) : danger ? 4 : 3;
  return { category, severity };
}

const TRIAGE_PROMPT = `You triage community reports from residents of Alappuzha (Kerala backwaters, Kuttanad).
Reports may be in Malayalam, Hindi, Tamil, English or mixed. They come from speech recognition, so words
and especially place names may be misspelled: interpret them in context (e.g. a blocked "train" with
rainwater on the road is a blocked drain). Known local places: ${PLACES.map((p) => `${p.name} (${p.ml})`).join(', ')}.
If a mentioned place sounds like one of these, use that exact English name.
Return ONLY a JSON object, no prose:
{"title": "<English title, max 8 words>",
 "english": "<faithful English translation of the report>",
 "category": "waste" | "flood" | "blocked_canal" | "water_quality" | "other",
 "severity": <integer 1-5, using this scale:
   5 = danger to life: water entering homes, people trapped or needing evacuation (children/elderly to be moved)
   4 = roads or fields flooded, unsafe drinking water, sewage discharge, boat/ferry service stopped
   3 = canal blocked, dead fish, large dumping, bad smell
   2 = small or one-off dumping or litter
   1 = minor nuisance>,
 "place": "<place name mentioned, in English, or empty string>"}`;

function parseJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

export async function triage(transcript, languageCode) {
  const fallback = heuristicTriage(transcript);
  if (isMock()) {
    return {
      title: `${CATEGORIES[fallback.category].en} reported`,
      english: languageCode === 'en-IN' ? transcript : `[translation unavailable in mock mode] ${transcript}`,
      place: '',
      ...fallback,
    };
  }
  const raw = await sarvam.chat([
    { role: 'system', content: TRIAGE_PROMPT },
    { role: 'user', content: `Language: ${LANG_NAMES[languageCode] || 'unknown'}\nReport: ${transcript}` },
  ], { temperature: 0 });
  const j = parseJson(raw) || {};
  const category = CATEGORIES[j.category] ? j.category : fallback.category;
  const sev = Number.parseInt(j.severity, 10);
  return {
    title: String(j.title || `${CATEGORIES[category].en} reported`).slice(0, 80),
    english: String(j.english || transcript),
    category,
    severity: sev >= 1 && sev <= 5 ? sev : fallback.severity,
    place: String(j.place || ''),
  };
}


// ---------- Shared context ----------
function ago(iso) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function answerLanguage(lang) {
  if (!lang || lang === 'unknown') return 'ml-IN';
  return TTS_LANGS.has(lang) ? lang : 'en-IN';
}

function incidentLines(incidents, max = 30) {
  return incidents
    .filter((i) => i.status !== 'resolved')
    .slice(0, max)
    .map((i) => `- [${i.category}] ${i.title} @ ${i.place || 'unknown place'} (${i.confirmations} report${i.confirmations > 1 ? 's' : ''}, latest ${ago(i.lastAt)}, severity ${i.severity}/5, ${i.status})`)
    .join('\n');
}

function riskLines(risk, { scores = true } = {}) {
  return (risk?.areas || [])
    .map((a) => `- ${a.name}: flood risk ${scores ? `${a.score}/100 ` : ''}(${a.levelEn}). ${a.reasons.join('; ')}`)
    .join('\n');
}

function alertLines(alerts) {
  return alerts.slice(0, 5).map((a) => `- ${ago(a.createdAt)} for ${a.place}: ${a.text.en}`).join('\n');
}

const SORRY = {
  'ml-IN': 'ക്ഷമിക്കണം, ഇപ്പോൾ ഉത്തരം നൽകാൻ കഴിയുന്നില്ല. ദയവായി വീണ്ടും ശ്രമിക്കുക.',
  'hi-IN': 'माफ़ कीजिए, अभी जवाब नहीं दे पा रहे हैं। कृपया फिर से कोशिश करें।',
};

async function speak(text, lang) {
  try {
    return await sarvam.textToSpeech(text, lang);
  } catch (e) {
    console.warn('TTS failed:', e.message);
    return null;
  }
}

// ---------- Q&A ----------
/** ctx: { incidents, risk, alerts } */
export async function answer(question, lang, ctx) {
  const outLang = answerLanguage(lang);
  const { incidents = [], risk = null, alerts = [] } = ctx;

  if (isMock()) {
    const top = incidents.filter((i) => i.status !== 'resolved').sort((a, b) => b.severity - a.severity)[0];
    const hot = risk?.areas?.[0];
    const text = [
      top ? `${top.place || 'ആലപ്പുഴ'} ഭാഗത്ത് ${CATEGORIES[top.category].ml} റിപ്പോർട്ട് ചെയ്തിട്ടുണ്ട്.` : 'ഇപ്പോൾ റിപ്പോർട്ടുകളൊന്നുമില്ല.',
      hot ? `${hot.ml || hot.name} ഭാഗത്ത് വെള്ളപ്പൊക്ക സാധ്യത ${hot.levelMl}.` : '',
    ].join(' ').trim();
    return { text, lang: 'ml-IN', audio: null };
  }

  const text = await sarvam.chat(
    [
      {
        role: 'system',
        content: `You are Kayal Saathi, a friendly voice assistant for residents of Alappuzha, Kerala.
Answer using ONLY the information below: community incidents, the flood-risk index (built from live rain and
river forecasts plus resident reports) and official alerts. Never add facts that are not below (e.g. do not call
a blocked canal "flooded").
Priority: open community incidents at or near the asked place are first-hand facts and MUST be mentioned first
(e.g. a canal blocked by water hyacinth means boats cannot pass: do not say travel is fine). Then, for "will it
flood / will it rain / is it safe" questions, add the risk level and its reasons and say it is an estimate. Keep
dates exactly as written (a forecast "in 4 days" is not "today"). Use plain words for amounts (light, heavy,
very heavy rain) instead of decimals. If nothing relevant is known, say so and give
one short safety tip.
The question comes from speech recognition, so place names may be misspelled: match them to the closest place.
Reply in ${LANG_NAMES[outLang]} using its native script. Max 3 short sentences. No markdown, no lists, no numeric
scores or internal labels: it will be read aloud to a resident.

Active official alerts:
${alertLines(alerts) || '(none)'}

Community incidents (newest first):
${incidentLines(incidents) || '(none)'}

Flood-risk index by area (highest first):
${riskLines(risk, { scores: false }) || '(unavailable)'}`,
      },
      { role: 'user', content: question },
    ],
    { maxTokens: 400, temperature: 0.3 },
  );
  if (!text) return { text: SORRY[outLang] || 'Sorry, I could not answer right now. Please try again.', lang: outLang, audio: null };
  return { text, lang: outLang, audio: await speak(text, outLang) };
}

// ---------- Alerts ----------
const ALERT_LANGS = { ml: 'ml-IN', hi: 'hi-IN', en: 'en-IN' };

/**
 * Draft a short public alert in Malayalam, Hindi and English from verified context.
 * subject: { kind: 'area', area } | { kind: 'incident', incident }
 */
export async function draftAlert(subject, note = '') {
  const facts =
    subject.kind === 'area'
      ? `Area: ${subject.area.name}. Flood-risk index ${subject.area.score}/100 (${subject.area.levelEn}). Reasons: ${subject.area.reasons.join('; ')}.`
      : `Incident: ${subject.incident.title} at ${subject.incident.place || 'reported location'}. Category: ${CATEGORIES[subject.incident.category].en}. ` +
        `${subject.incident.confirmations} resident report(s), severity ${subject.incident.severity}/5. ` +
        `Reports: ${subject.incident.reports.slice(0, 5).map((r) => r.english).join(' | ')}`;

  if (isMock()) {
    const place = subject.kind === 'area' ? subject.area.name : subject.incident.place || 'Alappuzha';
    return {
      ml: `${place}: ജാഗ്രത പാലിക്കുക. വെള്ളം ഉയരാൻ സാധ്യതയുണ്ട്. അടിയന്തര സാഹചര്യത്തിൽ 112-ൽ വിളിക്കുക.`,
      hi: `${place}: सावधान रहें। पानी बढ़ सकता है। आपात स्थिति में 112 पर कॉल करें।`,
      en: `${place}: Stay alert. Water levels may rise. In an emergency call 112.`,
    };
  }

  // 1) The LLM writes the alert once, in English, from verified facts only.
  const en = (await sarvam.chat(
    [
      {
        role: 'system',
        content: `You write short public safety alerts for residents of Alappuzha, Kerala, to be read aloud on their phones.
Write 2-3 short, calm, clear English sentences: what is happening, where, and one or two concrete actions (e.g. move
valuables and elderly people to higher ground, avoid the canal, do not cross flooded roads). Use ONLY the facts given.
Do not invent shelters, times, water levels or phone numbers; the only number you may mention is 112 (national
emergency). No numeric risk scores. Refer to future days ONLY by their full date, e.g. "on Wednesday, 25 November";
never use relative words like "today", "tomorrow", "later" or "in 4 days" (they get mistranslated). Do not quote
rainfall decimals. Reply with the alert text only: no quotes, labels or markdown.`,
      },
      { role: 'user', content: `${facts}${note ? `\nOfficial's note: ${note}` : ''}` },
    ],
    { maxTokens: 300, temperature: 0.2 },
  )).replace(/^["']|["']$/g, '').trim();
  if (!en) throw Object.assign(new Error('Could not draft the alert, please try again.'), { status: 502 });

  // 2) Sarvam Translate produces Malayalam + Hindi with identical meaning; scripts are verified.
  const [mlR, hiR] = await Promise.all([checkedTranslate(en, 'ml-IN'), checkedTranslate(en, 'hi-IN')]);
  const problems = scriptProblems({ ml: mlR.text, hi: hiR.text });
  if (problems.length) throw Object.assign(new Error(`Translation check failed (${problems.join(', ')}), please try again.`), { status: 502 });
  return { ml: mlR.text, hi: hiR.text, en, warnings: [mlR.warning, hiR.warning].filter(Boolean) };
}

// Words that change WHEN something happens. If a translation adds one the English does not have, it is wrong.
const TIMING = {
  'ml-IN': { label: 'Malayalam', words: /(ഇന്ന്|ഇന്നു|നാളെ|ഇന്നലെ)/ },
  'hi-IN': { label: 'Hindi', words: /(आज|कल)(?=[\s,।.]|$)/ },
};
export function timingProblem(en, text, lang) {
  const t = TIMING[lang];
  if (!t || /\b(today|tonight|tomorrow|yesterday)\b/i.test(en)) return null;
  return t.words.test(text) ? `${t.label} version mentions today/tomorrow but the English does not: please check the date wording` : null;
}

/** Translate with mayura:v1; if the timing check fails, retry with sarvam-translate:v1; otherwise warn the official. */
async function checkedTranslate(en, lang) {
  const guard = protectPlaces(en);
  const once = async (model) => {
    const raw = await sarvam.translate(guard.text, lang, 'en-IN', model);
    if (guard.intact(raw)) return guard.restore(raw, lang);
    // Placeholders lost: fall back to pre-substituted native spellings.
    return sarvam.translate(nativePlaceNames(en, lang), lang, 'en-IN', model);
  };
  const text = await once('mayura:v1');
  if (!timingProblem(en, text, lang)) return { text, warning: null };
  const alt = await once('sarvam-translate:v1').catch(() => '');
  if (alt && !timingProblem(en, alt, lang)) return { text: alt, warning: null };
  return { text, warning: timingProblem(en, text, lang) };
}

/** Each alert language must actually be in its own script (catches a model answering in the wrong language). */
export function scriptProblems({ ml, hi }) {
  const out = [];
  if (ml && !/[ഀ-ൿ]/.test(ml)) out.push('Malayalam text is not in Malayalam script');
  if (hi && !/[ऀ-ॿ]/.test(hi)) out.push('Hindi text is not in Devanagari script');
  if (hi && /[ഀ-ൿ]/.test(hi)) out.push('Hindi text contains Malayalam');
  return out;
}

/** Text-to-speech for each language of an approved alert. Returns { ml: base64|null, ... } */
export async function voiceAlert(text) {
  if (isMock()) return { ml: null, hi: null, en: null };
  const out = {};
  await Promise.all(
    Object.entries(ALERT_LANGS).map(async ([k, code]) => {
      out[k] = text[k] ? await speak(text[k], code) : null;
    }),
  );
  return out;
}

// ---------- Situation brief ----------
export async function situationBrief({ incidents, risk, alerts }) {
  const open = incidents.filter((i) => i.status !== 'resolved');
  if (isMock()) {
    const top = risk?.areas?.[0];
    return {
      en: `Situation: ${open.length} open incidents. Highest flood risk: ${top?.name} (${top?.levelEn}). Priority: inspect ${top?.name} and clear blocked canals.`,
      ml: `${open.length} പ്രശ്നങ്ങൾ തുറന്നിരിക്കുന്നു. ഏറ്റവും കൂടുതൽ വെള്ളപ്പൊക്ക സാധ്യത ${top?.ml || top?.name} ഭാഗത്ത്.`,
      audio: null,
    };
  }
  const raw = await sarvam.chat(
    [
      {
        role: 'system',
        content: `You prepare a situation brief for the Alappuzha district / panchayat disaster team.
Use ONLY the data given. Return ONLY JSON: {"en": "...", "ml": "..."}
"en": an English brief in plain text with these lines, each starting with the label:
  "Overall:" one sentence.
  "Top flood risks:" up to 3 areas with the main reason for each.
  "Incidents needing action:" up to 4, most urgent first, with how many residents reported each.
  "Recommended actions:" 3 short, concrete actions for officials.
"ml": a 3-4 sentence Malayalam spoken summary for ward members (no numbers except counts).`,
      },
      {
        role: 'user',
        content: `Open incidents:\n${incidentLines(open, 25) || '(none)'}\n\nFlood risk:\n${riskLines(risk) || '(unavailable)'}\n\nAlerts sent:\n${alertLines(alerts) || '(none)'}`,
      },
    ],
    { maxTokens: 1200, temperature: 0.2 },
  );
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  let j = null;
  try { j = JSON.parse(raw.slice(s, e + 1)); } catch { j = null; }
  if (!j?.en) throw Object.assign(new Error('Could not prepare the brief, please try again.'), { status: 502 });
  let ml = String(j.ml || '');
  // Same script check as alerts: if the summary is not actually Malayalam, translate the English overall line instead.
  if (!/[ഀ-ൿ]/.test(ml)) {
    const overall = String(j.en).split('\n').find((l) => l.startsWith('Overall:'))?.replace('Overall:', '').trim() || String(j.en).slice(0, 400);
    ml = await sarvam.translate(overall, 'ml-IN').catch(() => '');
  }
  return { en: String(j.en), ml, audio: ml ? await speak(ml, 'ml-IN') : null };
}
