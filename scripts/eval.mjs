// Live accuracy check: speech -> text -> triage, and grounded voice Q&A.
// Each case is spoken with Sarvam TTS, transcribed back with Sarvam STT, then triaged,
// and compared with a known expected category / place / language.
// Q&A answers are translated back to English so non-Malayalam speakers can verify them.
// Uses real credits (~₹5). Run: npm run eval
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (!process.env.SARVAM_API_KEY) throw new Error('Set SARVAM_API_KEY in .env first');
delete process.env.MOCK;

const { textToSpeech, usage } = await import('../src/sarvam.js');
const { transcribe, triage, answer } = await import('../src/ai.js');
const { matchPlace } = await import('../src/places.js');
const { seedReports } = await import('../src/seed.js');

const CASES = [
  { lang: 'ml-IN', text: 'പുന്നമടയിൽ ഹൗസ്ബോട്ടുകൾ പ്ലാസ്റ്റിക് മാലിന്യം കായലിലേക്ക് തള്ളുന്നു', meaning: 'Houseboats at Punnamada are dumping plastic waste into the backwater', cat: ['waste', 'water_quality'], place: 'Punnamada' },
  { lang: 'ml-IN', text: 'ചമ്പക്കുളം തോട്ടിൽ പോള നിറഞ്ഞ് വള്ളങ്ങൾക്ക് പോകാൻ കഴിയുന്നില്ല', meaning: 'Champakulam canal is full of water hyacinth, boats cannot pass', cat: ['blocked_canal'], place: 'Champakulam' },
  { lang: 'ml-IN', text: 'കാവാലത്ത് വെള്ളം വീടുകളിലേക്ക് കയറി, കുട്ടികളെയും പ്രായമായവരെയും മാറ്റണം', meaning: 'In Kavalam water entered homes; children and elderly must be moved', cat: ['flood'], place: 'Kavalam', minSev: 4 },
  { lang: 'ml-IN', text: 'നെടുമുടിയിൽ മീനുകൾ ചത്തു പൊങ്ങുന്നു, വെള്ളത്തിന് ദുർഗന്ധം', meaning: 'Dead fish floating in Nedumudi, the water smells bad', cat: ['water_quality'], place: 'Nedumudi' },
  { lang: 'ml-IN', text: 'ആലപ്പുഴ ബീച്ചിൽ ആരോ മാലിന്യം കത്തിക്കുന്നു', meaning: 'Someone is burning garbage at Alappuzha beach', cat: ['waste'], place: 'Alappuzha Beach' },
  { lang: 'ml-IN', text: 'മങ്കൊമ്പ് റോഡിൽ മുട്ടോളം വെള്ളം, ബസ് ഓടുന്നില്ല', meaning: 'Knee-deep water on Mancombu road, buses are not running', cat: ['flood'], place: 'Mancombu' },
  { lang: 'ml-IN', text: 'രാമങ്കരിയിൽ കുടിവെള്ള പൈപ്പിൽ നിന്ന് കലങ്ങിയ വെള്ളമാണ് വരുന്നത്', meaning: 'Muddy water is coming from the drinking water pipe in Ramankary', cat: ['water_quality'], place: 'Ramankary' },
  { lang: 'hi-IN', text: 'पल्लाथुरुथी के पास नहर में बहुत सारा प्लास्टिक कचरा तैर रहा है', meaning: 'Lots of plastic waste floating in the canal near Pallathuruthy', cat: ['waste'], place: 'Pallathuruthy' },
  { lang: 'en-IN', text: 'The drain near Mannancherry junction is completely blocked and rainwater is flooding the road', meaning: '(English)', cat: ['blocked_canal', 'flood'], place: 'Mannancherry' },
  { lang: 'ta-IN', text: 'தோட்டப்பள்ளி அருகே கடல் நீர் வீடுகளுக்குள் புகுந்துள்ளது', meaning: 'Near Thottappally, sea water has entered houses', cat: ['flood'], place: 'Thottappally' },
];

const QUESTIONS = [
  { lang: 'ml-IN', text: 'കൈനകരിയിൽ വെള്ളപ്പൊക്കമുണ്ടോ?', meaning: 'Is there flooding in Kainakary?' },
  { lang: 'ml-IN', text: 'ചമ്പക്കുളത്തേക്ക് വള്ളത്തിൽ പോകാമോ?', meaning: 'Can I go to Champakulam by boat?' },
  { lang: 'ml-IN', text: 'കുമരകത്ത് എന്തെങ്കിലും പ്രശ്നമുണ്ടോ?', meaning: 'Is there any problem in Kumarakom? (nothing reported: should say so)' },
];

async function toEnglish(text) {
  const k = process.env.SARVAM_API_KEY;
  const r = await fetch('https://api.sarvam.ai/translate', {
    method: 'POST',
    headers: { 'api-subscription-key': k, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text.slice(0, 1000), source_language_code: 'auto', target_language_code: 'en-IN', model: 'mayura:v1' }),
  });
  const b = await r.json();
  return b.translated_text || `(translate failed: ${b.error?.message || r.status})`;
}

let pass = 0;
const rows = [];
console.log('\n=== 1. Voice report accuracy (TTS -> STT -> triage) ===\n');
for (const [i, c] of CASES.entries()) {
  const audio = Buffer.from(await textToSpeech(c.text, c.lang), 'base64');
  const stt = await transcribe(audio, 'audio/mpeg');
  const t = await triage(stt.transcript, stt.languageCode);
  const place = (matchPlace(t.place) || matchPlace(stt.transcript) || matchPlace(t.english))?.name || t.place || '-';
  const ok = {
    lang: stt.languageCode === c.lang,
    cat: c.cat.includes(t.category),
    place: place === c.place,
    sev: c.minSev ? t.severity >= c.minSev : true,
  };
  const all = Object.values(ok).every(Boolean);
  if (all) pass++;
  rows.push({ i: i + 1, lang: c.lang, ok: all, cat: t.category, place, sev: t.severity });
  console.log(`#${i + 1} ${all ? 'PASS' : 'FAIL'}  [${c.lang}]  expected meaning: ${c.meaning}`);
  console.log(`   heard     : ${stt.transcript}  (${stt.languageCode}${ok.lang ? '' : ' ✗'})`);
  console.log(`   english   : ${t.english}`);
  console.log(`   category  : ${t.category}${ok.cat ? '' : ' ✗'}   place: ${place}${ok.place ? '' : ' ✗'}   severity: ${t.severity}${ok.sev ? '' : ' ✗'}\n`);
}

console.log('=== 2. Voice Q&A (answers translated back to English for checking) ===\n');
const reports = seedReports();
for (const q of QUESTIONS) {
  const audio = Buffer.from(await textToSpeech(q.text, q.lang), 'base64');
  const stt = await transcribe(audio, 'audio/mpeg');
  const a = await answer(stt.transcript, stt.languageCode, reports);
  console.log(`Q: ${q.meaning}`);
  console.log(`   heard  : ${stt.transcript}`);
  console.log(`   answer : ${a.text}`);
  console.log(`   english: ${await toEnglish(a.text)}`);
  console.log(`   spoken : ${a.audio ? 'yes' : 'NO'}\n`);
}

console.log(`=== RESULT: ${pass}/${CASES.length} reports fully correct (language + category + place + severity) ===`);
console.log('Sarvam usage:', JSON.stringify(usage));
