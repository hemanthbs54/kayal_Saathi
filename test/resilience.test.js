// Resilience: when Sarvam fails, residents' reports are still saved (keyword triage) and voice
// failures produce a clear "please type" message. Sarvam is stubbed, so this runs offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.MOCK;
process.env.WEATHER_MOCK = '1';
process.env.SARVAM_API_KEY = 'test-key-not-real';
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  if (String(url).startsWith('https://api.sarvam.ai')) {
    return Promise.resolve(new Response(JSON.stringify({ error: { message: 'service unavailable' } }), { status: 503 }));
  }
  return realFetch(url, opts);
};

const { createApp } = await import('../src/app.js');
let server;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kayal-r-'));
  const app = createApp({ dataDir: path.join(tmp, 'data'), uploadsDir: path.join(tmp, 'uploads') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('AI triage down: typed report is still saved with keyword triage', async () => {
  const fd = new FormData();
  fd.append('text', 'കൈനകരിയിൽ വെള്ളം വീടുകളിലേക്ക് കയറി');
  const res = await realFetch(`${base}/api/reports`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const r = await res.json();
  assert.equal(r.category, 'flood');
  assert.equal(r.place, 'Kainakary');
  assert.equal(r.english, r.transcript); // no translation available, original kept
});

test('speech-to-text down: clear message asking to type instead', async () => {
  const fd = new FormData();
  fd.append('audio', new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), 'a.webm');
  const res = await realFetch(`${base}/api/reports`, { method: 'POST', body: fd });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /type your report/);
});
