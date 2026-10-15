// Clip player. Larger screens get the two-column player; phones get a vertical "reels" feed.
// main.js opens it with openPlayer(), calls closePlayer() from closeOverlay() and routes keys via playerKey().
import {
  $, ic, esc, dur, bytes, fmtTime, fmtDay, fmtDate, tzName, badge, toast, copy, share, origin, store, config,
  posterOf, videoOf, downloadOf,
} from './util.js';
import { openOverlay, openReport } from './main.js';

let P = null; // open player: { ev, clips, i, reel, root, ref, revealed, failed, seekTo, muted, off[], ... }

const isPhone = () => matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1000px)').matches);
const cur = () => P.clips[P.i];
const active = () => (P.reel ? P.vids.get(P.i) : P.video) || null;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); P.off.push(() => el.removeEventListener(type, fn, opts)); };
function unload(v) { if (!v) return; v.pause(); v.removeAttribute('src'); v.load(); }
function setMeta(c, url) {
  if (url) history.replaceState(null, '', '/r/' + c.r);
  document.title = `${c.r} · ${P.ev.title} · ${config.name}`;
}
function applySeek(v, c) {
  const s = P.seekTo.get(c.r); if (s == null) return;
  P.seekTo.delete(c.r);
  v.currentTime = Math.min(s, Math.max(0, (v.duration || s + 1) - 0.5));
}
function anglesOf(c) {
  let a = P.ang.get(c.r);
  if (!a) {
    a = P.clips.filter((x) => x.r !== c.r && !x.x && x.lm <= c.end + 5 && x.end >= c.lm - 5).sort((x, y) => x.lm - y.lm).slice(0, 8);
    P.ang.set(c.r, a);
  }
  return a;
}
// Pointer seek on a bar: rect read once per drag, moves coalesced to one rAF. Listeners live on the bar itself.
function bindSeek(el, after) {
  let r = null, x = 0, raf = 0;
  const apply = () => { raf = 0; const v = P && active(); if (!v || !v.duration || !r) return; v.currentTime = clamp01((x - r.left) / r.width) * v.duration; after(); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    r = el.getBoundingClientRect(); x = e.clientX;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.add('drag'); apply();
  });
  el.addEventListener('pointermove', (e) => { if (!r) return; x = e.clientX; if (!raf) raf = requestAnimationFrame(apply); });
  const end = () => { if (!r) return; if (raf) cancelAnimationFrame(raf); apply(); r = null; el.classList.remove('drag'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
}

/* ---------- public API ---------- */
export function openPlayer({ ev, clips, rec, t = 0 }) {
  closePlayer();
  const list = clips || [];
  const i = list.findIndex((x) => x.r === rec);
  if (i < 0 || !ev) return false;
  P = { ev, clips: list, i, reel: isPhone(), ref: {}, revealed: new Set(), failed: new Set(), seekTo: new Map(), ang: new Map(), muted: !!store.get('roe.muted', false), off: [] };
  if (Number(t) > 0) P.seekTo.set(rec, Number(t));
  if (P.reel) openReel(); else openDesk();
  on(P.root, 'click', onClick);
  setMeta(list[i]);
  return true;
}
export function closePlayer() {
  if (!P) return;
  const p = P; P = null;
  if (p.io) p.io.disconnect();
  p.off.forEach((f) => f());
  unload(p.video);
  if (p.vids) p.vids.forEach(unload);
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (fs && exit && p.root && p.root.contains(fs)) Promise.resolve(exit.call(document)).catch(() => {});
}
export function isPlayerOpen() {
  if (P && !P.root.isConnected) closePlayer(); // replaced by another overlay
  return !!P;
}
export function playerKey(e) {
  if (!isPlayerOpen() || e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = document.activeElement;
  if (el && (/input|textarea|select/i.test(el.tagName) || el.isContentEditable)) return false;
  const k = e.key; const v = active();
  if (k === 'Escape') { if (P.sheet) { closeSheet(); return true; } return false; }
  if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); return true; }
  if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); if (v) { v.currentTime = Math.max(0, v.currentTime + (k === 'ArrowRight' ? 5 : -5)); tick(); } return true; }
  if (k === 'm') { toggleMute(); return true; }
  if (k === ']' || k === 'ArrowDown') { e.preventDefault(); step(1); return true; }
  if (k === '[' || k === 'ArrowUp') { e.preventDefault(); step(-1); return true; }
  return false;
}

