const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CAT = {
  waste: ['മാലിന്യം', 'Waste dumping', 'var(--c-waste)'],
  flood: ['വെള്ളപ്പൊക്കം', 'Flooding', 'var(--c-flood)'],
  blocked_canal: ['തോട് അടഞ്ഞു', 'Blocked canal', 'var(--c-blocked_canal)'],
  water_quality: ['ജലമലിനീകരണം', 'Water pollution', 'var(--c-water_quality)'],
  other: ['മറ്റുള്ളവ', 'Other', 'var(--c-other)'],
};
const MAX_SECONDS = 25; // Sarvam sync STT is designed for < 30s clips

// ---------- health ----------
fetch('/api/health').then((r) => r.json()).then((h) => {
  const m = $('#mode');
  m.textContent = h.mock ? 'Demo mode' : 'Sarvam AI live';
  m.classList.toggle('ok', !h.mock);
}).catch(() => {});

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
if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    (p) => {
      coords = { lat: p.coords.latitude, lng: p.coords.longitude };
      $('#gps-dot').classList.add('ok');
      $('#gps-text').textContent = `ലൊക്കേഷൻ ലഭിച്ചു · Location ready (±${Math.round(p.coords.accuracy)} m)`;
    },
    () => { $('#gps-text').textContent = 'Location off: we will use the place you mention'; },
    { enableHighAccuracy: true, timeout: 10000 },
  );
} else {
  $('#gps-text').textContent = 'Location unavailable';
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

sendBtn.addEventListener('click', async () => {
  const out = $('#report-out');
  const fd = new FormData();
  if (reportAudio) fd.append('audio', reportAudio, 'report.webm');
  else fd.append('text', textEl.value.trim());
  if (photoBlob) fd.append('photo', photoBlob, 'photo.jpg');
  if (coords) { fd.append('lat', coords.lat); fd.append('lng', coords.lng); }

  sendBtn.disabled = true;
  loading(out, 'കേൾക്കുന്നു, മനസ്സിലാക്കുന്നു… Understanding your report');
  try {
    const res = await fetch('/api/reports', { method: 'POST', body: fd });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || 'Failed');
    const [ml, en, color] = CAT[r.category] || CAT.other;
    out.className = 'card result';
    out.innerHTML = `
      <div class="row"><span class="tag" style="background:${color}">${esc(ml)} · ${esc(en)}</span>
      <span class="sev" title="Severity ${r.severity}/5">${'●'.repeat(r.severity)}${'○'.repeat(5 - r.severity)}</span></div>
      <p class="ml">“${esc(r.transcript)}”</p>
      <p class="en">${esc(r.english)}</p>
      <div class="small muted">📍 ${esc(r.place || 'Your location')} · ✅ നന്ദി! റിപ്പോർട്ട് പഞ്ചായത്തിന് അയച്ചു · Sent to the authority dashboard</div>`;
    reportAudio = null;
    photoBlob = null;
    textEl.value = '';
    $('#photo').value = '';
    $('#photo-preview').classList.remove('show');
    $('#audio-state').textContent = '';
    $('#rec-label').innerHTML = 'സംസാരിക്കാൻ അമർത്തുക<span>Tap and speak to report another problem</span>';
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
    out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
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
