// Offline report queue (IndexedDB). Backwater areas have patchy signal: a report made on a boat
// is stored on the phone (audio + photo blobs included) and sent automatically when back online.
const DB = 'kayal-saathi';
const STORE = 'queue';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export const queueReport = (item) => tx('readwrite', (s) => s.add(item));
export const queuedCount = () => tx('readonly', (s) => s.count());
const all = () => tx('readonly', (s) => s.getAll());
const remove = (id) => tx('readwrite', (s) => s.delete(id));

let flushing = false;

/** Sends queued reports oldest first. Returns how many were delivered. */
export async function flushQueue() {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of await all()) {
      const fd = new FormData();
      if (item.audio) fd.append('audio', item.audio, 'report.webm');
      else fd.append('text', item.text || '');
      if (item.photo) fd.append('photo', item.photo, 'photo.jpg');
      if (item.lat != null) { fd.append('lat', item.lat); fd.append('lng', item.lng); }
      fd.append('capturedAt', item.capturedAt);
      let res;
      try {
        res = await fetch('/api/reports', { method: 'POST', body: fd });
      } catch {
        break; // still offline
      }
      if (res.ok) {
        sent++;
        await remove(item.id);
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        await remove(item.id); // unusable (e.g. silent audio): retrying will never succeed
      } else {
        break; // server busy: try again later
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
