import { queueReport, queuedCount, flushQueue } from '/offline.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const CAT = {
  waste: ['മാലിന്യം', 'Waste dumping', 'var(--c-waste)'],
  flood: ['വെള്ളപ്പൊക്കം', 'Flooding', 'var(--c-flood)'],
  blocked_canal: ['തോട് അടഞ്ഞു', 'Blocked canal', 'var(--c-blocked_canal)'],
  water_quality: ['ജലമലിനീകരണം', 'Water pollution', 'var(--c-water_quality)'],
  other: ['മറ്റുള്ളവ', 'Other', 'var(--c-other)'],
};
const MAX_SECONDS = 25; // Sarvam sync STT is designed for < 30s clips

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- health ----------
fetch('/api/health').then((r) => r.json()).then((h) => {
  const m = $('#mode');
  m.textContent = h.mock ? 'Demo mode' : 'Sarvam AI live';
  m.classList.toggle('ok', !h.mock);
}).catch(() => { $('#mode').textContent = 'Offline'; });

// ---------- tabs ----------
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('#tab-report').classList.toggle('hidden', b.dataset.tab !== 'report');
    $('#tab-ask').classList.toggle('hidden', b.dataset.tab !== 'ask');
  });
});

// ---------- recorder ----------
function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

function makeRecorder(button, timerEl, onDone) {
  let rec = null;
  let chunks = [];
  let tick = null;
  let started = 0;

  async function start() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert('Microphone permission is needed. You can also type your message.');
      return;
    }
    const mimeType = pickMime();
    rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(tick);
      timerEl.textContent = '';
      button.classList.remove('recording');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      rec = null;
      if (blob.size > 1000) onDone(blob);
    };
    rec.start();
    started = Date.now();
    button.classList.add('recording');
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      timerEl.textContent = `● 0:${String(s).padStart(2, '0')} / 0:${MAX_SECONDS}`;
      if (s >= MAX_SECONDS) stop();
    }, 250);
  }
  function stop() {
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  button.addEventListener('click', () => (rec ? stop() : start()));
}

// ---------- location ----------
let coords = null;
const onLocation = [];
if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    (p) => {
      coords = { lat: p.coords.latitude, lng: p.coords.longitude };
      $('#gps-dot').classList.add('ok');
      $('#gps-text').textContent = `ലൊക്കേഷൻ ലഭിച്ചു · Location ready (±${Math.round(p.coords.accuracy)} m)`;
      onLocation.forEach((f) => f());
    },
    () => { $('#gps-text').textContent = 'Location off: we will use the place you mention'; },
    { enableHighAccuracy: true, timeout: 10000 },
  );
} else {
  $('#gps-text').textContent = 'Location unavailable';
}

// ---------- flood risk near me ----------
function km(a, b, c, d) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
async function showMyRisk() {
  if (!coords) return;
  try {
    const risk = await (await fetch('/api/risk')).json();
    const near = risk.areas
      .map((a) => ({ ...a, d: km(coords.lat, coords.lng, a.lat, a.lng) }))
      .filter((a) => a.d <= 6)
      .sort((a, b) => a.d - b.d)[0];
    if (!near) return;
    const el = $('#my-risk');
    el.innerHTML = `<div><span class="small muted">വെള്ളപ്പൊക്ക സാധ്യത · Flood risk near you</span>
      <b>${esc(near.ml || near.name)} · ${esc(near.name)}</b>
      <span class="small muted">${esc(near.reasons[0] || '')}</span></div>
      <span class="lv ${near.level}">${esc(near.levelMl)} · ${esc(near.levelEn)}</span>`;
    el.classList.remove('hidden');
  } catch { /* offline: skip */ }
}
onLocation.push(showMyRisk);

