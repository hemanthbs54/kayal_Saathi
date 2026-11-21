import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createStore } from './store.js';
import { transcribe, triage, answer, detectScript, isMock, CATEGORIES } from './ai.js';
import { matchPlace, ALAPPUZHA_CENTER } from './places.js';
import { usage } from './sarvam.js';

const STATUSES = ['open', 'in_progress', 'resolved'];
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Simple per-IP limiter so a public demo can't burn through the Sarvam credits. */
function rateLimit({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'Too many requests, please wait a few minutes.' });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function num(v) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function createApp({ dataDir, uploadsDir, publicDir, seed = true, aiRateLimit = 30 } = {}) {
  const store = createStore(dataDir, { seed });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  });
  const aiLimit = rateLimit({ max: aiRateLimit, windowMs: 10 * 60 * 1000 });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, mock: isMock(), usage });
  });

  app.get('/api/categories', (req, res) => res.json(CATEGORIES));

  app.get('/api/reports', (req, res) => res.json(store.list()));

  app.get('/api/reports/:id', (req, res) => {
    const r = store.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  });

  app.patch('/api/reports/:id', (req, res) => {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    const r = store.update(req.params.id, { status });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  });

  /**
   * Create a report from voice (audio) or typed text, plus optional photo and GPS.
   * multipart fields: audio (file), photo (file), text, lat, lng
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

      const report = store.add({
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
      res.status(201).json(store.get(report.id));
    },
  );

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
    const a = await answer(question, lang, store.list());
    res.json({ question, questionLang: lang, answer: a.text, lang: a.lang, audio: a.audio });
  });

  app.use('/uploads', express.static(uploadsDir, { maxAge: '1h' }));
  if (publicDir) app.use(express.static(publicDir, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status === 402 ? 402 : 500;
    const msg =
      status === 413 ? 'File too large.' :
      status === 402 ? 'AI credits exhausted.' :
      'Something went wrong. Please try again.';
    res.status(status).json({ error: msg, detail: process.env.NODE_ENV === 'production' ? undefined : err.message });
  });

  return app;
}
