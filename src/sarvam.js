// Thin client for Sarvam AI REST APIs (docs: https://docs.sarvam.ai/api-reference-docs/introduction)
const BASE = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai';

export const usage = { stt: 0, chat: 0, chatTokens: 0, tts: 0, ttsChars: 0, errors: 0 };

export class SarvamError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function apiKey() {
  const k = process.env.SARVAM_API_KEY;
  if (!k) throw new SarvamError('SARVAM_API_KEY is not set', 500);
  return k;
}

async function call(path, init) {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(45_000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    usage.errors++;
    const msg = body?.error?.message || String(text).slice(0, 300);
    throw new SarvamError(`Sarvam ${path} ${res.status}: ${msg}`, res.status, body);
  }
  return body;
}

const EXT = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac',
};

/** Speech -> text with saaras:v4. languageCode 'unknown' = auto-detect (Malayalam, Hindi, Tamil, English...). */
export async function speechToText(buffer, mimetype, { languageCode = 'unknown', keyterms = [] } = {}) {
  const type = (mimetype || 'audio/webm').split(';')[0].trim();
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type }), `audio.${EXT[type] || 'webm'}`);
  fd.append('model', 'saaras:v4');
  fd.append('mode', 'transcribe');
  fd.append('language_code', languageCode);
  if (keyterms.length) fd.append('keyterms', JSON.stringify(keyterms.slice(0, 50)));
  const b = await call('/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey() },
    body: fd,
  });
  usage.stt++;
  return { transcript: (b.transcript || '').trim(), languageCode: b.language_code || null };
}

/** Chat completion with sarvam-105b. Returns assistant text. */
export async function chat(messages, { maxTokens = 700, temperature = 0.2 } = {}) {
  const payload = {
    model: process.env.SARVAM_CHAT_MODEL || 'sarvam-105b',
    messages,
    temperature,
    max_tokens: maxTokens,
    // Verified live: null disables thinking (fast, cheap). Omitting it makes the model reason by
    // default and burn the whole token budget, returning content: null. 'none' is rejected (400).
    reasoning_effort: null,
  };
  const headers = {
    'api-subscription-key': apiKey(),
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
  };
  const b = await call('/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(payload) });
  usage.chat++;
  usage.chatTokens += b.usage?.total_tokens || 0;
  const content = b.choices?.[0]?.message?.content || '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** Text -> speech with bulbul:v3. Returns base64 mp3 or null. */
export async function textToSpeech(text, languageCode = 'ml-IN') {
  const clipped = text.slice(0, 2500);
  const b = await call('/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: clipped,
      language_code: languageCode,
      model: process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
      speaker: process.env.SARVAM_TTS_SPEAKER || 'anand',
      output_audio_codec: 'mp3',
      speech_sample_rate: 22050,
      pace: 0.95,
    }),
  });
  usage.tts++;
  usage.ttsChars += clipped.length;
  return b.audios?.[0] || null;
}
