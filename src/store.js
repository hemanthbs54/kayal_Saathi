// Tiny JSON-file store. Good enough for a hackathon demo; swap for Postgres/Supabase later.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { seedReports } from './seed.js';

export function createStore(dataDir, { seed = true } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'reports.json');
  let reports = [];
  if (fs.existsSync(file)) {
    try { reports = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { reports = []; }
  }
  if (!reports.length && seed) reports = seedReports();

  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(reports, null, 2));
    fs.renameSync(tmp, file);
  };
  save();

  return {
    list() {
      return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get(id) {
      return reports.find((r) => r.id === id) || null;
    },
    add(data) {
      const r = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'open', ...data };
      reports.push(r);
      save();
      return r;
    },
    update(id, patch) {
      const r = reports.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch, { updatedAt: new Date().toISOString() });
      save();
      return r;
    },
  };
}
