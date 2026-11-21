// Explainable flood-risk index (0-100) per area. Indicative only: it is NOT an official
// warning and should be read alongside IMD / KSDMA advisories.
//
//   rain     up to 35 pts  forecast rainfall over the next 72 h (150 mm+ = full)
//   river    up to 25 pts  peak forecast river discharge vs the past-7-day mean (2.5x+ = full)
//   reports  up to 30 pts  open flood reports within 3 km, weighted by severity and recency
//   terrain  multiplier + base: below-sea-level Kuttanad polders score highest
//
//   score = (rain + river + reports) * (0.75 + 0.25 * vuln) + 10 * vuln
import { RISK_AREAS, TERRAIN, distanceKm } from './places.js';

export const LEVELS = [
  { id: 'severe', min: 70, en: 'Severe', ml: 'അതിതീവ്രം' },
  { id: 'high', min: 45, en: 'High', ml: 'ഉയർന്നത്' },
  { id: 'moderate', min: 25, en: 'Moderate', ml: 'മിതമായത്' },
  { id: 'low', min: 0, en: 'Low', ml: 'കുറവ്' },
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round1 = (x) => Math.round(x * 10) / 10;

export function levelFor(score) {
  return LEVELS.find((l) => score >= l.min);
}

function fmtDay(iso) {
  // Full, unambiguous dates ("Wednesday, 25 November"): abbreviations and relative phrases get mistranslated.
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
}

export function scoreArea(area, wx, reports, now = Date.now()) {
  const vuln = TERRAIN[area.terrain].vuln;
  const reasons = [];

  // Rain: next 3 days (index 0 = today)
  const next3 = (wx?.days || []).slice(0, 3);
  const rain72 = round1(next3.reduce((s, d) => s + (d.rain || 0), 0));
  const peak = next3.reduce((m, d) => (!m || d.rain > m.rain ? d : m), null);
  const rainPts = clamp01(rain72 / 150) * 35;
  if (wx?.days?.length) {
    reasons.push(rain72 >= 1
      ? `${rain72} mm rain forecast in 72 h${peak && peak.rain >= 10 ? ` (peak ${round1(peak.rain)} mm on ${fmtDay(peak.date)})` : ''}`
      : 'No significant rain forecast in 72 h');
  }

  // Outlook (not scored, but surfaced): heavy rain later in the week
  const later = (wx?.days || []).slice(3).filter((d) => d.rain >= 20);
  const outlook = later.length
    ? `Heavy rain forecast further ahead: ${later.map((d) => {
      const days = Math.round((Date.parse(`${d.date}T00:00:00+05:30`) - Date.parse(`${(wx.days[0] || d).date}T00:00:00+05:30`)) / 864e5);
      return `${round1(d.rain)} mm on ${fmtDay(d.date)} (in ${days} days)`;
    }).join(', ')}`
    : null;
  if (outlook) reasons.push(outlook);

  // River: peak of next 3 days vs past mean
  let riverRatio = null;
  let riverPts = 0;
  if (wx?.river?.past?.length && wx.river.next?.length) {
    const base = wx.river.past.reduce((s, v) => s + v, 0) / wx.river.past.length;
    const peakQ = Math.max(...wx.river.next.slice(0, 3));
    riverRatio = base > 0 ? round1(peakQ / base) : null;
    if (riverRatio != null) {
      riverPts = clamp01((riverRatio - 1) / 1.5) * 25;
      reasons.push(riverRatio >= 1.15
        ? `River flow forecast to rise to ${riverRatio}x its 7-day average`
        : riverRatio <= 0.9 ? 'River flow falling' : 'River flow steady');
    }
  }

  // Community reports: open flood reports within 3 km, decaying over ~1 day
  const near = reports.filter(
    (r) => r.category === 'flood' && r.status !== 'resolved' && distanceKm(area.lat, area.lng, r.lat, r.lng) <= 3,
  );
  const weight = near.reduce((s, r) => {
    const ageH = Math.max(0, (now - new Date(r.createdAt).getTime()) / 36e5);
    return s + (r.severity / 5) * Math.exp(-ageH / 24);
  }, 0);
  const reportPts = clamp01(weight / 2) * 30;
  if (near.length) {
    const max = Math.max(...near.map((r) => r.severity));
    reasons.push(`${near.length} open flood report${near.length > 1 ? 's' : ''} within 3 km (max severity ${max}/5)`);
  }

  reasons.push(TERRAIN[area.terrain].en);

  const score = Math.round(Math.min(100, (rainPts + riverPts + reportPts) * (0.75 + 0.25 * vuln) + 10 * vuln));
  const level = levelFor(score);
  return {
    name: area.name,
    ml: area.ml,
    lat: area.lat,
    lng: area.lng,
    terrain: area.terrain,
    score,
    level: level.id,
    levelEn: level.en,
    levelMl: level.ml,
    components: { rain: Math.round(rainPts), river: Math.round(riverPts), reports: Math.round(reportPts), terrain: Math.round(10 * vuln) },
    rain72,
    outlook,
    riverRatio,
    nearbyFloodReports: near.length,
    reasons,
    days: (wx?.days || []).map((d) => {
      const j = wx?.river?.dates?.indexOf(d.date) ?? -1;
      return { ...d, discharge: j >= 0 ? round1(wx.river.next[j]) : null };
    }),
  };
}

export function computeRisk(forecast, reports, now = Date.now()) {
  const byName = new Map((forecast.areas || []).map((a) => [a.name, a]));
  const areas = RISK_AREAS.map((a) => scoreArea(a, byName.get(a.name), reports, now)).sort((x, y) => y.score - x.score);
  return {
    updatedAt: forecast.at,
    source: forecast.source,
    stale: forecast.stale,
    error: forecast.error,
    disclaimer: 'Indicative community risk index combining forecasts and resident reports. Not an official warning: always follow IMD and KSDMA advisories.',
    areas,
  };
}
