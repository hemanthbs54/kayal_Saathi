// Live rainfall + river-discharge forecasts from Open-Meteo (free, no key).
//   Rain:  https://api.open-meteo.com/v1/forecast        (ECMWF/GFS blend, daily precipitation)
//   River: https://flood-api.open-meteo.com/v1/flood     (GloFAS v4 river discharge, m³/s)
// One request per source covers every risk area. Results are cached; on failure the last
// good data is reused, and if there is none the engine runs on community reports alone.
import { RISK_AREAS } from './places.js';

const TTL_MS = 30 * 60 * 1000;
let cache = null; // { at, data }

const isMock = () => process.env.MOCK === '1' || process.env.WEATHER_MOCK === '1';

function isoDay(offset) {
  const d = new Date(Date.now() + offset * 864e5 + 5.5 * 36e5); // IST date
  return d.toISOString().slice(0, 10);
}

/** Deterministic synthetic data for tests/offline demos: a heavy-rain event 3 days out. */
function mockData() {
  const rainPattern = [2, 1, 4, 18, 62, 35, 8]; // today .. +6
  return RISK_AREAS.map((a, i) => {
    const wet = a.terrain === 'below_sea_level' ? 1.2 : 0.8;
    return {
      name: a.name,
      days: rainPattern.map((r, d) => ({
        date: isoDay(d),
        rain: Math.round(r * wet * 10) / 10,
        prob: Math.min(100, 30 + r),
      })),
      river: {
        past: [6, 6.2, 6.1, 5.9, 6.0, 6.3, 6.4].map((v) => v + (i % 3)),
        next: [6.5, 7.2, 9.8, 14.5, 17.0, 15.2, 11.0].map((v) => v + (i % 3)),
        dates: Array.from({ length: 7 }, (_, d) => isoDay(d)),
      },
    };
  });
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

// MET Norway (api.met.no): independent second rainfall source. Used when Open-Meteo is unavailable,
// e.g. rate-limited (HTTP 429) on shared cloud egress IPs. Hourly/6-hourly amounts are summed per IST day.
const MET_UA = { 'User-Agent': 'kayal-saathi-hackathon-demo/1.0' };
async function metDays(lat, lng) {
  const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`, { headers: MET_UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`api.met.no ${res.status}`);
  const ts = (await res.json()).properties?.timeseries || [];
  const sums = {};
  for (const t of ts) {
    const p1 = t.data?.next_1_hours?.details?.precipitation_amount;
    const p6 = t.data?.next_6_hours?.details?.precipitation_amount;
    const day = new Date(Date.parse(t.time) + 5.5 * 36e5).toISOString().slice(0, 10);
    sums[day] = (sums[day] || 0) + (p1 ?? p6 ?? 0);
  }
  return Array.from({ length: 7 }, (_, d) => ({ date: isoDay(d), rain: Math.round((sums[isoDay(d)] || 0) * 10) / 10, prob: null }));
}

let openMeteoBlockedUntil = 0;

async function fetchLive() {
  const lat = RISK_AREAS.map((a) => a.lat).join(',');
  const lng = RISK_AREAS.map((a) => a.lng).join(',');
  const skipOM = Date.now() < openMeteoBlockedUntil;
  const [rain, flood] = await Promise.allSettled([
    skipOM ? Promise.reject(new Error('api.open-meteo.com rate-limited (skipping)')) : getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max&forecast_days=7&timezone=Asia%2FKolkata`),
    getJson(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&past_days=7&forecast_days=7`),
  ]);
  if (rain.status === 'rejected' && /429/.test(rain.reason?.message)) openMeteoBlockedUntil = Date.now() + 60 * 60 * 1000;

  let rainArr = rain.status === 'fulfilled' ? [].concat(rain.value).map((x) => x.daily) : null;
  let rainSource = 'Open-Meteo rainfall';
  if (!rainArr) {
    const met = await Promise.allSettled(RISK_AREAS.map((a) => metDays(a.lat, a.lng)));
    if (met.some((m) => m.status === 'fulfilled')) {
      rainArr = met.map((m) => (m.status === 'fulfilled'
        ? { time: m.value.map((d) => d.date), precipitation_sum: m.value.map((d) => d.rain), precipitation_probability_max: m.value.map(() => null) }
        : null));
      rainSource = 'MET Norway rainfall (Open-Meteo unavailable)';
    }
  }
  const floodArr = flood.status === 'fulfilled' ? [].concat(flood.value) : null;
  if (!rainArr && !floodArr) throw new Error(`weather unavailable: ${rain.reason?.message}; ${flood.reason?.message}`);
  const today = isoDay(0);
  lastSource = `${rainArr ? rainSource : 'rainfall unavailable'} + ${floodArr ? 'GloFAS river discharge' : 'river data unavailable'}`;

  return RISK_AREAS.map((a, i) => {
    const r = rainArr?.[i];
    const f = floodArr?.[i]?.daily;
    let river = null;
    if (f?.time) {
      const idx = f.time.findIndex((t) => t >= today);
      const cut = idx < 0 ? f.time.length : idx;
      river = {
        past: f.river_discharge.slice(0, cut).filter((v) => v != null),
        next: f.river_discharge.slice(cut).map((v) => v ?? 0),
        dates: f.time.slice(cut),
      };
    }
    return {
      name: a.name,
      days: r?.time
        ? r.time.map((date, d) => ({ date, rain: r.precipitation_sum[d] ?? 0, prob: r.precipitation_probability_max[d] ?? null }))
        : [],
      river,
    };
  });
}

/** Returns { at, source, stale, error?, areas: [{ name, days, river }] } */
export async function getForecast() {
  if (isMock()) return { at: new Date().toISOString(), source: 'synthetic (mock mode)', stale: false, areas: mockData() };
  return withRelayedRiver(await loadForecast());
}

// ---- River relay ----
// GloFAS (flood-api.open-meteo.com) also rate-limits shared cloud IPs. A signed-in official's browser
// can fetch it instead and relay it here (passcode-protected, validated, kept for 12 h).
const RELAY_TTL_MS = 12 * 60 * 60 * 1000;
let relay = null; // { at, byName: Map(name -> river) }

export function needsRiverRelay(forecast) {
  return !isMock() && !(forecast.areas || []).some((a) => a.river?.next?.length);
}

/** Validates and stores relayed river data. Returns the number of areas accepted. */
export function acceptRiverRelay(items) {
  if (!Array.isArray(items)) return 0;
  const names = new Set(RISK_AREAS.map((a) => a.name));
  const ok = (arr, max) => Array.isArray(arr) && arr.length <= max && arr.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6);
  const byName = new Map();
  for (const it of items) {
    if (!names.has(it?.name) || !ok(it.past, 14) || !ok(it.next, 14) || !it.next.length) continue;
    if (!Array.isArray(it.dates) || it.dates.length !== it.next.length || !it.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) continue;
    byName.set(it.name, { past: it.past, next: it.next, dates: it.dates });
  }
  if (byName.size) relay = { at: Date.now(), byName };
  return byName.size;
}

function withRelayedRiver(data) {
  if (!relay || Date.now() - relay.at > RELAY_TTL_MS || !needsRiverRelay(data)) return data;
  return {
    ...data,
    source: data.source.replace('river data unavailable', 'GloFAS river discharge (relayed by official dashboard)'),
    areas: data.areas.map((a) => ({ ...a, river: relay.byName.get(a.name) || a.river })),
  };
}

async function loadForecast() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (failure && Date.now() - failure.at < RETRY_MS) return failure.data; // don't hammer providers after a failure
  try {
    const areas = await fetchLive();
    const data = { at: new Date().toISOString(), source: lastSource, stale: false, areas };
    cache = { at: Date.now(), data };
    failure = null;
    return data;
  } catch (e) {
    console.warn('Forecast fetch failed:', e.message);
    const data = cache
      ? { ...cache.data, stale: true, error: e.message }
      : { at: new Date().toISOString(), source: 'unavailable', stale: true, error: e.message, areas: [] };
    failure = { at: Date.now(), data };
    return data;
  }
}

const RETRY_MS = 5 * 60 * 1000;
let failure = null;
let lastSource = '';

export function _resetWeatherCache() {
  cache = null;
  relay = null;
  failure = null;
  openMeteoBlockedUntil = 0;
}
