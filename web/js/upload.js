// Upload wizard: pick event → add videos → safety & consent → upload → receipt.
// Files go straight from the browser to storage in 8 MiB parts (resumable, retried on network loss).
// Location and phone details are blanked out on the device first (see mp4.js).
import { $, $$, ic, esc, dur, bytes, plural, fmtDate, api, toast, copy, qr, origin, store, config } from './util.js';
import { inspect, patched, fingerprint } from './mp4.js';
import { openOverlay, closeOverlay, invalidate } from './main.js';

const PART = 8 * 1024 * 1024;
const PARALLEL = 3;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|3gp|avi|mts|ts)$/i;
let U = null;

export const uploadBusy = () => !!(U && U.running);

export async function openUpload(slug) {
  if (U && U.running) { openOverlay('<div class="modal" role="dialog" aria-label="Upload footage" id="upmodal"></div>'); draw(); return; }
  U = { step: 0, ev: null, events: null, query: '', files: [], place: '', sensitive: false, consent: false, paused: false, running: false, token: null, net: false };
  openOverlay('<div class="modal" role="dialog" aria-label="Upload footage" id="upmodal"></div>');
  if (slug) {
    try { const d = await api(`/api/events/${slug}`); if (d.removed) throw new Error('This event was removed'); U.ev = d.event; U.step = 1; }
    catch (e) { toast(e.message, 'alert'); }
  }
  draw();
  if (!U.ev) loadEvents();
}
async function loadEvents(q) {
  try {
    const r = q && q.length > 1 ? await api(`/api/search?q=${encodeURIComponent(q)}`) : await api('/api/home');
    if (U) { U.events = r.events; if (U.step === 0) draw(); }
  } catch (e) { if (U) { U.events = []; U.err = e.message; draw(); } }
}

/* ---------- rendering ---------- */
function draw() {
  const m = $('#upmodal'); if (!m || !U) return;
  m.style.setProperty('--accent', U.ev ? U.ev.color : '#ff3d7f');
  const titles = ['Which event is this from?', 'Add your videos', 'Stay safe', 'Uploading', 'Safe on record'];
  const prog = [0, 1, 2, 3, 4].map((i) => `<i class="${i < U.step ? 'done' : i === U.step ? 'cur' : ''}"></i>`).join('');
  const [body, foot] = [step0, step1, step2, step3, step4][U.step]();
  m.innerHTML = `<div class="mhead"><h2>${titles[U.step]}</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
    <div class="progress">${prog}</div><div class="mbody">${body}</div><div class="mfoot">${foot}</div>`;
  if (U.step === 0) bindPicker();
  if (U.step === 1) bindFiles();
  if (U.step === 4 && U.token) qr($('#receiptqr'), receiptLink());
}
const evRow = (e, on) => `<button class="pickrow ${on ? 'on' : ''}" data-pick="${e.slug}" style="--accent:${e.color}">${e.cover ? `<img src="/m/p/${e.cover}" alt="">` : `<span class="ic-tile" style="color:${e.color}">${ic('calendar', 22)}</span>`}<div><b>${esc(e.title)}</b><span>${fmtDate(e.date)} · ${esc(e.city)}${e.live ? ' · <span style="color:var(--rec);font-weight:700">Live</span>' : ''}</span></div><span class="radio"></span></button>`;