// ---------- alerts ----------
const LANG_LABEL = { ml: 'മലയാളം', hi: 'हिन्दी', en: 'English' };
let shownAlerts = '';
let player = null;
function playAlert(a, lang) {
  if (player) player.pause();
  if (a.audio?.[lang]) {
    player = new Audio(a.audio[lang]);
    player.play().catch(() => {});
  } else if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(a.text[lang]);
    u.lang = { ml: 'ml-IN', hi: 'hi-IN', en: 'en-IN' }[lang];
    speechSynthesis.speak(u);
  }
}
function renderAlerts(list) {
  const box = $('#alerts');
  box.innerHTML = list.map((a) => `
    <div class="alert-card ${esc(a.level)}" data-id="${esc(a.id)}">
      <h3>📢 ഔദ്യോഗിക മുന്നറിയിപ്പ് · Official alert <span class="small muted">${esc(a.place)} · ${new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></h3>
      <p class="msg" data-msg>${esc(a.text.ml)}</p>
      <div class="langs">${['ml', 'hi', 'en'].filter((k) => a.text[k]).map((k) => `<button class="btn" data-lang="${k}" aria-pressed="${k === 'ml'}">▶ ${LANG_LABEL[k]}</button>`).join('')}</div>
    </div>`).join('');
  box.querySelectorAll('.alert-card').forEach((card) => {
    const a = list.find((x) => x.id === card.dataset.id);
    card.querySelectorAll('[data-lang]').forEach((b) => {
      b.onclick = () => {
        card.querySelectorAll('[data-lang]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        card.querySelector('[data-msg]').textContent = a.text[b.dataset.lang];
        playAlert(a, b.dataset.lang);
      };
    });
  });
}
async function pollAlerts() {
  try {
    const q = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
    const list = await (await fetch(`/api/alerts${q}`)).json();
    const sig = list.map((a) => a.id).join(',');
    if (sig === shownAlerts) return;
    shownAlerts = sig;
    renderAlerts(list);
    const heard = store.get('heardAlerts', []);
    const fresh = list.find((a) => !heard.includes(a.id));
    if (fresh) {
      store.set('heardAlerts', [...heard, fresh.id].slice(-50));
      navigator.vibrate?.([300, 120, 300]);
      playAlert(fresh, 'ml'); // browsers may block until the user has tapped the page; the buttons always work
    }
  } catch { /* offline */ }
}
pollAlerts();
setInterval(pollAlerts, 10000);
onLocation.push(pollAlerts);

// ---------- offline queue ----------
async function refreshOfflineBar() {
  const n = await queuedCount().catch(() => 0);
  const bar = $('#offline-bar');
  if (!n && navigator.onLine) return bar.classList.add('hidden');
  bar.textContent = navigator.onLine
    ? `📤 ${n} saved report(s) sending… · സംരക്ഷിച്ച റിപ്പോർട്ടുകൾ അയയ്ക്കുന്നു`
    : `📶 ഓഫ്‌ലൈൻ · Offline${n ? `: ${n} report(s) saved, will send automatically when signal returns` : ': reports will be saved and sent later'}`;
  bar.classList.remove('hidden');
}
async function trySync() {
  if (!navigator.onLine) return refreshOfflineBar();
  const sent = await flushQueue().catch(() => 0);
  await refreshOfflineBar();
  if (sent) toast(`✅ ${sent} saved report(s) sent · അയച്ചു`);
}
window.addEventListener('online', trySync);
window.addEventListener('offline', refreshOfflineBar);
trySync();
setInterval(trySync, 20000);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- photo ----------
let photoBlob = null;
async function downscale(file, max = 1280) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
}
$('#photo').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try { photoBlob = await downscale(f); } catch { photoBlob = f; }
  const prev = $('#photo-preview');
  prev.src = URL.createObjectURL(photoBlob);
  prev.classList.add('show');
});

// ---------- report ----------
let reportAudio = null;
const sendBtn = $('#send-btn');
const textEl = $('#report-text');
const refreshSend = () => { sendBtn.disabled = !(reportAudio || textEl.value.trim()); };
textEl.addEventListener('input', refreshSend);

makeRecorder($('#rec-btn'), $('#rec-timer'), (blob) => {
  reportAudio = blob;
  $('#audio-state').textContent = '🎙️ ശബ്ദം റെക്കോർഡ് ചെയ്തു · Voice recorded';
  $('#rec-label').innerHTML = 'വീണ്ടും റെക്കോർഡ് ചെയ്യാം<span>Tap to re-record, then press Send</span>';
  refreshSend();
});

