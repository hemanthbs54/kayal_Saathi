/* global L */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const CATS = {
  waste: 'Waste dumping', flood: 'Flooding', blocked_canal: 'Blocked canal',
  water_quality: 'Water pollution', other: 'Other',
};
const STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
const LANG = { 'ml-IN': 'Malayalam', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil', 'en-IN': 'English', 'bn-IN': 'Bengali' };

const activeCats = new Set(Object.keys(CATS));
const activeStatus = new Set(['open', 'in_progress']);
let reports = [];
const known = new Set();
let firstLoad = true;
let lastSig = '';

const map = L.map('map', { zoomControl: true }).setView([9.47, 76.39], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
const markers = new Map();

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function chip(container, key, label, color, set) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.setAttribute('aria-pressed', String(set.has(key)));
  b.innerHTML = `${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}`;
  b.onclick = () => {
    set.has(key) ? set.delete(key) : set.add(key);
    b.setAttribute('aria-pressed', String(set.has(key)));
    render();
  };
  container.appendChild(b);
}
Object.entries(CATS).forEach(([k, v]) => chip(document.getElementById('cat-filters'), k, v, css(`--c-${k}`), activeCats));
Object.entries(STATUS).forEach(([k, v]) => chip(document.getElementById('status-filters'), k, v, null, activeStatus));

function popupHtml(r) {
  return `<div class="popup">
    <b>${esc(r.title)}</b><div class="small muted">${esc(r.place || '')} · ${ago(r.createdAt)} · severity ${r.severity}/5</div>
    ${r.photo ? `<img src="${esc(r.photo)}" alt="Report photo" />` : ''}
    <div class="ml">“${esc(r.transcript)}”</div>
    <div class="small muted">${esc(r.english)}</div>
    <div class="small muted">Heard in ${esc(LANG[r.lang] || r.lang || 'unknown')} · via ${esc(r.source)}${r.source === 'sample' ? ' (sample data)' : ''}</div>
    <select data-id="${esc(r.id)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
  </div>`;
}

map.on('popupopen', (e) => {
  const sel = e.popup.getElement().querySelector('select[data-id]');
  if (!sel) return;
  sel.onchange = async () => {
    await fetch(`/api/reports/${encodeURIComponent(sel.dataset.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: sel.value }),
    });
    load();
  };
});

function render() {
  const visible = reports.filter((r) => activeCats.has(r.category) && activeStatus.has(r.status));
  const open = reports.filter((r) => r.status !== 'resolved');
  document.getElementById('s-open').textContent = open.length;
  document.getElementById('s-high').textContent = open.filter((r) => r.severity >= 4).length;
  document.getElementById('s-24h').textContent = reports.filter((r) => Date.now() - new Date(r.createdAt) < 864e5).length;
  document.getElementById('s-lang').textContent = new Set(reports.map((r) => r.lang).filter(Boolean)).size;

  layer.clearLayers();
  markers.clear();
  visible.forEach((r) => {
    const color = css(`--c-${r.category}`) || '#64748b';
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 6 + r.severity * 2,
      color: '#fff', weight: 2, fillColor: color, fillOpacity: r.status === 'resolved' ? 0.35 : 0.9,
    }).bindPopup(popupHtml(r));
    m.addTo(layer);
    markers.set(r.id, m);
  });

  const list = document.getElementById('list');
  list.innerHTML = visible.map((r) => `
    <div class="item ${!firstLoad && !known.has(r.id) ? 'new' : ''}" data-id="${esc(r.id)}" style="--c:${css(`--c-${r.category}`)}">
      <h3>${esc(r.title)}</h3>
      <div class="meta"><span>${esc(CATS[r.category])}</span><span>📍 ${esc(r.place || 'GPS')}</span><span>${ago(r.createdAt)}</span>
      <span class="badge ${r.status}">${STATUS[r.status]}</span><span class="sev">${'●'.repeat(r.severity)}</span>
      ${r.source === 'sample' ? '<span class="sample">sample</span>' : ''}</div>
    </div>`).join('') || '<p class="muted">No reports match these filters.</p>';
  list.querySelectorAll('.item').forEach((el) => {
    el.onclick = () => {
      const m = markers.get(el.dataset.id);
      if (m) { map.flyTo(m.getLatLng(), 14, { duration: 0.6 }); m.openPopup(); }
    };
  });
}

async function load() {
  try {
    const next = await (await fetch('/api/reports')).json();
    const sig = JSON.stringify(next);
    if (sig === lastSig) return; // nothing changed: keep open popups intact
    lastSig = sig;
    const fresh = next.filter((r) => !known.has(r.id));
    reports = next;
    render();
    if (!firstLoad && fresh.length) {
      const m = markers.get(fresh[0].id);
      if (m) { map.flyTo(m.getLatLng(), 14, { duration: 0.8 }); m.openPopup(); }
    }
    next.forEach((r) => known.add(r.id));
    firstLoad = false;
  } catch (e) {
    console.warn(e);
  }
}
load();
setInterval(load, 4000);
