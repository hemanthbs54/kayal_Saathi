// Weather provider fallback: Open-Meteo rate-limited -> MET Norway; everything down -> graceful.
// Uses a stubbed fetch, so it runs offline and costs nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MOCK;
const realFetch = globalThis.fetch;
const { getForecast, _resetWeatherCache } = await import('../src/weather.js');
const { RISK_AREAS } = await import('../src/places.js');

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const istDay = (d) => new Date(Date.now() + d * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);

function metBody() {
  // 25 mm falling on day +4 (IST), as 6-hourly blocks
  const t = Date.parse(`${istDay(4)}T06:00:00+05:30`);
  return { properties: { timeseries: [0, 6].map((h) => ({ time: new Date(t + h * 36e5).toISOString(), data: { next_6_hours: { details: { precipitation_amount: 12.5 } } } })) } };
}
function floodBody() {
  const time = Array.from({ length: 14 }, (_, i) => istDay(i - 7));
  return RISK_AREAS.map(() => ({ daily: { time, river_discharge: time.map((_, i) => (i < 7 ? 5 : 10)) } }));
}

test('Open-Meteo 429 falls back to MET Norway rainfall, river still used', async () => {
  _resetWeatherCache();
  let metCalls = 0;
  globalThis.fetch = (url) => {
    const u = String(url);
    if (u.includes('api.open-meteo.com/v1/forecast')) return json({ reason: 'limit' }, 429);
    if (u.includes('flood-api.open-meteo.com')) return json(floodBody());
    if (u.includes('api.met.no')) { metCalls++; return json(metBody()); }
    return Promise.reject(new Error(`unexpected ${u}`));
  };
  try {
    const f = await getForecast();
    assert.match(f.source, /MET Norway/);
    assert.match(f.source, /GloFAS/);
    assert.equal(f.stale, false);
    assert.equal(metCalls, RISK_AREAS.length);
    const k = f.areas.find((a) => a.name === 'Kainakary');
    assert.equal(k.days.length, 7);
    assert.equal(k.days[4].rain, 25);
    assert.equal(k.river.next[0], 10);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('all providers down: no crash, empty areas, error reported, no hammering', async () => {
  _resetWeatherCache();
  let calls = 0;
  globalThis.fetch = () => { calls++; return Promise.reject(new Error('network down')); };
  try {
    const f = await getForecast();
    assert.equal(f.areas.length, 0);
    assert.equal(f.stale, true);
    assert.match(f.error, /network down/);
    const before = calls;
    await getForecast(); // within retry window: served from the failure cache
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = realFetch;
  }
});
