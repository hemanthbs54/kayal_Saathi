// Tests for: flood-risk engine, incident clustering, alerts (draft/broadcast/targeting),
// situation brief, authority passcode, offline capture time, and grounded Q&A. MOCK mode: no credits.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MOCK = '1';
process.env.ADMIN_PASSCODE = 'test-pass';
const { createApp } = await import('../src/app.js');
const { scoreArea, computeRisk, levelFor } = await import('../src/risk.js');
const { clusterReports } = await import('../src/incidents.js');
const { RISK_AREAS } = await import('../src/places.js');

const H = 36e5;
const NOW = Date.parse('2026-11-21T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const area = (name) => RISK_AREAS.find((a) => a.name === name);
const rep = (o) => ({ id: o.id, createdAt: iso(o.ago ?? 0), lat: o.lat, lng: o.lng, category: o.category ?? 'flood', severity: o.severity ?? 4, status: o.status ?? 'open', title: o.id, english: o.id, lang: 'ml-IN', ...o });

describe('flood-risk engine', () => {
  const kain = area('Kainakary');
  const town = area('Alappuzha Town');
  const dry = { days: [0, 1, 2].map((d) => ({ date: `2026-11-2${1 + d}`, rain: 0, prob: 0 })), river: { past: [5, 5, 5], next: [5, 5, 5], dates: ['2026-11-21', '2026-11-22', '2026-11-23'] } };

  test('dry weather, no reports: only the terrain base remains', () => {
    assert.equal(scoreArea(kain, dry, [], NOW).score, 10); // below sea level
    assert.equal(scoreArea(town, dry, [], NOW).score, 7); // low-lying
    assert.equal(scoreArea(kain, dry, [], NOW).level, 'low');
  });

  test('extreme rain + rising river + fresh severe reports saturate at 100', () => {
    const wet = { days: [60, 60, 60].map((r, d) => ({ date: `2026-11-2${1 + d}`, rain: r, prob: 100 })), river: { past: [4, 4], next: [10, 12, 12], dates: ['2026-11-21', '2026-11-22', '2026-11-23'] } };
    const reports = [1, 2, 3].map((i) => rep({ id: `r${i}`, lat: kain.lat, lng: kain.lng, severity: 5 }));
    const s = scoreArea(kain, wet, reports, NOW);
    assert.equal(s.score, 100);
    assert.equal(s.level, 'severe');
    assert.deepEqual(s.components, { rain: 35, river: 25, reports: 30, terrain: 10 });
    assert.equal(s.rain72, 180);
    assert.equal(s.riverRatio, 3);
    assert.equal(s.nearbyFloodReports, 3);
    assert.ok(s.reasons.some((r) => r.includes('180 mm rain')));
    assert.ok(s.reasons.some((r) => r.includes('3x')));
  });

  test('ignores resolved, far-away, non-flood and stale reports', () => {
    const reports = [
      rep({ id: 'resolved', lat: kain.lat, lng: kain.lng, status: 'resolved' }),
      rep({ id: 'far', lat: kain.lat + 0.1, lng: kain.lng }), // ~11 km
      rep({ id: 'waste', lat: kain.lat, lng: kain.lng, category: 'waste' }),
    ];
    assert.equal(scoreArea(kain, dry, reports, NOW).nearbyFloodReports, 0);
    const old = scoreArea(kain, dry, [rep({ id: 'old', lat: kain.lat, lng: kain.lng, ago: 7 * 24 * H, severity: 5 })], NOW);
    assert.equal(old.nearbyFloodReports, 1);
    assert.equal(old.components.reports, 0); // decayed to ~0 after a week
  });

  test('missing forecast still produces a score for every area', () => {
    const r = computeRisk({ at: 'x', source: 'unavailable', stale: true, areas: [] }, [], NOW);
    assert.equal(r.areas.length, RISK_AREAS.length);
    assert.ok(r.areas.every((a) => Number.isInteger(a.score) && a.score >= 0 && a.score <= 100));
    assert.match(r.disclaimer, /Not an official warning/);
  });

  test('level thresholds', () => {
    assert.equal(levelFor(0).id, 'low');
    assert.equal(levelFor(25).id, 'moderate');
    assert.equal(levelFor(45).id, 'high');
    assert.equal(levelFor(70).id, 'severe');
    assert.equal(levelFor(100).id, 'severe');
  });
});

describe('translation timing check', async () => {
  const { timingProblem } = await import('../src/ai.js');
  test('flags today/tomorrow added by a translation', () => {
    const en = 'Heavy rain is forecast on Wednesday, 25 November.';
    assert.ok(timingProblem(en, 'നാളെ, നവംബർ 25-ന് കനത്ത മഴ', 'ml-IN'));
    assert.equal(timingProblem(en, 'നവംബർ 25 ബുധനാഴ്ച കനത്ത മഴ', 'ml-IN'), null);
    assert.ok(timingProblem(en, 'कल भारी बारिश होगी', 'hi-IN'));
    assert.equal(timingProblem(en, 'बुधवार, 25 नवंबर को भारी बारिश', 'hi-IN'), null);
    assert.equal(timingProblem(en, 'कलेक्टर ने कहा', 'hi-IN'), null); // "कल" inside a longer word is fine
    assert.equal(timingProblem('Heavy rain tomorrow.', 'നാളെ കനത്ത മഴ', 'ml-IN'), null); // English says it too
  });
});

describe('place-name protection for translation', async () => {
  const { protectPlaces } = await import('../src/places.js');
  test('tokens replace places and restore native spellings', () => {
    const g = protectPlaces('Heavy rain in Kainakary and near Alappuzha Boat Jetty.');
    assert.equal(g.count, 2);
    assert.ok(!g.text.includes('Kainakary') && g.text.includes('{{P'));
    const fakeMl = g.text.replace('Heavy rain in', 'കനത്ത മഴ').replace('and near', 'കൂടാതെ');
    assert.ok(g.intact(fakeMl));
    const ml = g.restore(fakeMl, 'ml-IN');
    assert.ok(ml.includes('കൈനകരി') && ml.includes('ബോട്ട് ജെട്ടി'));
    assert.ok(g.restore(g.text, 'hi-IN').includes('कैनकरी'));
    assert.equal(g.intact('no tokens here'), false);
  });
});

describe('incident clustering', () => {
  const base = { lat: 9.488, lng: 76.398 };
  test('nearby same-category reports merge; others stay separate', () => {
    const inc = clusterReports([
      rep({ id: 'a', ...base, ago: 5 * H }),
      rep({ id: 'b', lat: base.lat + 0.002, lng: base.lng, ago: 2 * H, lang: 'hi-IN', severity: 5 }), // ~220 m
      rep({ id: 'c', ...base, category: 'waste' }), // different category
      rep({ id: 'd', lat: base.lat + 0.02, lng: base.lng }), // ~2.2 km
      rep({ id: 'e', ...base, ago: 100 * H }), // too old to join (window is 72 h)
    ]);
    const merged = inc.find((i) => i.reports.some((r) => r.id === 'a'));
    assert.equal(merged.confirmations, 2);
    assert.equal(merged.severity, 5);
    assert.equal(merged.verified, true);
    assert.deepEqual(merged.langs.sort(), ['hi-IN', 'ml-IN']);
    assert.equal(inc.length, 4);
  });

  test('status: open if any open, resolved only when all resolved', () => {
    const a = clusterReports([rep({ id: 'a', ...base, status: 'resolved' }), rep({ id: 'b', ...base, status: 'open' })]);
    assert.equal(a[0].status, 'open');
    const b = clusterReports([rep({ id: 'a', ...base, status: 'resolved' }), rep({ id: 'b', ...base, status: 'in_progress' })]);
    assert.equal(b[0].status, 'in_progress');
    const c = clusterReports([rep({ id: 'a', ...base, status: 'resolved' })]);
    assert.equal(c[0].status, 'resolved');
    assert.equal(c[0].verified, false); // single report, no photo
  });
});

describe('API', () => {
  let server, base, tmp;
  const admin = { 'Content-Type': 'application/json', 'x-admin-passcode': 'test-pass' };
  const json = (method, body, headers = admin) => ({ method, headers, body: JSON.stringify(body) });

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kayal-f-'));
    const app = createApp({ dataDir: path.join(tmp, 'data'), uploadsDir: path.join(tmp, 'uploads'), publicDir: path.resolve('public') });
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('authority passcode protects admin actions', async () => {
    assert.equal((await fetch(`${base}/api/admin/check`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/check`, { headers: { 'x-admin-passcode': 'wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/check`, { headers: admin })).status, 200);
    const [r] = await (await fetch(`${base}/api/reports`)).json();
    assert.equal((await fetch(`${base}/api/reports/${r.id}`, json('PATCH', { status: 'resolved' }, { 'Content-Type': 'application/json' }))).status, 401);
    assert.equal((await fetch(`${base}/api/alerts/draft`, json('POST', { kind: 'area', name: 'Kainakary' }, { 'Content-Type': 'application/json' }))).status, 401);
    assert.equal((await fetch(`${base}/api/brief`, { method: 'POST' })).status, 401);
    const h = await (await fetch(`${base}/api/health`)).json();
    assert.equal(h.adminProtected, true);
  });

  test('production without a passcode fails closed', async () => {
    const saved = { p: process.env.ADMIN_PASSCODE, e: process.env.NODE_ENV };
    delete process.env.ADMIN_PASSCODE;
    process.env.NODE_ENV = 'production';
    try {
      const r = await fetch(`${base}/api/admin/check`);
      assert.equal(r.status, 503);
      assert.equal((await (await fetch(`${base}/api/health`)).json()).adminProtected, true);
    } finally {
      process.env.ADMIN_PASSCODE = saved.p;
      if (saved.e === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.e;
    }
  });

  test('risk endpoint covers every area, sorted, Kainakary elevated by seeded flood reports', async () => {
    const r = await (await fetch(`${base}/api/risk`)).json();
    assert.equal(r.areas.length, RISK_AREAS.length);
    for (let i = 1; i < r.areas.length; i++) assert.ok(r.areas[i - 1].score >= r.areas[i].score);
    const k = r.areas.find((a) => a.name === 'Kainakary');
    assert.ok(k.nearbyFloodReports >= 3);
    assert.ok(['high', 'severe'].includes(k.level), `Kainakary level ${k.level}`);
    assert.equal(k.days.length, 7);
    assert.ok(k.days.every((d) => typeof d.rain === 'number'));
  });

  test('seeded duplicates appear as one incident with confirmations', async () => {
    const inc = await (await fetch(`${base}/api/incidents`)).json();
    const k = inc.find((i) => i.category === 'flood' && i.place === 'Kainakary');
    assert.equal(k.confirmations, 3); // seed: 2 Malayalam + 1 Hindi report at Kainakary
    assert.ok(k.langs.includes('hi-IN'));
  });

  test('a new report joins the nearby incident and tells the resident', async () => {
    const fd = new FormData();
    fd.append('text', 'കൈനകരിയിൽ വെള്ളം വീടുകളിലേക്ക് കയറി');
    const r = await (await fetch(`${base}/api/reports`, { method: 'POST', body: fd })).json();
    assert.equal(r.incident.confirmations, 4);
    // resolving the incident resolves every report in it
    const after = await (await fetch(`${base}/api/incidents/${r.incident.id}`, json('PATCH', { status: 'in_progress' }))).json();
    assert.equal(after.status, 'in_progress');
    assert.ok(after.reports.every((x) => x.status === 'in_progress'));
    assert.equal((await fetch(`${base}/api/incidents/nope`, json('PATCH', { status: 'open' }))).status, 404);
    assert.equal((await fetch(`${base}/api/incidents/${r.incident.id}`, json('PATCH', { status: 'bad' }))).status, 400);
  });

  test('offline-captured time is kept when plausible, ignored when not', async () => {
    const past = new Date(Date.now() - 2 * H).toISOString();
    let fd = new FormData();
    fd.append('text', 'plastic waste at Punnamada');
    fd.append('capturedAt', past);
    let r = await (await fetch(`${base}/api/reports`, { method: 'POST', body: fd })).json();
    assert.equal(r.createdAt, past);
    assert.equal(r.queuedOffline, true);
    fd = new FormData();
    fd.append('text', 'plastic waste at Punnamada');
    fd.append('capturedAt', new Date(Date.now() + 864e5).toISOString());
    r = await (await fetch(`${base}/api/reports`, { method: 'POST', body: fd })).json();
    assert.ok(Math.abs(Date.parse(r.createdAt) - Date.now()) < 60e3);
    assert.equal(r.queuedOffline, undefined);
  });

  test('alert: draft -> broadcast -> only residents in range receive it', async () => {
    const d = await (await fetch(`${base}/api/alerts/draft`, json('POST', { kind: 'area', name: 'Kainakary' }))).json();
    assert.ok(d.text.ml && d.text.hi && d.text.en);
    assert.equal(d.subject.place, 'Kainakary');

    const a = await (await fetch(`${base}/api/alerts`, json('POST', { kind: 'area', name: 'Kainakary', text: d.text, radiusKm: 3 }))).json();
    assert.equal(a.radiusKm, 3);
    assert.equal(a.text.en, d.text.en);

    const near = await (await fetch(`${base}/api/alerts?lat=9.49&lng=76.40`)).json();
    assert.ok(near.some((x) => x.id === a.id));
    const far = await (await fetch(`${base}/api/alerts?lat=9.315&lng=76.385`)).json(); // Thottappally, ~20 km
    assert.ok(!far.some((x) => x.id === a.id));

    const dist = await (await fetch(`${base}/api/alerts`, json('POST', { kind: 'area', name: 'Alappuzha Town', text: d.text, radiusKm: null }))).json();
    assert.equal(dist.radiusKm, null);
    const anywhere = await (await fetch(`${base}/api/alerts?lat=9.315&lng=76.385`)).json();
    assert.ok(anywhere.some((x) => x.id === dist.id));
  });

  test('broadcast refuses text in the wrong script', async () => {
    const res = await fetch(`${base}/api/alerts`, json('POST', {
      kind: 'area', name: 'Kainakary', radiusKm: 3,
      text: { ml: 'കൈനകരിയിൽ ജാഗ്രത', hi: 'കൈനകരിയിൽ ജാഗ്രത', en: 'Stay alert in Kainakary' },
    }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Hindi/);
  });

  test('alert validation', async () => {
    assert.equal((await fetch(`${base}/api/alerts/draft`, json('POST', { kind: 'area', name: 'Atlantis' }))).status, 400);
    assert.equal((await fetch(`${base}/api/alerts`, json('POST', { kind: 'area', name: 'Kainakary', text: { ml: '', en: '' } }))).status, 400);
    const [inc] = await (await fetch(`${base}/api/incidents`)).json();
    const d = await (await fetch(`${base}/api/alerts/draft`, json('POST', { kind: 'incident', id: inc.id }))).json();
    assert.ok(d.text.en);
  });

  test('situation brief', async () => {
    const b = await (await fetch(`${base}/api/brief`, { method: 'POST', headers: admin })).json();
    assert.match(b.en, /open incidents/);
    assert.ok(b.ml.length > 0);
  });

  test('ask uses incidents and risk', async () => {
    const fd = new FormData();
    fd.append('text', 'Will Kainakary flood?');
    const a = await (await fetch(`${base}/api/ask`, { method: 'POST', body: fd })).json();
    assert.ok(a.answer.includes('വെള്ളപ്പൊക്ക സാധ്യത'));
  });
});
