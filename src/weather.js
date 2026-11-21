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

async function fetchLive() {
  const lat = RISK_AREAS.map((a) => a.lat).join(',');
  const lng = RISK_AREAS.map((a) => a.lng).join(',');
  const [rain, flood] = await Promise.allSettled([
    getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max&forecast_days=7&timezone=Asia%2FKolkata`),
    getJson(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&past_days=7&forecast_days=7`),
  ]);
  if (rain.status === 'rejected' && flood.status === 'rejected') throw new Error(`weather unavailable: ${rain.reason?.message}`);
  const rainArr = rain.status === 'fulfilled' ? [].concat(rain.value) : null;
  const floodArr = flood.status === 'fulfilled' ? [].concat(flood.value) : null;
  const today = isoDay(0);

  return RISK_AREAS.map((a, i) => {
    const r = rainArr?.[i]?.daily;
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
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const areas = await fetchLive();
    const data = { at: new Date().toISOString(), source: 'Open-Meteo forecast + GloFAS river discharge', stale: false, areas };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    console.warn('Forecast fetch failed:', e.message);
    if (cache) return { ...cache.data, stale: true, error: e.message };
    return { at: new Date().toISOString(), source: 'unavailable', stale: true, error: e.message, areas: [] };
  }
}

export function _resetWeatherCache() {
  cache = null;
}