function step0() {
  const list = U.events;
  return [`<div class="field"><input id="upq" placeholder="Search by event name, city or date" value="${esc(U.query)}" autocomplete="off" aria-label="Search events"></div>
    <div class="pick" id="uppick">${list === null ? '<div class="empty">Loading events…</div>' : list.length ? list.slice(0, 8).map((e) => evRow(e, U.ev && U.ev.slug === e.slug)).join('') : `<div class="empty">${U.query ? 'No event matches.' : 'No events yet.'}</div>`}
    <a class="pickrow" href="/new" style="grid-template-columns:64px 1fr"><span class="ic-tile big">${ic('plus', 24)}</span><div><b>Not listed? Create the event</b><span>Takes under a minute</span></div></a></div>`,
  `<span class="hint">Can’t find it? Create it — a moderator can merge duplicates.</span><button class="btn btn-primary" data-up="next" ${U.ev ? '' : 'disabled'}>Continue ${ic('arrow', 16)}</button>`];
}
function step1() {
  const total = U.files.reduce((s, f) => s + f.size, 0);
  const places = (U.ev.places || []).slice(0, 10);
  return [`<div class="pickrow on" style="--accent:${U.ev.color};margin-bottom:16px;cursor:default"><span class="ic-tile" style="color:${U.ev.color}">${ic('calendar', 22)}</span><div><b>${esc(U.ev.title)}</b><span>${fmtDate(U.ev.date)} · ${esc(U.ev.city)}</span></div><button class="link" data-up="change">Change</button></div>
    <label class="drop" id="drop"><input type="file" accept="video/*,.mov,.mp4,.m4v,.webm,.mkv,.3gp,.avi" multiple class="vh" id="fileinput"><span class="big">${ic('upload', 32, 2.2)}</span><b>Drop videos here</b><p>or tap to choose from your phone</p><p style="font-size:13px">${ic('lock', 13)} Nothing is sent until you tap Upload.</p></label>
    <div class="files" id="filelist">${U.files.map(fileRow).join('')}</div>
    ${U.files.length ? `<div class="field" style="margin-top:18px"><label>Where were you filming? <span style="color:var(--dim)">(optional)</span></label>
      <div class="cats" id="placechips">${places.map((p) => `<button type="button" class="${U.place === p.name ? 'on' : ''}" data-placename="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>
      <input id="placeother" maxlength="80" placeholder="Another place — street, square, landmark" value="${esc(places.some((p) => p.name === U.place) ? '' : U.place)}" style="margin-top:8px"></div>` : ''}`,
  `<span class="hint">${U.files.length ? `${plural(U.files.length, 'video')} · ${bytes(total)}` : ''}</span><div style="display:flex;gap:8px"><button class="btn btn-ghost" data-up="back">Back</button><button class="btn btn-primary" data-up="next" ${U.files.length && !U.files.some((f) => f.preparing) ? '' : 'disabled'}>Continue ${ic('arrow', 16)}</button></div>`];
}
function fileRow(f, i) {
  const live = U.step >= 3;
  const status = live ? ladder(f) : '';
  const found = f.found && f.found.length ? `<span class="found">${ic('pin', 13)} ${esc(f.found.join(', '))} found · will be removed</span>` : '';
  const warn = f.warning ? `<span class="warnline">${ic('alert', 13)} ${esc(f.warning)}</span>` : '';
  return `<div class="file" data-file="${i}">
    <div class="th">${f.thumb ? `<img src="${f.thumb}" alt="">` : ic('film', 26)}</div>
    <div style="min-width:0"><b>${esc(f.name)}</b>
      <div class="sub"><span>${bytes(f.size)}</span>${f.duration ? `<span>${dur(f.duration)}</span>` : ''}
        ${!live ? `<button class="timechip" data-edittime="${i}" title="When this was filmed — tap to correct">${ic('clock', 13)} ${f.preparing ? 'Reading…' : esc(fmtLocal(f.captured))}${f.ts === 'file' ? ' ≈' : ''}</button>` : `<span>${ic('clock', 13)} ${esc(fmtLocal(f.captured))}</span>`}
        ${!live ? found + warn : ''}${f.shao && live ? `<span class="mono" title="${f.shao}">#${f.shao.slice(0, 10)}…</span>` : ''}</div>
      ${!live ? `<input class="fnote" data-note="${i}" maxlength="500" placeholder="What does it show? (optional)" value="${esc(f.note)}">` : ''}
    </div>
    ${!live ? `<button class="iconbtn rm" data-rm="${i}" aria-label="Remove ${esc(f.name)}">${ic('x', 16)}</button>` : `<span class="mono" style="font-weight:700">${f.phase === 'done' ? f.record : f.phase === 'dupe' ? 'Already in' : f.phase === 'error' ? '' : Math.floor(f.pct) + '%'}</span>`}
    ${live ? `<div class="bar"><i style="width:${f.phase === 'hash' ? 0 : f.pct}%"></i></div>${status}` : ''}
  </div>`;
}
function ladder(f) {
  if (f.phase === 'error') return `<div class="ladder"><span class="bad">${ic('alert', 12, 3)}${esc(f.error)}</span>${U.running ? '' : `<button class="link" data-retry="${U.files.indexOf(f)}">Try again</button>`}</div>`;
  if (f.phase === 'dupe') return `<div class="ladder"><span class="ok">${ic('check', 12, 3)}This exact file is already on record as <b class="mono">${esc(f.record)}</b></span></div>`;
  const hashed = f.shao || f.phase === 'up' || f.phase === 'done';
  return `<div class="ladder">
    <span class="${hashed ? 'ok' : f.phase === 'hash' ? 'now' : ''}">${hashed ? ic('check', 12, 3) : ''}Fingerprinted${f.phase === 'hash' ? ` ${Math.round(f.hashPct * 100)}%` : ''}</span>
    <span class="${f.phase === 'done' ? 'ok' : f.phase === 'up' ? 'now' : ''}">${f.phase === 'done' ? ic('check', 12, 3) : ''}${f.phase === 'up' ? `Uploading ${Math.floor(f.pct)}%` : f.phase === 'done' ? 'Uploaded' : 'Upload'}</span>
    <span class="${f.phase === 'done' ? 'ok' : ''}">${f.phase === 'done' ? ic('check', 12, 3) : ''}Received</span>
    <span class="${f.phase === 'done' ? 'now' : ''}">${f.status === 'published' ? 'Public' : 'In review'}</span></div>`;
}
function step2() {
  const total = U.files.reduce((s, f) => s + f.size, 0);
  const found = [...new Set(U.files.flatMap((f) => f.found || []))];
  const unchecked = U.files.filter((f) => f.warning);
  const mins = Math.max(1, Math.round(total / 1048576 / 60));
  return [`<div class="vstack">
      <div class="toggle on locked"><span class="ic" style="background:#ff7a1a22;color:#ff7a1a">${ic('pin', 24)}</span><span class="tx"><b>Location & phone details removed</b><span>${found.length ? `Found in your videos: ${esc(found.join(', '))}. Removed on this device before anything is sent.` : 'No hidden location or phone details found. Checked on this device.'}</span></span><span class="sw" aria-hidden="true"></span></div>
      ${unchecked.length ? `<div class="netnote warn">${ic('alert', 18)}<span>${plural(unchecked.length, 'file')} couldn’t be checked: ${esc(unchecked.map((f) => f.name).join(', '))}. ${esc(unchecked[0].warning)}</span></div>` : ''}
      <div class="toggle on locked"><span class="ic" style="background:#7c5cff22;color:#7c5cff">${ic('user', 24)}</span><span class="tx"><b>Anonymous</b><span>No name, no account, no phone number. Your IP address isn’t stored.</span></span><span class="sw" aria-hidden="true"></span></div>
      <button class="toggle ${U.sensitive ? 'on' : ''}" data-up="sensitive" role="switch" aria-checked="${U.sensitive}" style="text-align:left"><span class="ic" style="background:#12b88622;color:#12b886">${ic('eyeoff', 24)}</span><span class="tx"><b>Shows injury or violence</b><span>Viewers see a warning and tap to watch.</span></span><span class="sw"></span></button>
    </div>
    <button class="consent ${U.consent ? 'on' : ''}" data-up="consent" style="width:100%;text-align:left" role="checkbox" aria-checked="${U.consent}"><span class="box">${U.consent ? ic('check', 16, 3) : ''}</span><span>I filmed these, or the person who did agreed. They will be public and kept permanently, and others may reuse them with credit (<a href="/policy" target="_blank">CC BY 4.0</a>).</span></button>
    <div class="summary"><div><b>${U.files.length}</b><span>${U.files.length === 1 ? 'video' : 'videos'}</span></div><div><b>${bytes(total)}</b><span>data</span></div><div><b>~${mins} min</b><span>on mobile data</span></div></div>
    ${config.storage === false ? `<div class="netnote warn">${ic('alert', 18)}<span>Uploads aren’t switched on for this site yet.</span></div>` : ''}`,
  `<span class="hint">${U.consent ? '' : 'Tick the box to upload'}</span><div style="display:flex;gap:8px"><button class="btn btn-ghost" data-up="back">Back</button><button class="btn btn-accent btn-lg" data-up="go" ${U.consent && config.storage !== false ? '' : 'disabled'}>${ic('upload', 18)}Upload ${U.files.length} · ${bytes(total)}</button></div>`];
}
function step3() {
  return [`<div id="netnote">${U.net ? `<div class="netnote">${ic('wifi', 18)}Connection lost — it will continue by itself.</div>` : ''}</div>
    ${U.token ? receiptCard() : ''}
    <div class="files live" id="filelist">${U.files.map(fileRow).join('')}</div>`,
  `<span class="hint">${ic('phone', 14)} Keep this screen open — or use Pocket mode.</span><div style="display:flex;gap:8px"><button class="btn btn-ghost" data-up="pause">${U.paused ? ic('play', 15) + 'Resume' : ic('pause', 15) + 'Pause'}</button><button class="btn btn-primary" data-up="pocket">${ic('phone', 16)}Pocket mode</button></div>`];
}
const receiptCard = () => `<div class="card" style="display:flex;gap:14px;align-items:center;margin-bottom:14px;padding:16px">${ic('receipt', 22)}<div style="flex:1;min-width:0"><b>Your private receipt</b><p style="margin:2px 0 0">Save it now, while the upload runs. It’s the only way to remove your videos later.</p></div><button class="btn btn-ghost btn-sm" data-up="copyreceipt">${ic('copy', 15)}Copy link</button></div>`;
function step4() {
  const ok = U.files.filter((f) => f.phase === 'done');
  const failed = U.files.filter((f) => f.phase === 'error');
  const pending = ok.some((f) => f.status === 'pending');
  return [`<div class="done"><div class="check"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div>
      <h3>${ok.length ? `${plural(ok.length, 'video')} · safe on record` : 'Nothing new uploaded'}</h3>
      <p>${pending ? 'A moderator checks every video before it goes public — usually within a few hours.' : ok.length ? 'Your videos are public now.' : ''}${failed.length ? ` ${plural(failed.length, 'file')} didn’t upload — try again below.` : ''}</p>
      ${failed.length ? `<div class="files live" style="width:100%">${failed.map(fileRow).join('')}</div>` : ''}
      ${U.token ? `<div class="receipt"><div class="recs">${U.files.filter((f) => f.record).map((f) => `<div><span>${esc(f.name.length > 28 ? f.name.slice(0, 26) + '…' : f.name)}</span><b>${f.record}</b></div>`).join('')}
        <div style="background:transparent;padding:6px 0 0;flex-direction:column;align-items:stretch"><b style="font-family:var(--font-ui)">Your private receipt</b><span style="color:var(--muted);font-size:13px">Save this link. It’s the only way to remove your videos later. It’s also saved on this device under “My uploads”.</span><div class="privlink"><input readonly value="${esc(receiptLink())}" aria-label="Receipt link"><button class="btn btn-primary btn-sm" data-up="copyreceipt" aria-label="Copy receipt link">${ic('copy', 15)}</button></div></div></div>
        <div class="qrbox" id="receiptqr"></div></div>` : ''}
    </div>`,
  `<button class="btn btn-ghost" data-up="more">${ic('plus', 16)}Upload more</button><a class="btn btn-primary" href="/e/${U.ev.slug}">View event ${ic('arrow', 16)}</a>`];
}
const receiptLink = () => `${origin()}/receipt#${U.token}`;
const fmtLocal = (d) => (d ? `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '');
function refreshFiles() {
  const el = $('#filelist'); if (el) el.innerHTML = U.files.map(fileRow).join('');
  const pp = $('#pocketpct');
  if (pp) { const tot = U.files.reduce((s, f) => s + f.size, 0) || 1; pp.textContent = Math.floor(U.files.reduce((s, f) => s + (f.phase === 'done' || f.phase === 'dupe' ? f.size : (f.pct / 100) * f.size), 0) / tot * 100) + '%'; }
}

/* ---------- step bindings ---------- */
function bindPicker() {
  const inp = $('#upq'); if (!inp) return;
  let t = null;
  inp.addEventListener('input', () => { U.query = inp.value; clearTimeout(t); t = setTimeout(() => loadEvents(U.query.trim()), 220); });
}
function bindFiles() {
  const d = $('#drop'), inp = $('#fileinput');
  ['dragenter', 'dragover'].forEach((e) => d.addEventListener(e, (x) => { x.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => d.addEventListener(e, (x) => { x.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  inp.addEventListener('change', () => { addFiles(inp.files); inp.value = ''; });
  const other = $('#placeother');
  if (other) other.addEventListener('input', () => { U.place = other.value.trim(); $$('#placechips button').forEach((b) => b.classList.toggle('on', b.dataset.placename === U.place)); });
}
function addFiles(list) {
  for (const file of Array.from(list)) {
    if (!(file.type.startsWith('video/') || VIDEO_EXT.test(file.name))) { toast(`${file.name} isn’t a video`, 'alert'); continue; }
    if (file.size > config.maxFileBytes) { toast(`${file.name} is over ${bytes(config.maxFileBytes)}`, 'alert'); continue; }
    if (U.files.some((f) => f.name === file.name && f.size === file.size)) continue;
    if (U.files.length >= 50) { toast('Up to 50 videos at a time', 'alert'); break; }
    const f = { file, name: file.name, size: file.size, mime: file.type, captured: new Date(file.lastModified || Date.now()), ts: 'file', note: '', found: [], patches: [], warning: null, thumb: null, poster: null, duration: null, width: null, height: null, preparing: true, phase: 'ready', pct: 0, hashPct: 0 };
    U.files.push(f);
    prepare(f);
  }
  draw();
}
async function prepare(f) {
  const [meta, shot] = await Promise.all([inspect(f.file), grab(f.file).catch(() => null)]);
  Object.assign(f, { found: meta.found || [], patches: meta.patches || [], warning: meta.warning || null });
  if (meta.captured) { f.captured = meta.captured; f.ts = 'metadata'; }
  f.duration = (shot && shot.duration) || meta.duration || null;
  f.width = (shot && shot.width) || meta.width || null;
  f.height = (shot && shot.height) || meta.height || null;
  if (shot) { f.thumb = shot.thumb; f.poster = shot.poster; }
  f.preparing = false;
  if (U && U.step === 1) draw();
}
// Thumbnail for the list and a poster image for the archive, from a frame about 1 s in.
function grab(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video'); const url = URL.createObjectURL(file);
    v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = url;
    const done = (fn, x) => { clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); fn(x); };
    const timer = setTimeout(() => done(reject, new Error('timeout')), 12000);
    v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 4); });
    v.addEventListener('seeked', () => {
      try {
        const w = v.videoWidth, h = v.videoHeight; if (!w || !h) throw new Error('no frame');
        const draw2 = (W) => { const c = document.createElement('canvas'); c.width = W; c.height = Math.round((h / w) * W); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return c; };
        const thumb = draw2(176).toDataURL('image/jpeg', 0.7);
        draw2(Math.min(720, w)).toBlob((blob) => done(resolve, { thumb, poster: blob, duration: v.duration, width: w, height: h }), 'image/jpeg', 0.82);
      } catch (e) { done(reject, e); }
    }, { once: true });
    v.addEventListener('error', () => done(reject, new Error('decode')));
  });
}

/* ---------- engine ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntilReady() {
  while (U && (U.paused || !navigator.onLine)) await sleep(400);
}
function setNet(lost) {
  if (!U || U.net === lost) return;
  U.net = lost;
  const n = $('#netnote'); if (n) n.innerHTML = lost ? `<div class="netnote">${ic('wifi', 18)}Connection lost — it will continue by itself.</div>` : '';
}
function putPart(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        const etag = x.getResponseHeader('ETag');
        if (!etag) reject(Object.assign(new Error('Storage did not return an ETag — the bucket’s CORS rules must expose the ETag header.'), { fatal: true }));
        else resolve(etag);
      } else reject(Object.assign(new Error(`Storage error ${x.status}`), { status: x.status }));
    };
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.timeout = 10 * 60 * 1000;
    x.send(blob);
  });
}

async function run() {
  U.running = true; U.step = 3;
  U.files.sort((a, b) => a.size - b.size); // smallest first, so something is safe sooner
  draw();
  for (const f of U.files) {
    if (['done', 'dupe'].includes(f.phase)) continue;
    try { await uploadOne(f); } catch (e) { f.phase = 'error'; f.error = e.message || 'Upload failed'; }
    refreshFiles();
  }
  U.running = false; setNet(false);
  $('#pocket').classList.remove('on');
  invalidate(U.ev.slug);
  saveReceipt();
  U.step = 4; draw();
}
async function uploadOne(f) {
  f.phase = 'hash'; f.error = null; refreshFiles();
  if (!f.shao) {
    let last = 0;
    const h = await fingerprint(f.file, f.patches, (p) => { f.hashPct = p; if (Date.now() - last > 150) { last = Date.now(); refreshFiles(); } });
    f.shao = h.original; f.sha = h.stored;
  }
  await waitUntilReady();
  const start = await api('/api/uploads/start', { body: {
    event: U.ev.slug, token: U.token, place: U.place, sensitive: U.sensitive,
    file: { name: f.name, size: f.size, mime: f.mime, sha256: f.sha, sha256o: f.shao, captured: f.captured.toISOString(), ts: f.ts, duration: f.duration, width: f.width, height: f.height, stripped: f.found, note: f.note },
  } });
  if (start.duplicate) { f.phase = 'dupe'; f.record = start.duplicate; f.pct = 100; return; }
  if (start.token) { U.token = start.token; saveReceipt(); if (U.step === 3) draw(); }
  f.clip = start.clip; f.phase = 'up'; f.pct = 0; refreshFiles();
  let posterOk = false;
  if (f.poster) { try { posterOk = (await fetch(start.posterUrl, { method: 'PUT', body: f.poster })).ok; } catch { /* poster is optional */ } }

  const blob = patched(f.file, f.patches);
  const n = Math.max(1, Math.ceil(f.size / PART));
  const etags = new Array(n); const loaded = new Array(n).fill(0); const urls = {};
  let next = 1; let lastDraw = 0;
  const progress = () => { f.pct = Math.min(99.5, (loaded.reduce((s, x) => s + x, 0) / f.size) * 100); if (Date.now() - lastDraw > 200) { lastDraw = Date.now(); refreshFiles(); } };
  const fetchUrls = async (from) => {
    const want = []; for (let i = from; i <= n && want.length < 60; i++) if (!etags[i - 1] && !urls[i]) want.push(i);
    const r = await api('/api/uploads/parts', { body: { token: U.token, clip: f.clip, parts: want } });
    Object.assign(urls, r.urls);
  };
  const doPart = async (i) => {
    for (let attempt = 0; ; attempt++) {
      await waitUntilReady();
      try {
        if (!urls[i]) await fetchUrls(i);
        const from = (i - 1) * PART;
        etags[i - 1] = await putPart(urls[i], blob.slice(from, Math.min(f.size, from + PART)), (b) => { loaded[i - 1] = b; progress(); });
        loaded[i - 1] = Math.min(PART, f.size - from); progress(); setNet(false);
        return;
      } catch (e) {
        if (e.fatal) throw e;
        if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) { delete urls[i]; if (attempt > 3) throw new Error('Storage refused the upload'); }
        loaded[i - 1] = 0; progress(); setNet(true);
        await sleep(Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
      }
    }
  };
  const worker = async () => { while (next <= n) { const i = next++; await doPart(i); } };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, n) }, worker));
  let done;
  for (let attempt = 0; ; attempt++) {
    try { done = await api('/api/uploads/complete', { body: { token: U.token, clip: f.clip, parts: etags.map((etag, k) => ({ n: k + 1, etag })), poster: posterOk } }); break; }
    catch (e) { if (e.status || attempt > 5) throw e; setNet(true); await sleep(2000 * (attempt + 1)); await waitUntilReady(); }
  }
  f.record = done.record; f.status = done.status; f.phase = 'done'; f.pct = 100;
}
function saveReceipt() {
  if (!U || !U.token) return;
  const list = store.get('roe.receipts', []);
  const count = U.files.filter((f) => f.phase === 'done').length;
  const i = list.findIndex((x) => x.token === U.token);
  const item = { token: U.token, slug: U.ev.slug, title: U.ev.title, color: U.ev.color, at: i >= 0 ? list[i].at : new Date().toISOString(), count };
  if (i >= 0) list[i] = item; else list.unshift(item);
  store.set('roe.receipts', list.slice(0, 50));
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  if (!U || !$('#upmodal')) return;
  const t = e.target.closest('[data-up],[data-pick],[data-rm],[data-placename],[data-edittime],[data-retry]');
  if (!t) return;
  if (t.dataset.pick) { const ev = (U.events || []).find((x) => x.slug === t.dataset.pick); if (ev) { pickEvent(ev.slug); } return; }
  if (t.dataset.rm) { U.files.splice(+t.dataset.rm, 1); draw(); return; }
  if (t.dataset.placename) { U.place = U.place === t.dataset.placename ? '' : t.dataset.placename; $$('#placechips button').forEach((b) => b.classList.toggle('on', b.dataset.placename === U.place)); const o = $('#placeother'); if (o) o.value = ''; return; }
  if (t.dataset.edittime) { editTime(t, U.files[+t.dataset.edittime]); return; }
  if (t.dataset.retry) { const f = U.files[+t.dataset.retry]; if (f) { f.phase = 'ready'; f.pct = 0; run(); } return; }
  switch (t.dataset.up) {
    case 'next': U.step++; draw(); break;
    case 'back': U.step--; draw(); break;
    case 'change': U.step = 0; draw(); if (!U.events) loadEvents(); break;
    case 'sensitive': U.sensitive = !U.sensitive; draw(); break;
    case 'consent': if (e.target.closest('a')) return; U.consent = !U.consent; draw(); break;
    case 'go': run(); break;
    case 'pause': U.paused = !U.paused; draw(); break;
    case 'pocket': $('#pocket').classList.add('on'); refreshFiles(); break;
    case 'copyreceipt': copy(receiptLink(), 'Receipt link copied'); break;
    case 'more': { const slug = U.ev.slug; U = null; openUpload(slug); break; }
    default: break;
  }
});
document.addEventListener('input', (e) => { if (U && e.target.dataset && e.target.dataset.note !== undefined) U.files[+e.target.dataset.note].note = e.target.value; });
async function pickEvent(slug) {
  try { const d = await api(`/api/events/${slug}`); U.ev = d.event; draw(); }
  catch (e) { toast(e.message, 'alert'); }
}
function editTime(btn, f) {
  const p = (n) => String(n).padStart(2, '0');
  const d = f.captured;
  const inp = document.createElement('input');
  inp.type = 'datetime-local'; inp.step = 1; inp.className = 'timeedit';
  inp.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  btn.replaceWith(inp); inp.focus();
  const commit = () => { const v = new Date(inp.value); if (!isNaN(v)) { f.captured = v; f.ts = 'manual'; } draw(); };
  inp.addEventListener('change', commit); inp.addEventListener('blur', commit, { once: true });
}
window.addEventListener('beforeunload', (e) => { if (uploadBusy()) { e.preventDefault(); e.returnValue = ''; } });
