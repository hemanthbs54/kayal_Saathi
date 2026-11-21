import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { createStore } from './store.js';
import { transcribe, triage, answer, draftAlert, voiceAlert, situationBrief, detectScript, scriptProblems, isMock, CATEGORIES } from './ai.js';
import { matchPlace, ALAPPUZHA_CENTER, distanceKm } from './places.js';
import { clusterReports, incidentForReport } from './incidents.js';
import { getForecast } from './weather.js';
import { computeRisk } from './risk.js';
import { usage } from './sarvam.js';

const STATUSES = ['open', 'in_progress', 'resolved'];
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ALERT_TTL_H = 24;
const BRIEF_TTL_MS = 10 * 60 * 1000;

/** Simple per-IP limiter so a public demo can't burn through the Sarvam credits. */
function rateLimit({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests, please wait a few minutes.' });
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  };
}

/** Authority actions (status changes, alerts, briefs) need ADMIN_PASSCODE when it is set. */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    // Fail closed on a public deployment: nobody can broadcast alerts until a passcode is configured.
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Authority actions are disabled until ADMIN_PASSCODE is set on the server.' });
    return next();
  }
  const given = String(req.get('x-admin-passcode') || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'Authority passcode required.' });
}

function num(v) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Offline-queued reports carry the time they were captured; accept it only if plausible. */
function capturedTime(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  if (t > now + 5 * 60e3 || t < now - 7 * 864e5) return null;
  return new Date(t).toISOString();
}

