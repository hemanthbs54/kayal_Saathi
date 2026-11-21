// Report triage + question answering on top of Sarvam (with an offline mock mode for tests/demos).
import * as sarvam from './sarvam.js';
import { KEYTERMS } from './places.js';

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
Reports may be in Malayalam, Hindi, Tamil, English or mixed. Return ONLY a JSON object, no prose:
{"title": "<English title, max 8 words>",
 "english": "<faithful English translation of the report>",
 "category": "waste" | "flood" | "blocked_canal" | "water_quality" | "other",
 "severity": <integer 1-5; 5 = immediate danger to people or homes, 1 = minor nuisance>,
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
  ]);
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

// ---------- Q&A ----------
function ago(iso) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function answerLanguage(lang) {
  if (!lang || lang === 'unknown') return 'ml-IN';
  return TTS_LANGS.has(lang) ? lang : 'en-IN';
}

export async function answer(question, lang, reports) {
  const outLang = answerLanguage(lang);
  const context = reports
    .slice(0, 40)
    .map((r) => `- [${r.category}] ${r.title} @ ${r.place || 'unknown place'} (${ago(r.createdAt)}, severity ${r.severity}/5, status ${r.status})`)
    .join('\n');

  if (isMock()) {
    const open = reports.filter((r) => r.status !== 'resolved');
    const top = open.sort((a, b) => b.severity - a.severity)[0];
    const text = top
      ? `${top.place || 'ആലപ്പുഴ'} ഭാഗത്ത് ${CATEGORIES[top.category].ml} റിപ്പോർട്ട് ചെയ്തിട്ടുണ്ട്. ശ്രദ്ധിക്കുക.`
      : 'ഇപ്പോൾ റിപ്പോർട്ടുകളൊന്നുമില്ല.';
    return { text, lang: 'ml-IN', audio: null };
  }

  const text = await sarvam.chat(
    [
      {
        role: 'system',
        content: `You are Kayal Saathi, a friendly voice assistant for residents of Alappuzha, Kerala.
Answer the question using ONLY the community reports below. If nothing relevant is reported, say so and give one short safety tip.
Reply in ${LANG_NAMES[outLang]} using its native script. Max 3 short sentences. No markdown, no lists, no severity numbers or internal labels: it will be read aloud to a resident.

Community reports (newest first):
${context || '(none)'}`,
      },
      { role: 'user', content: question },
    ],
    { maxTokens: 400, temperature: 0.3 },
  );
  if (!text) {
    const sorry = {
      'ml-IN': 'ക്ഷമിക്കണം, ഇപ്പോൾ ഉത്തരം നൽകാൻ കഴിയുന്നില്ല. ദയവായി വീണ്ടും ശ്രമിക്കുക.',
      'hi-IN': 'माफ़ कीजिए, अभी जवाब नहीं दे पा रहे हैं। कृपया फिर से कोशिश करें।',
    };
    return { text: sorry[outLang] || 'Sorry, I could not answer right now. Please try again.', lang: outLang, audio: null };
  }
  let audio = null;
  try {
    audio = await sarvam.textToSpeech(text, outLang);
  } catch (e) {
    console.warn('TTS failed:', e.message);
  }
  return { text, lang: outLang, audio };
}