/* ---------- shared actions ---------- */
function onClick(e) {
  if (!P) return;
  const t = e.target.closest('[data-action],[data-angle]');
  if (!t || !P.root.contains(t)) return;
  const act = t.dataset.angle ? 'angle' : t.dataset.action;
  const c = cur();
  const mine = () => e.stopPropagation(); // keep main.js's document handler out of player actions
  switch (act) {
    case 'ptoggle': mine(); toggle(); break;
    case 'rtap': mine(); if (Number(t.closest('.rl-slide').dataset.i) === P.i) toggle(); break;
    case 'pmute': mine(); toggleMute(); break;
    case 'sound': { mine(); setMuted(false); const v = active(); if (v && v.paused && !P.userPaused) v.play().catch(() => {}); break; }
    case 'pfull': mine(); fullscreen(); break;
    case 'reveal': mine(); reveal(); break;
    case 'pprev': mine(); step(-1); break;
    case 'pnext': mine(); step(1); break;
    case 'angle': mine(); toAngle(t.dataset.angle); break;
    case 'copyid': mine(); copy(c.r, 'Record number copied'); break;
    case 'copyhash': mine(); copy(c.sha, 'Fingerprint copied'); break;
    case 'shareat': { mine(); const v = active(); const s = Math.floor(v ? v.currentTime : 0); share(`${origin()}/r/${c.r}${s ? '?t=' + s : ''}`, c.r); break; }
    case 'cite': mine(); copy(`${config.name}, ${c.r}, filmed ${fmtDate(P.ev.date)} ${fmtTime(c.lm, true)} ${tzName(P.ev.tz, c.t)}${c.place ? ', ' + c.place : ''} (${P.ev.title}). SHA-256 ${c.sha}. ${origin()}/r/${c.r}`, 'Citation copied'); break;
    case 'report': mine(); closePlayer(); openReport({ record: c.r }); break;
    case 'info': case 'angles': mine(); openSheet(act); break;
    case 'sheetclose': mine(); closeSheet(); break;
    default: break; // 'close' and plain links are main.js's
  }
}
function toggle() {
  const v = active(); if (!v) return;
  if (v.paused) { P.userPaused = false; v.play().catch(() => {}); } else { P.userPaused = true; v.pause(); }
}
function setMuted(m) {
  P.muted = m; P.forced = false; store.set('roe.muted', m);
  if (P.reel) P.vids.forEach((v) => { v.muted = m; }); else if (P.video) P.video.muted = m;
  syncMute();
}
function toggleMute() { const v = active(); setMuted(!(v ? v.muted : P.muted)); }
function syncMute() {
  const v = active(); const m = v ? v.muted : P.muted;
  const b = P.root.querySelector('[data-action="pmute"]');
  if (b) { b.innerHTML = ic(m ? 'mute' : 'sound', 20); b.setAttribute('aria-label', m ? 'Unmute' : 'Mute'); }
  if (P.ref.chip) P.ref.chip.hidden = !(P.forced && m);
}
function step(d) {
  const k = P.i + d; if (k < 0 || k >= P.clips.length) return;
  if (P.reel) goSlide(k, true); else switchDesk(k, false);
}
function reveal() {
  P.revealed.add(cur().r);
  if (!P.reel) { drawDesk(true); return; }
  refill(P.i); attach(P.i); prepActive(); playActive();
}
// Jump to another angle, keeping the same wall-clock moment.
function toAngle(rec) {
  const k = P.clips.findIndex((x) => x.r === rec); if (k < 0) return;
  const c = cur(); const v = active(); const nc = P.clips[k];
  const wall = c.lm + (v ? v.currentTime : 0) / 60;
  P.seekTo.set(nc.r, Math.max(0, (wall - nc.lm) * 60));
  if (P.reel) { closeSheet(); goSlide(k, false); } else switchDesk(k, true, !!v && !v.paused);
  toast('Switched angle — same moment', 'layers');
}
function tick() { if (P) (P.reel ? tickReel : tickDesk)(); }
function infoHtml(c) {
  const ev = P.ev;
  const steps = { unverified: 2, consistent: 3, verified: 4, disputed: 2 }[c.s] || 2;
  const src = { metadata: 'from the video file', file: 'from the file date — approximate', manual: 'set by the uploader', moderator: 'corrected by a moderator' }[c.ts] || '';
  const edited = (k) => (c.ed || []).includes(k);
  return `
    <div class="rid"><b>${c.r}</b><button class="btn btn-sm" style="background:rgba(255,255,255,.07)" data-action="copyid">${ic('copy', 15)}Copy</button></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${badge(c.s)}${c.x ? `<span class="badge disputed">${ic('eyeoff', 13)}Sensitive</span>` : ''}</div>
    <div class="verifyline" title="Received · Reviewed · Place checked · Verified">${[1, 2, 3, 4].map((k) => `<i class="${k <= steps ? 'on' : ''}"></i>`).join('')}</div>
    <h3>${c.place ? esc(c.place) + ' · ' : ''}${fmtTime(c.lm)}</h3>
    <dl class="kv">
      <dt>Filmed</dt><dd>${fmtDay(c.lm)}, ${fmtTime(c.lm, true)} ${tzName(ev.tz, c.t)}<small>${src}</small></dd>
      ${c.place ? `<dt>Place</dt><dd>${esc(c.place)}<small>${edited('place') ? 'corrected by a moderator' : 'chosen by the uploader'}</small></dd>` : ''}
      <dt>Event</dt><dd><a href="/e/${ev.slug}" style="text-decoration:underline;text-underline-offset:3px">${esc(ev.title)}</a></dd>
      <dt>File</dt><dd>${c.w && c.h ? `${c.w}×${c.h} · ` : ''}${dur(c.d)} · ${bytes(c.z)}<small>${c.stripped && c.stripped.length ? 'Original file; hidden location/phone details removed before upload' : 'Original file, unchanged'}</small></dd>
      <dt>Licence</dt><dd>CC BY 4.0 · Anonymous</dd>
    </dl>
    ${c.n ? `<div class="note"><small>Uploader’s note${edited('note') ? ' · edited by a moderator' : ''}</small>“${esc(c.n)}”</div>` : ''}
    <div><div class="hlabel">Fingerprint · SHA-256</div><div class="hash">${ic('hash', 15)}<span>${c.sha}</span><button data-action="copyhash" aria-label="Copy fingerprint">${ic('copy', 15)}</button></div>
    ${c.sho && c.sho !== c.sha ? `<div class="hlabel" style="margin-top:8px">Before details were removed (uploader’s copy)</div><div class="hash">${ic('hash', 15)}<span>${c.sho}</span></div>` : ''}</div>
    <div class="actions2">
      <a class="btn primary" href="${esc(downloadOf(c))}" data-native>${ic('download', 17)}Download original · ${bytes(c.z)}</a>
      <button class="btn" data-action="shareat">${ic('share', 16)}<span data-shareat>Share at 0:00</span></button>
      <button class="btn" data-action="cite">${ic('quote', 16)}Cite</button>
      <button class="btn" data-action="report" style="grid-column:1/-1;color:#ff8f87">${ic('flag', 16)}Report a problem</button>
    </div>`;
}
const failHtml = (c, cls) => `<div class="${cls}"${cls === 'vidfail' ? ' hidden' : ''}>${ic('alert', 26)}<b>This browser can’t play this file format</b><span>Download the original to watch it.</span><a class="btn btn-primary btn-sm" href="${esc(downloadOf(c))}" data-native>${ic('download', 15)}Download original</a></div>`;
const gateHtml = (cls) => `<button class="${cls}" data-action="reveal">${ic('eyeoff', 34)}<b>Sensitive</b><span>May show injury or violence. Tap to view.</span></button>`;