export function createApp({ dataDir, uploadsDir, publicDir, seed = true, aiRateLimit = 30 } = {}) {
  const store = createStore(dataDir, { seed });
  fs.mkdirSync(path.join(uploadsDir, 'alerts'), { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2 } });
  const aiLimit = rateLimit({ max: aiRateLimit, windowMs: 10 * 60 * 1000 });
  const adminLimit = rateLimit({ max: 60, windowMs: 10 * 60 * 1000 });

  const incidents = () => clusterReports(store.list());
  const risk = async () => computeRisk(await getForecast(), store.list());
  const activeAlerts = () => store.alerts.list().filter((a) => Date.now() - new Date(a.createdAt).getTime() < ALERT_TTL_H * 36e5);

  // ---------- meta ----------
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, mock: isMock(), adminProtected: Boolean(process.env.ADMIN_PASSCODE) || process.env.NODE_ENV === 'production', usage });
  });
  app.get('/api/categories', (req, res) => res.json(CATEGORIES));
  app.get('/api/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

  // ---------- reports ----------
  app.get('/api/reports', (req, res) => res.json(store.list()));

  app.get('/api/reports/:id', (req, res) => {
    const r = store.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  });

  app.patch('/api/reports/:id', requireAdmin, (req, res) => {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    const r = store.update(req.params.id, { status });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  });

  /**
   * Create a report from voice (audio) or typed text, plus optional photo and GPS.
   * multipart fields: audio (file), photo (file), text, lat, lng, capturedAt (ISO, for offline-queued reports)
   */
  app.post(
    '/api/reports',
    aiLimit,
    upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'photo', maxCount: 1 }]),
    async (req, res) => {
      const audio = req.files?.audio?.[0];
      const photo = req.files?.photo?.[0];
      const typed = String(req.body?.text || '').trim().slice(0, 2000);

      let transcript = typed;
      let lang = typed ? detectScript(typed) : null;
      let source = 'text';
      if (audio) {
        const stt = await transcribe(audio.buffer, audio.mimetype);
        transcript = stt.transcript;
        lang = stt.languageCode || 'unknown';
        source = 'voice';
      }
      if (!transcript) {
        return res.status(400).json({ error: 'Could not hear anything. Please speak again or type your report.' });
      }

      const t = await triage(transcript, lang);

      // Location: device GPS first, else a known place mentioned in the report, else city centre.
      let lat = num(req.body?.lat);
      let lng = num(req.body?.lng);
      let locationSource = 'gps';
      const known = matchPlace(t.place) || matchPlace(transcript) || matchPlace(t.english);
      const gpsValid = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      // If the reporter names a known place far (>3 km) from where they stand, trust the named place.
      if (gpsValid && known && distanceKm(lat, lng, known.lat, known.lng) > 3) {
        ({ lat, lng } = known);
        locationSource = 'place';
      } else if (!gpsValid) {
        if (known) {
          ({ lat, lng } = known);
          locationSource = 'place';
        } else {
          lat = ALAPPUZHA_CENTER.lat + (Math.random() - 0.5) * 0.01;
          lng = ALAPPUZHA_CENTER.lng + (Math.random() - 0.5) * 0.01;
          locationSource = 'approx';
        }
      }

      const captured = capturedTime(req.body?.capturedAt);
      const report = store.add({
        ...(captured ? { createdAt: captured, queuedOffline: true } : {}),
        lat, lng, locationSource,
        place: known?.name || t.place || '',
        lang, transcript, source,
        english: t.english, title: t.title, category: t.category, severity: t.severity,
        photo: null,
      });

      if (photo && IMAGE_EXT[photo.mimetype]) {
        const name = `${report.id}.${IMAGE_EXT[photo.mimetype]}`;
        fs.writeFileSync(path.join(uploadsDir, name), photo.buffer);
        store.update(report.id, { photo: `/uploads/${name}` });
      }
      const inc = incidentForReport(incidents(), report.id);
      res.status(201).json({
        ...store.get(report.id),
        incident: inc ? { id: inc.id, confirmations: inc.confirmations, title: inc.title } : null,
      });
    },
  );

  // ---------- incidents ----------
  app.get('/api/incidents', (req, res) => res.json(incidents()));

  app.patch('/api/incidents/:id', requireAdmin, (req, res) => {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    const inc = incidents().find((i) => i.id === req.params.id);
    if (!inc) return res.status(404).json({ error: 'Not found' });
    store.updateMany(inc.reports.map((r) => r.id), { status });
    res.json(incidents().find((i) => i.id === req.params.id) || null);
  });

  // ---------- flood risk ----------
  app.get('/api/risk', async (req, res) => res.json(await risk()));

  // ---------- alerts ----------
  async function resolveSubject(body) {
    if (body?.kind === 'area') {
      const r = await risk();
      const area = r.areas.find((a) => a.name === body.name);
      return area ? { kind: 'area', area, lat: area.lat, lng: area.lng, place: area.name, level: area.level } : null;
    }
    if (body?.kind === 'incident') {
      const incident = incidents().find((i) => i.id === body.id);
      return incident
        ? { kind: 'incident', incident, lat: incident.lat, lng: incident.lng, place: incident.place || incident.title, level: incident.severity >= 4 ? 'high' : 'moderate' }
        : null;
    }
    return null;
  }

  app.post('/api/alerts/draft', requireAdmin, adminLimit, async (req, res) => {
    const subject = await resolveSubject(req.body);
    if (!subject) return res.status(400).json({ error: 'Choose an area or incident to alert.' });
    const text = await draftAlert(subject, String(req.body?.note || '').slice(0, 300));
    res.json({ subject: { kind: subject.kind, place: subject.place, level: subject.level }, text });
  });

  app.post('/api/alerts', requireAdmin, adminLimit, async (req, res) => {
    const subject = await resolveSubject(req.body);
    if (!subject) return res.status(400).json({ error: 'Choose an area or incident to alert.' });
    const t = req.body?.text || {};
    const text = {
      ml: String(t.ml || '').trim().slice(0, 600),
      hi: String(t.hi || '').trim().slice(0, 600),
      en: String(t.en || '').trim().slice(0, 600),
    };
    if (!text.ml || !text.en) return res.status(400).json({ error: 'Malayalam and English text are required.' });
    const problems = scriptProblems(text);
    if (problems.length) return res.status(400).json({ error: `Please fix: ${problems.join('; ')}.` });
    const radius = req.body?.radiusKm === null ? null : num(req.body?.radiusKm);
    const radiusKm = radius === null ? null : Math.min(50, Math.max(0.5, radius ?? 3));

    const alert = store.alerts.add({ lat: subject.lat, lng: subject.lng, radiusKm, place: subject.place, level: subject.level, kind: subject.kind, text, audio: {} });
    const voices = await voiceAlert(text);
    const audio = {};
    for (const [k, b64] of Object.entries(voices)) {
      if (!b64) continue;
      const name = `${alert.id}-${k}.mp3`;
      fs.writeFileSync(path.join(uploadsDir, 'alerts', name), Buffer.from(b64, 'base64'));
      audio[k] = `/uploads/alerts/${name}`;
    }
    res.status(201).json(store.alerts.update(alert.id, { audio }));
  });

  /** Active alerts; with lat/lng only those whose radius covers the point (district-wide alerts always). */
  app.get('/api/alerts', (req, res) => {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    let list = activeAlerts();
    if (lat !== null && lng !== null) {
      list = list.filter((a) => a.radiusKm === null || distanceKm(lat, lng, a.lat, a.lng) <= a.radiusKm);
    }
    res.json(list);
  });

  // ---------- situation brief ----------
  let briefCache = null;
  app.post('/api/brief', requireAdmin, adminLimit, async (req, res) => {
    if (briefCache && Date.now() - briefCache.at < BRIEF_TTL_MS && !req.query.fresh) return res.json(briefCache.data);
    const data = { ...(await situationBrief({ incidents: incidents(), risk: await risk(), alerts: activeAlerts() })), at: new Date().toISOString() };
    briefCache = { at: Date.now(), data };
    res.json(data);
  });

  // ---------- ask ----------
  /** Ask a question by voice (audio) or text; answer is spoken back in the user's language. */
  app.post('/api/ask', aiLimit, upload.single('audio'), async (req, res) => {
    let question = String(req.body?.text || '').trim().slice(0, 1000);
    let lang = question ? detectScript(question) : null;
    if (req.file) {
      const stt = await transcribe(req.file.buffer, req.file.mimetype);
      question = stt.transcript;
      lang = stt.languageCode;
    }
    if (!question) return res.status(400).json({ error: 'Could not hear the question. Please try again.' });
    const a = await answer(question, lang, { incidents: incidents(), risk: await risk(), alerts: activeAlerts() });
    res.json({ question, questionLang: lang, answer: a.text, lang: a.lang, audio: a.audio });
  });

  app.use('/uploads', express.static(uploadsDir, { maxAge: '1h' }));
  if (publicDir) app.use(express.static(publicDir, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status === 402 ? 402 : err.status === 502 ? 502 : 500;
    const msg =
      status === 413 ? 'File too large.' :
      status === 402 ? 'AI credits exhausted.' :
      status === 502 ? err.message :
      'Something went wrong. Please try again.';
    res.status(status).json({ error: msg, detail: process.env.NODE_ENV === 'production' ? undefined : err.message });
  });

  return app;
}

