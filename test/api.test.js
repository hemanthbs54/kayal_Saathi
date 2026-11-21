// End-to-end API tests in MOCK mode (no Sarvam credits used). Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MOCK = '1';
const { createApp } = await import('../src/app.js');
const { heuristicTriage, detectScript, answerLanguage } = await import('../src/ai.js');
const { matchPlace } = await import('../src/places.js');

let server;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kayal-'));
  const app = createApp({ dataDir: path.join(tmp, 'data'), uploadsDir: path.join(tmp, 'uploads'), publicDir: path.resolve('public') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('health reports mock mode', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.ok, true);
  assert.equal(h.mock, true);
});

test('seed data is loaded, newest first', async () => {
  const list = await (await fetch(`${base}/api/reports`)).json();
  assert.ok(list.length >= 10);
  assert.ok(list[0].createdAt >= list[list.length - 1].createdAt);
});

test('typed Malayalam report is triaged and placed via gazetteer', async () => {
  const fd = new FormData();
  fd.append('text', 'കൈനകരിയിൽ വെള്ളം വീടുകളിലേക്ക് കയറി');
  const res = await fetch(`${base}/api/reports`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const r = await res.json();
  assert.equal(r.category, 'flood');
  assert.equal(r.lang, 'ml-IN');
  assert.equal(r.place, 'Kainakary');
  assert.equal(r.locationSource, 'place');
  assert.equal(r.status, 'open');
});

test('voice report with photo and GPS', async () => {
  const fd = new FormData();
  fd.append('audio', new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), 'a.webm');
  fd.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' }), 'p.jpg');
  fd.append('lat', '9.5');
  fd.append('lng', '76.35');
  const res = await fetch(`${base}/api/reports`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const r = await res.json();
  assert.equal(r.source, 'voice');
  assert.equal(r.locationSource, 'gps');
  assert.equal(r.lat, 9.5);
  assert.equal(r.category, 'waste');
  assert.match(r.photo, /^\/uploads\/.+\.jpg$/);
  const img = await fetch(base + r.photo);
  assert.equal(img.status, 200);
});

test('named place far from GPS wins over GPS', async () => {
  const fd = new FormData();
  fd.append('text', 'ചമ്പക്കുളം തോട്ടിൽ പോള നിറഞ്ഞു');
  fd.append('lat', '9.4981');
  fd.append('lng', '76.3388');
  const r = await (await fetch(`${base}/api/reports`, { method: 'POST', body: fd })).json();
  assert.equal(r.place, 'Champakulam');
  assert.equal(r.locationSource, 'place');
  assert.equal(r.lat, 9.411);
});

test('empty report is rejected', async () => {
  const res = await fetch(`${base}/api/reports`, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
});

test('status update and validation', async () => {
  const [first] = await (await fetch(`${base}/api/reports`)).json();
  const ok = await fetch(`${base}/api/reports/${first.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }),
  });
  assert.equal((await ok.json()).status, 'resolved');
  const bad = await fetch(`${base}/api/reports/${first.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'nope' }),
  });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${base}/api/reports/does-not-exist`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'open' }),
  });
  assert.equal(missing.status, 404);
});

test('ask returns an answer', async () => {
  const fd = new FormData();
  fd.append('text', 'Is there flooding near Kainakary?');
  const a = await (await fetch(`${base}/api/ask`, { method: 'POST', body: fd })).json();
  assert.ok(a.answer.length > 0);
  assert.equal(a.question, 'Is there flooding near Kainakary?');
});

test('static pages are served', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/dashboard`)).status, 200);
});

test('helpers', () => {
  assert.equal(detectScript('നമസ്കാരം'), 'ml-IN');
  assert.equal(detectScript('नमस्ते'), 'hi-IN');
  assert.equal(detectScript('hello'), 'en-IN');
  assert.equal(heuristicTriage('plastic waste near jetty').category, 'waste');
  assert.equal(heuristicTriage('ചമ്പക്കുളം തോട്ടിൽ പോള').category, 'blocked_canal');
  assert.equal(matchPlace('oil near Pathiramanal island jetty').name, 'Pathiramanal');
  assert.equal(answerLanguage('unknown'), 'ml-IN');
  assert.equal(answerLanguage('ur-IN'), 'en-IN');
});
