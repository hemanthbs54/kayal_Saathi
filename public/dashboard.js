/* global L */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const CATS = { waste: 'Waste dumping', flood: 'Flooding', blocked_canal: 'Blocked canal', water_quality: 'Water pollution', other: 'Other' };
const STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
const LANG = { 'ml-IN': 'Malayalam', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil', 'en-IN': 'English', 'bn-IN': 'Bengali', 'kn-IN': 'Kannada', 'te-IN': 'Telugu' };
const LEVEL_COLOR = { low: '--lv-low', moderate: '--lv-moderate', high: '--lv-high', severe: '--lv-severe' };

const state = { incidents: [], risk: null, alerts: [], selectedArea: null, adminProtected: false };
const activeCats = new Set(Object.keys(CATS));
const activeStatus = new Set(['open', 'in_progress']);
const knownReports = new Set();
let firstLoad = true;
const sigs = {};

// ---------- helpers ----------
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
const day = (iso, opts = { weekday: 'short' }) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' });

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  return { el: bg.querySelector('.modal'), close: () => bg.remove() };
}

// ---------- authority passcode ----------
function askPasscode() {
  return new Promise((resolve) => {
    const m = modal(`<h2>🔒 Authority passcode</h2>
      <p class="small muted">Status changes, alerts and briefs are limited to officials.</p>
      <label for="pc">Passcode</label><input id="pc" type="password" autocomplete="current-password" />
      <p class="error small" id="pc-err"></p>
      <div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Unlock</button></div>`);
    const input = m.el.querySelector('#pc');
    input.focus();
    const ok = async () => {
      const res = await fetch('/api/admin/check', { headers: { 'x-admin-passcode': input.value } });
      if (res.ok) { ls.set('kayal-pass', input.value); m.close(); updateLock(); resolve(true); }
      else m.el.querySelector('#pc-err').textContent = res.status === 401 ? 'Wrong passcode.' : ((await res.json().catch(() => ({}))).error || 'Not available.');
    };
    m.el.querySelector('[data-ok]').onclick = ok;
    input.onkeydown = (e) => e.key === 'Enter' && ok();
    m.el.querySelector('[data-x]').onclick = () => { m.close(); resolve(false); };
  });
}

async function api(path, opts = {}) {
  const send = () => fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-passcode': ls.get('kayal-pass') || '', ...(opts.headers || {}) },
  });
  let res = await send();
  if (res.status === 401 && (await askPasscode())) res = await send();
  if (res.status === 503) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Not available.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function updateLock() {
  const b = $('#lock-btn');
  if (!state.adminProtected) b.textContent = '🔓 Open access';
  else b.textContent = ls.get('kayal-pass') ? '🔓 Official' : '🔒 Sign in';
}
$('#lock-btn').onclick = () => askPasscode();

