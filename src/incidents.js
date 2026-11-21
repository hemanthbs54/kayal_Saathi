// Groups duplicate reports into incidents: same category, within 600 m of the incident's
// centroid, and within 72 h of its latest report. Deterministic and recomputed on every read,
// so there is no separate state that can drift out of sync with the reports.
import { distanceKm } from './places.js';

export const CLUSTER_RADIUS_KM = 0.6;
export const CLUSTER_WINDOW_H = 72;

function statusOf(reports) {
  if (reports.every((r) => r.status === 'resolved')) return 'resolved';
  if (reports.some((r) => r.status === 'open')) return 'open';
  return 'in_progress';
}

export function clusterReports(reports) {
  const sorted = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const clusters = [];
  for (const r of sorted) {
    const t = new Date(r.createdAt).getTime();
    let best = null;
    for (const c of clusters) {
      if (c.category !== r.category) continue;
      if (t - c.lastT > CLUSTER_WINDOW_H * 36e5) continue;
      const d = distanceKm(c.lat, c.lng, r.lat, r.lng);
      if (d <= CLUSTER_RADIUS_KM && (!best || d < best.d)) best = { c, d };
    }
    if (best) {
      const c = best.c;
      c.reports.push(r);
      const n = c.reports.length;
      c.lat += (r.lat - c.lat) / n;
      c.lng += (r.lng - c.lng) / n;
      c.lastT = Math.max(c.lastT, t);
    } else {
      clusters.push({ category: r.category, lat: r.lat, lng: r.lng, lastT: t, reports: [r] });
    }
  }

  return clusters
    .map((c) => {
      const rs = [...c.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = rs[0];
      const first = rs[rs.length - 1];
      const langs = [...new Set(rs.map((r) => r.lang).filter(Boolean))];
      const withPhoto = rs.filter((r) => r.photo).length;
      return {
        id: first.id, // stable: the first report's id
        category: c.category,
        lat: c.lat,
        lng: c.lng,
        place: rs.find((r) => r.place)?.place || '',
        title: latest.title,
        severity: Math.max(...rs.map((r) => r.severity)),
        status: statusOf(rs),
        confirmations: rs.length,
        verified: rs.length >= 2 || withPhoto > 0,
        photos: withPhoto,
        langs,
        firstAt: first.createdAt,
        lastAt: latest.createdAt,
        sample: rs.every((r) => r.source === 'sample'),
        reports: rs,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function incidentForReport(incidents, reportId) {
  return incidents.find((i) => i.reports.some((r) => r.id === reportId)) || null;
}