function loading(el, msg) {
  el.className = 'card';
  el.innerHTML = `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;
}

function resetForm() {
  reportAudio = null;
  photoBlob = null;
  textEl.value = '';
  $('#photo').value = '';
  $('#photo-preview').classList.remove('show');
  $('#audio-state').textContent = '';
  $('#rec-label').innerHTML = 'സംസാരിക്കാൻ അമർത്തുക<span>Tap and speak to report another problem</span>';
}

sendBtn.addEventListener('click', async () => {
  const out = $('#report-out');
  const item = {
    audio: reportAudio,
    text: reportAudio ? '' : textEl.value.trim(),
    photo: photoBlob,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    capturedAt: new Date().toISOString(),
  };

  const saveOffline = async () => {
    await queueReport(item);
    out.className = 'card result';
    out.innerHTML = `<p class="ml">📶 സിഗ്നൽ ഇല്ല. റിപ്പോർട്ട് ഫോണിൽ സംരക്ഷിച്ചു.</p>
      <p class="en">No signal: your report is saved on this phone and will be sent automatically when the signal returns.</p>`;
    resetForm();
    refreshOfflineBar();
  };

  sendBtn.disabled = true;
  if (!navigator.onLine) { await saveOffline(); refreshSend(); return; }

  const fd = new FormData();
  if (item.audio) fd.append('audio', item.audio, 'report.webm');
  else fd.append('text', item.text);
  if (item.photo) fd.append('photo', item.photo, 'photo.jpg');
  if (item.lat != null) { fd.append('lat', item.lat); fd.append('lng', item.lng); }

  loading(out, 'കേൾക്കുന്നു, മനസ്സിലാക്കുന്നു… Understanding your report');
  try {
    let res;
    try {
      res = await fetch('/api/reports', { method: 'POST', body: fd });
    } catch {
      await saveOffline(); // network dropped mid-send
      return;
    }
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || 'Failed');
    const [ml, en, color] = CAT[r.category] || CAT.other;
    const others = (r.incident?.confirmations || 1) - 1;
    out.className = 'card result';
    out.innerHTML = `
      <div class="row"><span class="tag" style="background:${color}">${esc(ml)} · ${esc(en)}</span>
      <span class="sev" title="Severity ${r.severity}/5">${'●'.repeat(r.severity)}${'○'.repeat(5 - r.severity)}</span></div>
      <p class="ml">“${esc(r.transcript)}”</p>
      <p class="en">${esc(r.english)}</p>
      ${others > 0 ? `<div class="confirm-line">👥 ${others} പേർ കൂടി ഇത് റിപ്പോർട്ട് ചെയ്തു · ${others} other resident${others > 1 ? 's' : ''} reported this too, so it is now a confirmed incident</div>` : ''}
      <div class="small muted" style="margin-top:8px">📍 ${esc(r.place || 'Your location')} · ✅ നന്ദി! റിപ്പോർട്ട് പഞ്ചായത്തിന് അയച്ചു · Sent to the authority dashboard</div>`;
    resetForm();
  } catch (e) {
    out.className = 'card';
    out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  } finally {
    refreshSend();
  }
});

// ---------- ask ----------
function speakFallback(text, lang) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  speechSynthesis.speak(u);
}

async function ask(body) {
  const out = $('#ask-out');
  if (!navigator.onLine) {
    out.className = 'card';
    out.innerHTML = '<p class="error">📶 ചോദ്യങ്ങൾക്ക് ഇന്റർനെറ്റ് വേണം · Asking needs a connection. Reports still work offline.</p>';
    return;
  }
  loading(out, 'ആലോചിക്കുന്നു… Thinking');
  try {
    const res = await fetch('/api/ask', { method: 'POST', body });
    const a = await res.json();
    if (!res.ok) throw new Error(a.error || 'Failed');
    out.className = 'card result';
    out.innerHTML = `<div class="chat-q small muted">🗣️ ${esc(a.question)}</div>
      <div class="chat-a">🔊 ${esc(a.answer)}</div>
      <div class="row" style="margin-top:10px"><button class="btn" id="replay">▶ വീണ്ടും കേൾക്കുക · Replay</button></div>`;
    const play = () => {
      if (a.audio) new Audio(`data:audio/mpeg;base64,${a.audio}`).play().catch(() => {});
      else speakFallback(a.answer, a.lang);
    };
    $('#replay').addEventListener('click', play);
    play();
  } catch (e) {
    out.className = 'card';
    out.innerHTML = `<p class="error">${esc(e.message === 'Failed to fetch' ? 'No connection, please try again.' : e.message)}</p>`;
  }
}

makeRecorder($('#ask-btn'), $('#ask-timer'), (blob) => {
  const fd = new FormData();
  fd.append('audio', blob, 'question.webm');
  ask(fd);
});
document.querySelectorAll('#examples button').forEach((b) => {
  b.addEventListener('click', () => {
    const fd = new FormData();
    fd.append('text', b.textContent);
    ask(fd);
  });
});