// ---------- map ----------
const map = L.map('map').setView([9.45, 76.4], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
map.createPane('risk').style.zIndex = 350;
map.createPane('inc').style.zIndex = 450;
map.createPane('incLabels').style.zIndex = 460;
const riskLayer = L.layerGroup().addTo(map);
const incLayer = L.layerGroup().addTo(map);
const markers = new Map();
let popupOpen = false;
let pendingMarkers = false;
map.on('popupopen', (e) => { popupOpen = true; wirePopup(e.popup.getElement()); });
map.on('popupclose', () => { popupOpen = false; if (pendingMarkers) { pendingMarkers = false; renderIncidentMarkers(); } });
$('#lyr-inc').onchange = (e) => (e.target.checked ? incLayer.addTo(map) : incLayer.remove());
$('#lyr-risk').onchange = (e) => (e.target.checked ? riskLayer.addTo(map) : riskLayer.remove());

// ---------- side-panel tabs ----------
function showPanel(p) {
  document.querySelectorAll('.ptabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.p === p)));
  ['incidents', 'risk', 'alerts'].forEach((x) => $(`#p-${x}`).classList.toggle('hidden', x !== p));
}
document.querySelectorAll('.ptabs button').forEach((b) => { b.onclick = () => showPanel(b.dataset.p); });

// ---------- filters ----------
function chip(container, key, label, color, set, rerender) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.setAttribute('aria-pressed', String(set.has(key)));
  b.innerHTML = `${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}`;
  b.onclick = () => {
    set.has(key) ? set.delete(key) : set.add(key);
    b.setAttribute('aria-pressed', String(set.has(key)));
    rerender();
  };
  container.appendChild(b);
}
const rerenderIncidents = () => { renderIncidentList(); renderIncidentMarkers(); };
Object.entries(CATS).forEach(([k, v]) => chip($('#cat-filters'), k, v, css(`--c-${k}`), activeCats, rerenderIncidents));
Object.entries(STATUS).forEach(([k, v]) => chip($('#status-filters'), k, v, null, activeStatus, rerenderIncidents));
const visibleIncidents = () => state.incidents.filter((i) => activeCats.has(i.category) && activeStatus.has(i.status));

// ---------- incidents ----------
function incidentPopup(i) {
  const reps = i.reports.map((r) => `<div class="rep">
      <div class="small muted">${esc(LANG[r.lang] || r.lang || '?')} · ${esc(r.source)} · ${ago(r.createdAt)}${r.queuedOffline ? ' · 📶 sent after reconnecting' : ''}</div>
      ${r.photo ? `<img src="${esc(r.photo)}" alt="Photo from resident" loading="lazy" />` : ''}
      <div class="ml">“${esc(r.transcript)}”</div>
      ${r.lang !== 'en-IN' ? `<div class="small muted">${esc(r.english)}</div>` : ''}
    </div>`).join('');
  return `<div class="popup" data-inc="${esc(i.id)}">
    <b>${esc(i.title)}</b>
    <div class="small muted">${esc(CATS[i.category])} · ${esc(i.place || 'GPS location')} · severity ${i.severity}/5</div>
    <div class="small" style="margin-top:4px"><b>👥 ${i.confirmations} report${i.confirmations > 1 ? 's' : ''}</b>${i.verified ? ' · <span class="badge ok">✓ confirmed</span>' : ' · single unverified report'}${i.sample ? ' · <span class="sample">sample data</span>' : ''}</div>
    ${reps}
    <select data-status aria-label="Incident status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <button class="btn" data-alert>📢 Alert residents near here</button>
  </div>`;
}

function wirePopup(el) {
  const box = el.querySelector('[data-inc]');
  if (!box) return;
  const id = box.dataset.inc;
  box.querySelector('[data-status]').onchange = async (e) => {
    try {
      await api(`/api/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
      toast(`Marked ${STATUS[e.target.value]}`);
      refresh();
    } catch (err) { toast(err.message); }
  };
  box.querySelector('[data-alert]').onclick = () => composeAlert({ kind: 'incident', id }, state.incidents.find((i) => i.id === id)?.title);
}

function renderIncidentMarkers() {
  if (popupOpen) { pendingMarkers = true; return; }
  incLayer.clearLayers();
  markers.clear();
  for (const i of visibleIncidents()) {
    const m = L.circleMarker([i.lat, i.lng], {
      pane: 'inc', radius: 6 + i.severity * 2, color: '#fff', weight: 2,
      fillColor: css(`--c-${i.category}`), fillOpacity: i.status === 'resolved' ? 0.35 : 0.92,
    }).bindPopup(incidentPopup(i), { maxWidth: 300 });
    m.addTo(incLayer);
    if (i.confirmations > 1) {
      L.marker([i.lat, i.lng], {
        pane: 'incLabels', interactive: false,
        icon: L.divIcon({ className: 'count-icon', html: String(i.confirmations), iconSize: [20, 20], iconAnchor: [-2, 22] }),
      }).addTo(incLayer);
    }
    markers.set(i.id, m);
  }
}

function renderIncidentList() {
  const list = visibleIncidents();
  $('#inc-list').innerHTML = list.map((i) => `
    <div class="item ${!firstLoad && i.reports.some((r) => !knownReports.has(r.id)) ? 'new' : ''}" tabindex="0" data-id="${esc(i.id)}" style="--c:${css(`--c-${i.category}`)}">
      <h3>${esc(i.title)}</h3>
      <div class="meta">
        <span>${esc(CATS[i.category])}</span><span>📍 ${esc(i.place || 'GPS')}</span><span>${ago(i.lastAt)}</span>
        <span class="badge ${i.status}">${STATUS[i.status]}</span>
        ${i.confirmations > 1 ? `<span class="badge count">👥 ${i.confirmations} reports</span>` : ''}
        ${i.verified ? '<span class="badge ok">✓ confirmed</span>' : ''}
        <span>${i.langs.map((l) => esc((LANG[l] || l).slice(0, 2).toUpperCase())).join(' ')}</span>
        <span class="sev" title="Severity ${i.severity}/5">${'●'.repeat(i.severity)}</span>
        ${i.sample ? '<span class="sample">sample</span>' : ''}
      </div>
    </div>`).join('') || '<p class="muted">No incidents match these filters.</p>';
  $('#inc-list').querySelectorAll('.item').forEach((el) => {
    const open = () => focusIncident(el.dataset.id);
    el.onclick = open;
    el.onkeydown = (e) => e.key === 'Enter' && open();
  });
}

function focusIncident(id) {
  if (popupOpen) map.closePopup();
  const m = markers.get(id);
  if (m) { map.flyTo(m.getLatLng(), 14, { duration: 0.6 }); setTimeout(() => m.openPopup(), 650); }
}

// ---------- flood risk ----------
const levelBadge = (a) => `<span class="lv ${a.level}">${esc(a.levelEn)} · ${esc(a.levelMl)}</span>`;

function renderRiskLayer() {
  riskLayer.clearLayers();
  for (const a of state.risk?.areas || []) {
    const color = css(LEVEL_COLOR[a.level]);
    L.circle([a.lat, a.lng], {
      pane: 'risk', radius: 1600, color, weight: 1.5, fillColor: color,
      fillOpacity: a.level === 'low' ? 0.08 : 0.22,
    })
      .bindTooltip(`<b>${esc(a.name)}</b> · flood risk ${a.score}/100 (${esc(a.levelEn)})`, { sticky: true })
      .on('click', () => { showPanel('risk'); selectArea(a.name); })
      .addTo(riskLayer);
  }
}

function renderRiskList() {
  const r = state.risk;
  if (!r) return;
  $('#risk-list').innerHTML = r.areas.map((a) => `
    <div class="item" tabindex="0" data-area="${esc(a.name)}" style="--c:${css(LEVEL_COLOR[a.level])}">
      <div class="risk-row">
        <div><h3>${esc(a.name)} <span class="small muted">${esc(a.ml || '')}</span></h3>${levelBadge(a)}</div>
        <div class="score">${a.score}</div>
        <div class="why">${esc(a.reasons.slice(0, 2).join(' · '))}</div>
      </div>
    </div>`).join('');
  $('#risk-list').querySelectorAll('[data-area]').forEach((el) => {
    el.onclick = () => selectArea(el.dataset.area);
    el.onkeydown = (e) => e.key === 'Enter' && selectArea(el.dataset.area);
  });
  $('#risk-disclaimer').textContent = `${r.disclaimer} Data: ${r.source}${r.stale ? ' (cached: live fetch failed)' : ''}, updated ${ago(r.updatedAt)}.`;
  if (state.selectedArea) renderRiskDetail();
}

function selectArea(name) {
  state.selectedArea = name;
  renderRiskDetail();
  const a = state.risk.areas.find((x) => x.name === name);
  if (a) map.flyTo([a.lat, a.lng], 13, { duration: 0.6 });
  $('#p-risk').parentElement.scrollTop = 0;
}

// --- charts (single series each, no dual axis; hover tooltips) ---
const tip = document.createElement('div');
tip.className = 'tip hidden';
document.body.appendChild(tip);
function bindTips(svg) {
  svg.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      tip.textContent = el.dataset.tip;
      tip.classList.remove('hidden');
      tip.style.left = `${e.clientX + 12}px`;
      tip.style.top = `${e.clientY - 30}px`;
    });
    el.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  });
}
const W = 360, H = 120, ML = 30, MR = 8, MT = 10, MB = 20;

function rainChart(days) {
  const max = Math.max(10, Math.ceil(Math.max(...days.map((d) => d.rain)) / 10) * 10);
  const bw = (W - ML - MR) / days.length;
  const y = (v) => MT + (H - MT - MB) * (1 - v / max);
  const fill = '#2a78d6';
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rainfall forecast, next 7 days">`;
  [0, max / 2, max].forEach((v) => { s += `<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y(v)}" y2="${y(v)}"/><text x="${ML - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`; });
  days.forEach((d, i) => {
    const x = ML + i * bw + bw * 0.2;
    const w = bw * 0.6;
    const top = y(d.rain);
    const h = Math.max(0, y(0) - top);
    const r = Math.min(4, h, w / 2);
    if (h > 0.5) s += `<path d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${y(0)} Z" fill="${fill}"/>`;
    s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${i === 0 ? 'Today' : day(d.date)}</text>`;
    s += `<rect x="${ML + i * bw}" y="${MT}" width="${bw}" height="${H - MT - MB}" fill="transparent" data-tip="${esc(day(d.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${d.rain} mm${d.prob != null ? ` · ${d.prob}% chance` : ''}"/>`;
  });
  return `${s}</svg>`;
}

function riverChart(days) {
  const pts = days.filter((d) => d.discharge != null);
  if (pts.length < 2) return '<p class="small muted">River forecast unavailable.</p>';
  const vals = pts.map((d) => d.discharge);
  const lo = Math.floor(Math.min(...vals) * 0.9);
  const hi = Math.ceil(Math.max(...vals) * 1.1);
  const step = (W - ML - MR) / days.length;
  const x = (i) => ML + step * i + step / 2;
  const y = (v) => MT + (H - MT - MB) * (1 - (v - lo) / (hi - lo || 1));
  const stroke = '#0f766e';
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="River discharge forecast, next 7 days">`;
  [lo, (lo + hi) / 2, hi].forEach((v) => { s += `<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y(v)}" y2="${y(v)}"/><text x="${ML - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v * 10) / 10}</text>`; });
  const path = days.map((d, i) => (d.discharge == null ? null : `${x(i)},${y(d.discharge)}`)).filter(Boolean).join(' L');
  s += `<path d="M${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  days.forEach((d, i) => {
    s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${i === 0 ? 'Today' : day(d.date)}</text>`;
    if (d.discharge == null) return;
    s += `<circle cx="${x(i)}" cy="${y(d.discharge)}" r="4" fill="${stroke}" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<rect x="${x(i) - step / 2}" y="${MT}" width="${step}" height="${H - MT - MB}" fill="transparent" data-tip="${esc(day(d.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${d.discharge} m³/s"/>`;
  });
  return `${s}</svg>`;
}

function renderRiskDetail() {
  const a = state.risk?.areas.find((x) => x.name === state.selectedArea);
  const box = $('#risk-detail');
  if (!a) { box.innerHTML = ''; return; }
  const comps = [['Rain', a.components.rain, 35], ['River', a.components.river, 25], ['Reports', a.components.reports, 30], ['Terrain', a.components.terrain, 10]];
  box.innerHTML = `<div class="detail">
    <div class="row" style="justify-content:space-between"><h3>${esc(a.name)} <span class="small muted">${esc(a.ml || '')}</span></h3><button class="btn" data-close aria-label="Close">✕</button></div>
    <div class="row" style="margin-top:6px">${levelBadge(a)}<b style="font-size:1.4rem">${a.score}<span class="small muted">/100</span></b></div>
    <ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="chart-title">What drives the score</div>
    ${comps.map(([n, v, m]) => `<div class="comp"><span>${n}</span><div class="track"><div class="fill" style="width:${(v / m) * 100}%"></div></div><b>${v}/${m}</b></div>`).join('')}
    <div class="chart-title">Rainfall forecast (mm/day)</div><div class="chart-sub">Open-Meteo · next 7 days</div>
    ${a.days.length ? rainChart(a.days) : '<p class="small muted">Rain forecast unavailable.</p>'}
    <div class="chart-title">River discharge forecast (m³/s)</div><div class="chart-sub">GloFAS · nearest river cell</div>
    ${riverChart(a.days)}
    <button class="btn primary block" data-alert style="margin-top:12px">📢 Draft voice alert for ${esc(a.name)}</button>
  </div>`;
  box.querySelectorAll('svg.chart').forEach(bindTips);
  box.querySelector('[data-close]').onclick = () => { state.selectedArea = null; box.innerHTML = ''; };
  box.querySelector('[data-alert]').onclick = () => composeAlert({ kind: 'area', name: a.name }, a.name);
}

// ---------- alerts ----------
function composeAlert(subject, label) {
  const m = modal(`<h2>📢 Voice alert: ${esc(label || '')}</h2>
    <p class="small muted">AI drafts the message in Malayalam, Hindi and English from the verified data. <b>You review and edit it before anything is sent.</b></p>
    <div id="al-body"><div class="loading"><div class="spinner"></div>Drafting in 3 languages…</div></div>`);
  const body = m.el.querySelector('#al-body');
  api('/api/alerts/draft', { method: 'POST', body: JSON.stringify(subject) })
    .then((d) => {
      body.innerHTML = `${(d.warnings || []).map((w) => `<p class="error small">⚠️ ${esc(w)}</p>`).join('')}
        <label for="al-ml">മലയാളം (Malayalam)</label><textarea id="al-ml">${esc(d.text.ml)}</textarea>
        <label for="al-hi">हिन्दी (Hindi, for migrant workers)</label><textarea id="al-hi">${esc(d.text.hi)}</textarea>
        <label for="al-en">English</label><textarea id="al-en">${esc(d.text.en)}</textarea>
        <label for="al-r">Who receives it</label>
        <select id="al-r"><option value="1">Residents within 1 km</option><option value="3" selected>Residents within 3 km</option><option value="5">Residents within 5 km</option><option value="10">Residents within 10 km</option><option value="all">Whole district</option></select>
        <div class="actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-send>📢 Broadcast voice alert</button></div>`;
      body.querySelector('[data-x]').onclick = m.close;
      body.querySelector('[data-send]').onclick = async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Generating voice in 3 languages…';
        const r = body.querySelector('#al-r').value;
        try {
          await api('/api/alerts', {
            method: 'POST',
            body: JSON.stringify({ ...subject, radiusKm: r === 'all' ? null : Number(r), text: { ml: body.querySelector('#al-ml').value, hi: body.querySelector('#al-hi').value, en: body.querySelector('#al-en').value } }),
          });
          m.close();
          toast(`✅ Alert sent to ${r === 'all' ? 'the whole district' : `residents within ${r} km`}`);
          showPanel('alerts');
          refresh();
        } catch (err) {
          toast(err.message);
          e.target.disabled = false;
          e.target.textContent = '📢 Broadcast voice alert';
        }
      };
    })
    .catch((err) => { body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

function renderAlerts() {
  $('#alert-list').innerHTML = state.alerts.map((a) => `
    <div class="item alert-item" style="--c:${css(LEVEL_COLOR[a.level] || '--lv-high')}">
      <h3>📢 ${esc(a.place)}</h3>
      <div class="meta"><span>${ago(a.createdAt)}</span><span>${a.radiusKm == null ? 'Whole district' : `Within ${a.radiusKm} km`}</span></div>
      <p class="msg">${esc(a.text.en)}</p>
      <p class="msg">${esc(a.text.ml)}</p>
      <div class="row">${['ml', 'hi', 'en'].filter((k) => a.audio?.[k]).map((k) => `<button class="btn" data-play="${esc(a.audio[k])}">▶ ${{ ml: 'മലയാളം', hi: 'हिन्दी', en: 'English' }[k]}</button>`).join('')}</div>
    </div>`).join('') || '<p class="muted">No alerts in the last 24 hours. Open an incident or a flood-risk area to send one.</p>';
  $('#alert-list').querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => new Audio(b.dataset.play).play(); });
}

// ---------- situation brief ----------
$('#brief-btn').onclick = () => {
  const m = modal(`<h2>📋 Situation brief</h2><p class="small muted">AI summary of incidents, flood risk and alerts, for the district / panchayat team.</p>
    <div id="br-body"><div class="loading"><div class="spinner"></div>Preparing brief…</div></div>`);
  const body = m.el.querySelector('#br-body');
  api('/api/brief', { method: 'POST' })
    .then((b) => {
      body.innerHTML = `<div class="brief-text">${esc(b.en)}</div>
        ${b.ml ? `<label>മലയാളം ശബ്ദസന്ദേശം · Malayalam voice summary for ward members</label><div class="brief-text">${esc(b.ml)}</div>` : ''}
        ${b.audio ? `<audio controls src="data:audio/mpeg;base64,${b.audio}" style="width:100%;margin-top:8px"></audio>` : ''}
        <p class="small muted">Generated ${ago(b.at)}.</p>
        <div class="actions"><button class="btn" data-copy>Copy text</button><button class="btn primary" data-x>Close</button></div>`;
      body.querySelector('[data-x]').onclick = m.close;
      body.querySelector('[data-copy]').onclick = () => navigator.clipboard?.writeText(`${b.en}\n\n${b.ml || ''}`).then(() => toast('Copied'));
    })
    .catch((err) => { body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
};

// ---------- river relay ----------
// If the server cannot reach the GloFAS river forecast (cloud IP rate limits), a signed-in official's
// browser fetches it and relays it (passcode-protected). Tried at most every 30 minutes.
let lastRelay = 0;
async function relayRiver(risk) {
  if (!risk.needsRiverRelay || !ls.get('kayal-pass') || Date.now() - lastRelay < 30 * 60e3) return;
  lastRelay = Date.now();
  try {
    const lat = risk.areas.map((a) => a.lat).join(',');
    const lng = risk.areas.map((a) => a.lng).join(',');
    const f = [].concat(await (await fetch(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&past_days=7&forecast_days=7`)).json());
    const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
    const areas = risk.areas.map((a, i) => {
      const dly = f[i]?.daily;
      if (!dly?.time) return null;
      let cut = dly.time.findIndex((t) => t >= today);
      if (cut < 0) cut = dly.time.length;
      return {
        name: a.name,
        past: dly.river_discharge.slice(0, cut).filter((v) => v != null),
        next: dly.river_discharge.slice(cut).map((v) => v ?? 0),
        dates: dly.time.slice(cut),
      };
    }).filter(Boolean);
    await fetch('/api/weather/river', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-passcode': ls.get('kayal-pass') }, body: JSON.stringify({ areas }) });
    sigs.risk = '';
    refresh();
  } catch (e) {
    console.warn('River relay failed', e);
  }
}

// ---------- stats + polling ----------
function renderStats() {
  const open = state.incidents.filter((i) => i.status !== 'resolved');
  $('#s-open').textContent = open.length;
  $('#s-verified').textContent = open.filter((i) => i.verified).length;
  $('#s-risk').textContent = state.risk ? state.risk.areas.filter((a) => a.level === 'high' || a.level === 'severe').length : '–';
  $('#s-alerts').textContent = state.alerts.length;
  $('#s-lang').textContent = new Set(state.incidents.flatMap((i) => i.langs)).size;
}

async function load(path, key, onChange) {
  const data = await (await fetch(path)).json();
  const sig = JSON.stringify(data);
  if (sigs[key] === sig) return false;
  sigs[key] = sig;
  onChange(data);
  return true;
}

async function refresh() {
  try {
    await Promise.all([
      load('/api/incidents', 'inc', (data) => {
        const fresh = data.find((i) => i.reports.some((r) => !knownReports.has(r.id)));
        state.incidents = data;
        renderIncidentList();
        renderIncidentMarkers();
        if (!firstLoad && fresh) { showPanel('incidents'); focusIncident(fresh.id); }
        data.forEach((i) => i.reports.forEach((r) => knownReports.add(r.id)));
      }),
      load('/api/risk', 'risk', (data) => { state.risk = data; renderRiskLayer(); renderRiskList(); relayRiver(data); }),
      load('/api/alerts', 'alerts', (data) => { state.alerts = data; renderAlerts(); }),
    ]);
    renderStats();
    firstLoad = false;
  } catch (e) {
    console.warn(e);
  }
}

fetch('/api/health').then((r) => r.json()).then((h) => { state.adminProtected = h.adminProtected; updateLock(); }).catch(() => {});
refresh();
setInterval(refresh, 5000);
