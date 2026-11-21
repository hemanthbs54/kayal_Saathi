// Tiny JSON-file store with two collections (reports, alerts). Good enough for a hackathon
// demo on a single instance; swap for Postgres/Supabase in production.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { seedReports } from './seed.js';

function collection(file, initial = () => []) {
  let items = [];
  if (fs.existsSync(file)) {
    try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { items = []; }
  }
  if (!items.length) items = initial();
  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
    fs.renameSync(tmp, file);
  };
  save();
  return {
    list() {
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get(id) {
      return items.find((r) => r.id === id) || null;
    },
    add(data) {
      const r = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
      items.push(r);
      save();
      return r;
    },
    update(id, patch) {
      const r = items.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch, { updatedAt: new Date().toISOString() });
      save();
      return r;
    },
    updateMany(ids, patch) {
      const set = new Set(ids);
      const now = new Date().toISOString();
      const changed = items.filter((x) => set.has(x.id));
      changed.forEach((x) => Object.assign(x, patch, { updatedAt: now }));
      if (changed.length) save();
      return changed;
    },
  };
}

export function createStore(dataDir, { seed = true } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const reports = collection(path.join(dataDir, 'reports.json'), () => (seed ? seedReports() : []));
  const alerts = collection(path.join(dataDir, 'alerts.json'));
  return {
    // reports (kept at top level for backwards compatibility)
    list: () => reports.list(),
    get: (id) => reports.get(id),
    add: (data) => reports.add({ status: 'open', ...data }),
    update: (id, patch) => reports.update(id, patch),
    updateMany: (ids, patch) => reports.updateMany(ids, patch),
    alerts,
  };
}