/* ---------- desktop player ---------- */
function openDesk() {
  openOverlay(`<div class="player" data-player role="dialog" aria-modal="true" aria-label="${esc(cur().r)}" style="--accent:${esc(P.ev.color)}">
    <div class="stagecol"><div class="stage"></div><div class="controls"></div><div class="angles"></div></div>
    <div class="info"></div></div>`);
  P.root = $('[data-player]');
  drawDesk(false);
}
function drawDesk(autoplay) {
  const c = cur(); const ev = P.ev; const root = P.root; const n = P.clips.length;
  const rev = !c.x || P.revealed.has(c.r);
  unload(P.video); P.video = null;
  root.setAttribute('aria-label', c.r);
  const stage = $('.stage', root);
  stage.innerHTML = `
    ${rev ? `<video playsinline preload="metadata" ${c.img ? `poster="${esc(posterOf(c))}"` : ''} src="${esc(videoOf(c))}"></video>` : c.img ? `<img class="frame blur" src="${esc(posterOf(c))}" alt="">` : ''}
    <div class="wall"><b>${fmtTime(c.lm + (P.seekTo.get(c.r) || 0) / 60, true)}</b><span>${tzName(ev.tz, c.t)} · filmed time</span></div>
    <button class="iconbtn close" data-action="close" aria-label="Close">${ic('x', 20)}</button>
    ${P.i > 0 ? `<button class="iconbtn navbtn prev" data-action="pprev" aria-label="Previous clip">${ic('left', 22)}</button>` : ''}
    ${P.i < n - 1 ? `<button class="iconbtn navbtn next" data-action="pnext" aria-label="Next clip">${ic('right', 22)}</button>` : ''}
    ${rev ? `<button class="bigplay" data-action="ptoggle" aria-label="Play">${ic('play', 34)}</button>${failHtml(c, 'vidfail')}` : gateHtml('sensgate')}`;
  const v = $('video', stage);
  P.video = v;
  const box = $('.controls', root);
  box.innerHTML = `
    <button class="iconbtn" data-action="ptoggle" aria-label="Play" ${v ? '' : 'disabled'}>${ic('play', 20)}</button>
    <span class="t mono">0:00 / ${dur(c.d)}</span>
    <div class="seek" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuemax="${Math.round(c.d || 0)}" aria-valuenow="0"><i></i></div>
    <button class="iconbtn" data-action="pmute" aria-label="Mute">${ic('sound', 20)}</button>
    <button class="iconbtn" data-action="pfull" aria-label="Fullscreen">${ic('full', 20)}</button>`;
  const ang = anglesOf(c);
  $('.angles', root).innerHTML = `<h5>${ic('layers', 15)}${ang.length ? `Other angles at this moment · ${ang.length}` : 'No other angles yet'}</h5>
    <div class="strip">${ang.map((a, k) => { const off = Math.round((a.lm - c.lm) * 60); return `<button class="angle" data-angle="${a.r}">${a.img ? `<img src="${esc(posterOf(a))}" alt="" loading="lazy">` : '<span class="noimg sm"></span>'}<em>${String.fromCharCode(66 + k)}</em><span>${off >= 0 ? '+' : '−'}${dur(Math.abs(off))}${a.place ? ' · ' + esc(a.place) : ''}</span></button>`; }).join('')}</div>`;
  const info = $('.info', root);
  info.innerHTML = infoHtml(c);
  info.scrollTop = 0;
  const seek = $('.seek', box);
  P.ref = { wall: $('.wall b', stage), fill: $('i', seek), time: $('.t', box), seek, share: $('[data-shareat]', info), play: $('[data-action="ptoggle"]', box), big: $('.bigplay', stage), fail: $('.vidfail', stage) };
  bindSeek(seek, tickDesk);
  if (v) v.muted = P.muted;
  syncMute();
  if (!v) return;
  const mine = () => P && P.video === v;
  v.addEventListener('loadedmetadata', () => { if (!mine()) return; applySeek(v, c); tickDesk(); });
  v.addEventListener('timeupdate', () => { if (mine()) tickDesk(); });
  v.addEventListener('play', () => { if (mine()) syncDesk(); });
  v.addEventListener('pause', () => { if (mine()) syncDesk(); });
  v.addEventListener('error', () => { if (!mine() || !v.getAttribute('src')) return; P.ref.fail.hidden = false; P.ref.big.classList.add('hide'); });
  if (autoplay) v.play().catch(() => {});
}
function syncDesk() {
  const v = P.video; const playing = !!v && !v.paused;
  const b = P.ref.play;
  if (b) { b.innerHTML = ic(playing ? 'pause' : 'play', 20); b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  if (P.ref.big) P.ref.big.classList.toggle('hide', playing);
}
function tickDesk() {
  const v = P.video; const R = P.ref; if (!v) return;
  const c = cur(); const t = v.currentTime || 0;
  R.wall.textContent = fmtTime(c.lm + t / 60, true);
  if (v.duration) R.fill.style.width = (t / v.duration) * 100 + '%';
  R.time.textContent = `${dur(t)} / ${dur(v.duration || c.d)}`;
  if (R.share) R.share.textContent = `Share at ${dur(t)}`;
  R.seek.setAttribute('aria-valuenow', Math.round(t));
}
function switchDesk(k, keepWall, play) {
  const v = P.video; const wasPlaying = play ?? (!!v && !v.paused);
  if (!keepWall) P.seekTo.delete(P.clips[k].r);
  P.i = k;
  setMeta(cur(), true);
  drawDesk(wasPlaying);
}
function fullscreen() {
  const s = $('.stage', P.root); const v = P.video;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if ((document.fullscreenElement || document.webkitFullscreenElement) && exit) { Promise.resolve(exit.call(document)).catch(() => {}); return; }
  const go = s && (s.requestFullscreen || s.webkitRequestFullscreen);
  if (v && v.webkitEnterFullscreen && !go) v.webkitEnterFullscreen(); // iOS: only the video element can go fullscreen
  else if (go) Promise.resolve(go.call(s)).catch(() => {});
}

/* ---------- phone reels feed ----------
   One full-screen slide per clip. Only slides within ±2 of the active one hold content, and only the
   active one and its neighbours hold a <video> (max 3, recycled from a pool). */
function openReel() {
  const showHint = P.clips.length > 1 && !store.get('roe.reelhint', false);
  openOverlay(`<div class="reels" data-player role="dialog" aria-modal="true" aria-label="Clips from ${esc(P.ev.title)}" style="--accent:${esc(P.ev.color)}">
    <div class="rl-feed">${P.clips.map((c, k) => `<div class="rl-slide" data-i="${k}"></div>`).join('')}</div>
    <div class="rl-top">
      <button class="rl-btn" data-action="close" aria-label="Close">${ic('x', 22)}</button>
      <div class="rl-clock"><b class="mono"></b><span></span></div>
      <button class="rl-btn" data-action="pmute" aria-label="Mute">${ic('sound', 20)}</button>
    </div>
    <button class="rl-chip" data-action="sound" hidden>${ic('sound', 16)}Tap for sound</button>
    ${showHint ? `<div class="rl-hint" aria-hidden="true">${ic('arrow', 18)}Swipe up for the next clip</div>` : ''}
    <div class="rl-prog" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuenow="0"><i></i><span class="rl-ptime mono"></span></div>
    <div class="rl-sheet" hidden><div class="rl-scrim" data-action="sheetclose"></div><div class="rl-panel" role="dialog" aria-modal="true" tabindex="-1"></div></div>
  </div>`);
  if (showHint) store.set('roe.reelhint', true);
  const root = $('[data-player]');
  P.root = root;
  P.feed = $('.rl-feed', root);
  P.slides = P.feed.children;
  P.vids = new Map(); P.pool = []; P.filled = new Set();
  const prog = $('.rl-prog', root);
  P.ref = { wall: $('.rl-clock b', root), sub: $('.rl-clock span', root), chip: $('.rl-chip', root), prog, fill: $('i', prog), ptime: $('.rl-ptime', prog), sheet: $('.rl-sheet', root), panel: $('.rl-panel', root), share: null, last: '' };
  bindSeek(prog, tickReel);
  const start = P.i; P.i = -1;
  setActive(start);
  // Jump to the start slide with no animation, then let an IntersectionObserver pick the active slide.
  const watch = () => {
    if (!P || P.root !== root) return;
    P.feed.scrollTop = P.slides[start].offsetTop;
    P.io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number(e.target.dataset.i));
    }, { root: P.feed, threshold: 0.6 });
    for (const s of P.slides) P.io.observe(s);
  };
  if (P.feed.clientHeight) watch(); else requestAnimationFrame(watch);
  on(document, 'visibilitychange', () => {
    if (!isPlayerOpen()) return;
    const v = active();
    if (document.hidden) { P.resume = !!v && !v.paused; P.vids.forEach((x) => x.pause()); } else if (P.resume) { P.resume = false; playActive(); }
  });
}
function slideHtml(c, k) {
  const ev = P.ev; const gated = c.x && !P.revealed.has(c.r); const na = anglesOf(c).length;
  return `<div class="rl-media" data-action="rtap">${c.img ? `<img class="rl-poster${gated ? ' blur' : ''}" src="${esc(posterOf(c))}" alt="" decoding="async">` : `<div class="noimg">${ic('film', 34)}</div>`}</div>
    <span class="rl-glyph" aria-hidden="true">${ic('play', 34)}</span><span class="rl-spin" aria-hidden="true"></span>
    ${gated ? gateHtml('rl-gate') : ''}${P.failed.has(c.r) ? failHtml(c, 'rl-fail') : ''}
    <div class="rl-meta">
      <div class="rl-when"><b class="mono">${fmtTime(c.lm, true)}</b><span>${fmtDay(c.lm)} · ${tzName(ev.tz, c.t)} · filmed time</span></div>
      ${c.place ? `<div class="rl-place">${ic('pin', 15)}${esc(c.place)}</div>` : ''}
      <div class="rl-tags">${badge(c.s)}<span class="rl-rec mono">${c.r}</span></div>
    </div>
    <div class="rl-rail">
      <button class="rl-act" data-action="info" aria-label="Details"><span class="rl-ico">${ic('info', 24)}</span>Info</button>
      <button class="rl-act" data-action="angles" aria-label="Other angles: ${na}"><span class="rl-ico">${ic('layers', 23)}${na ? `<em>${na}</em>` : ''}</span>Angles</button>
      <button class="rl-act" data-action="shareat" aria-label="Share at this moment"><span class="rl-ico">${ic('share', 23)}</span>Share</button>
      <a class="rl-act" href="${esc(downloadOf(c))}" data-native aria-label="Download original"><span class="rl-ico">${ic('download', 23)}</span>Save</a>
    </div>`;
}
function fill(k) {
  if (k < 0 || k >= P.clips.length || P.filled.has(k)) return;
  P.slides[k].innerHTML = slideHtml(P.clips[k], k);
  P.filled.add(k);
}
function unfill(k) { detach(k); P.slides[k].innerHTML = ''; P.slides[k].classList.remove('busy', 'paused'); P.filled.delete(k); }
function refill(k) { unfill(k); fill(k); }
function playable(c) { return (!c.x || P.revealed.has(c.r)) && !P.failed.has(c.r); }
function mkVideo() {
  const v = document.createElement('video');
  v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v._i = -1;
  const slide = () => (P && P.reel && v._i >= 0 ? P.slides[v._i] : null);
  v.addEventListener('loadedmetadata', () => { if (!slide()) return; applySeek(v, P.clips[v._i]); if (v._i === P.i) tickReel(); });
  v.addEventListener('timeupdate', () => { if (slide() && v._i === P.i) tickReel(); });
  v.addEventListener('waiting', () => { if (slide()) slide().classList.add('busy'); });
  for (const t of ['playing', 'canplay', 'pause']) v.addEventListener(t, () => { if (slide()) slide().classList.remove('busy'); });
  v.addEventListener('play', () => { if (slide()) slide().classList.remove('paused'); });
  v.addEventListener('pause', () => { if (slide() && v._i === P.i) slide().classList.add('paused'); });
  v.addEventListener('error', () => {
    if (!slide() || !v.getAttribute('src')) return;
    const k = v._i; P.failed.add(P.clips[k].r); refill(k);
    if (k === P.i) syncMute();
  });
  return v;
}
function attach(k) {
  if (k < 0 || k >= P.clips.length || P.vids.has(k) || !P.filled.has(k)) return;
  const c = P.clips[k]; if (!playable(c)) return;
  const v = P.pool.pop() || mkVideo();
  v._i = k;
  v.muted = P.muted || !!P.forced;
  v.preload = k === P.i ? 'auto' : 'metadata';
  if (c.img) v.poster = posterOf(c); else v.removeAttribute('poster');
  v.src = videoOf(c);
  $('.rl-media', P.slides[k]).appendChild(v);
  P.vids.set(k, v);
}
function detach(k) {
  const v = P.vids.get(k); if (!v) return;
  P.vids.delete(k); v._i = -1;
  unload(v); v.remove();
  P.pool.push(v);
}
function prepActive() {
  for (const [j, v] of P.vids) {
    v.preload = j === P.i ? 'auto' : 'metadata';
    if (j !== P.i && !v.paused) v.pause();
  }
  const v = P.vids.get(P.i);
  if (v && v.readyState >= 1) applySeek(v, cur());
}
function setActive(k) {
  if (!P || k === P.i || k < 0 || k >= P.clips.length) return;
  const prev = P.i; P.i = k; P.userPaused = false;
  closeSheet();
  for (const j of [...P.vids.keys()]) if (Math.abs(j - k) > 1) detach(j);
  for (let j = k - 2; j <= k + 2; j++) fill(j);
  for (const j of [...P.filled]) if (Math.abs(j - k) > 3) unfill(j);
  attach(k); attach(k - 1); attach(k + 1);
  prepActive();
  if (prev >= 0 && P.slides[prev]) P.slides[prev].classList.remove('on', 'paused');
  P.slides[k].classList.add('on');
  const c = cur();
  setMeta(c, prev >= 0);
  P.ref.sub.textContent = `${tzName(P.ev.tz, c.t)} · ${k + 1} of ${P.clips.length}`;
  P.ref.prog.setAttribute('aria-valuemax', Math.round(c.d || 0));
  P.ref.last = '';
  tickReel();
  playActive();
}
// Autoplay the active slide; if sound is refused (iOS after a swipe), retry muted and offer "Tap for sound".
function playActive() {
  const v = P.vids.get(P.i);
  if (!v || document.hidden) { syncMute(); return; }
  v.muted = P.muted || !!P.forced;
  const blocked = () => { if (P && P.vids.get(P.i) === v) P.slides[P.i].classList.add('paused'); };
  const p = v.play();
  if (p) {
    p.catch((err) => {
      if (!P || P.vids.get(P.i) !== v || !err || err.name !== 'NotAllowedError') return;
      if (v.muted) { blocked(); return; }
      v.muted = true; P.forced = true; syncMute();
      v.play().catch(blocked);
    });
  }
  syncMute();
}
function tickReel() {
  const R = P.ref; const c = cur(); const v = P.vids.get(P.i);
  const t = v ? v.currentTime || 0 : P.seekTo.get(c.r) || 0;
  const d = (v && v.duration) || c.d || 0;
  const w = fmtTime(c.lm + t / 60, true);
  if (w !== R.last) { R.last = w; R.wall.textContent = w; R.prog.setAttribute('aria-valuenow', Math.round(t)); if (R.share) R.share.textContent = `Share at ${dur(t)}`; }
  R.fill.style.transform = `scaleX(${d ? clamp01(t / d) : 0})`;
  if (R.prog.classList.contains('drag')) R.ptime.textContent = `${dur(t)} / ${dur(d)}`;
}
function goSlide(k, smooth) {
  if (k < 0 || k >= P.clips.length) return;
  closeSheet();
  const top = P.slides[k].offsetTop;
  if (smooth) P.feed.scrollTo({ top, behavior: 'smooth' });
  else { P.feed.scrollTop = top; setActive(k); }
}
function openSheet(kind) {
  const c = cur(); const R = P.ref;
  if (kind === 'info') {
    R.panel.innerHTML = `<div class="rl-shead"><b>Details</b><button class="rl-btn" data-action="sheetclose" aria-label="Close details">${ic('x', 20)}</button></div><div class="info">${infoHtml(c)}</div>`;
  } else {
    const ang = anglesOf(c);
    R.panel.innerHTML = `<div class="rl-shead"><b>Other angles at this moment</b><button class="rl-btn" data-action="sheetclose" aria-label="Close angles">${ic('x', 20)}</button></div>
      <div class="rl-angles">${ang.length ? ang.map((a, k) => { const off = Math.round((a.lm - c.lm) * 60); return `<button class="rl-arow" data-angle="${a.r}">${a.img ? `<img src="${esc(posterOf(a))}" alt="" loading="lazy">` : '<span class="noimg sm"></span>'}<div><b>${String.fromCharCode(66 + k)} · ${off >= 0 ? '+' : '−'}${dur(Math.abs(off))}</b><span>${fmtTime(a.lm, true)}${a.place ? ' · ' + esc(a.place) : ''} · ${dur(a.d)}</span></div>${ic('right', 18)}</button>`; }).join('') : '<p class="rl-empty">No other angles yet. Clips filmed at the same moment show up here.</p>'}</div>`;
  }
  P.sheet = kind; R.sheet.hidden = false;
  R.share = $('[data-shareat]', R.panel); R.last = '';
  tickReel();
  R.panel.scrollTop = 0;
  R.panel.focus({ preventScroll: true });
}
function closeSheet() {
  if (!P || !P.sheet) return;
  P.sheet = null; P.ref.sheet.hidden = true; P.ref.panel.innerHTML = ''; P.ref.share = null;
}
