// Records of Event — single-page app. Pages render from the JSON API; overlays (player, upload,
// new event, search, report) sit on top of the current page and have their own URLs.
import {
  $, $$, ic, esc, dur, hm, bytes, plural, num, localMin, fmtTime, fmtHour, fmtDay, fmtDate, bigDate, shortDate, tzName, ago,
  LABEL, badge, sIco, api, toast, copy, share, qr, origin, store, nav, go, config,
} from './util.js';
import { openUpload, uploadBusy } from './upload.js';
import { sha256File } from './mp4.js';
import { renderAdmin } from './admin.js';
import { renderPage } from './pages.js';

const app = $('#app');
const ov = $('#ov');
const ovbody = $('#ovbody');
const FALLBACK = ['sunset1', 'dusk1', 'golden1', 'night1', 'neon1', 'rain1', 'candles1', 'noon2', 'sunset2', 'dusk2', 'golden2', 'neon2'];
const fallbackImg = (seed) => `/img/${FALLBACK[[...String(seed)].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK.length]}-l.jpg`;
const poster = (rec) => `/m/p/${rec}`;

const state = {
  page: null, base: '/', overlayPushed: false, pendingPlace: null,
  ev: null, // { slug, view, sel, filters:Set, place, playing, head }
  player: null, rep: null, nw: null,
};
const cache = { home: null, homeAt: 0, events: {} };

/* ---------- data ---------- */
async function loadHome(force) {
  if (!force && cache.home && Date.now() - cache.homeAt < 20000) return cache.home;
  cache.home = await api('/api/home'); cache.homeAt = Date.now();
  return cache.home;
}
async function loadEvent(slug, force) {
  const c = cache.events[slug];
  if (!force && c && Date.now() - c.at < 30000) return c;
  const d = await api(`/api/events/${slug}`);
  if (d.removed) return { removed: true, title: d.title };
  const ev = d.event;
  const placeName = Object.fromEntries(ev.places.map((p) => [p.id, p.name]));
  const clips = d.clips.map((x) => {
    const lm = localMin(x.t, ev.tz);
    return { ...x, lm, end: lm + (x.d || 0) / 60, place: placeName[x.p] || '' };
  });
  const out = { ev, clips, at: Date.now() };
  cache.events[slug] = out;
  return out;
}
export function invalidate(slug) { delete cache.events[slug]; cache.home = null; }

/* ---------- shell ---------- */
function setNav(which) { $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === which)); }
const timers = [];
function every(fn, ms) { timers.push(setInterval(fn, ms)); }
function stopTimers() { while (timers.length) clearInterval(timers.pop()); stopPlayDay(); }
function mount(html, key) {
  stopTimers();
  app.innerHTML = `<div class="page-enter">${html}</div>`;
  state.page = key;
  if (!ov.classList.contains('open')) window.scrollTo(0, 0);
}
function setTitle(t) { document.title = t ? `${t} · ${config.name}` : config.name; }
function loading() { app.innerHTML = '<div class="boot"><span class="dot"></span></div>'; state.page = null; }
function errorPage(err) {
  mount(`<div class="wrap empty" style="padding:110px 0"><b>${err && err.status === 404 ? 'Not found' : 'Couldn’t load this page'}</b>
    <p>${esc(err && err.status === 404 ? 'The link may be wrong, or the page was removed.' : (err && err.message) || 'Please try again.')}</p>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:16px"><a class="btn btn-primary" href="/">Home</a>${err && err.status === 404 ? '' : '<button class="btn btn-ghost" data-action="reload">Try again</button>'}</div></div>${footer()}`, 'error');
}

function footer() {
  return `<footer class="footer"><div class="wrap">
    <div><span class="logo" style="font-size:16px"><span class="dot"></span>${esc(config.name)}</span><p class="foot-note">No accounts. No ads. No trackers. Open source.</p></div>
    <nav aria-label="Footer"><a href="/how">How it works</a><a href="/verify">Verify a file</a><a href="/receipt">My uploads</a><a href="/policy">Content policy</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>${config.repo ? `<a href="${esc(config.repo)}" target="_blank" rel="noopener">Source code ↗</a>` : ''}</nav>
  </div></footer>`;
}

/* ---------- router ---------- */
async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === 'r' && parts[1]) return await routeRecord(parts[1]);
    if (parts[0] === 'upload') {
      state.overlayPushed = !!state.page;
      if (!state.page) { if (parts[1]) await renderEvent(parts[1], 'timeline').catch(() => renderHome()); else await renderHome(); }
      openUpload(parts[1] || null);
      return;
    }
    if (parts[0] === 'new') { state.overlayPushed = !!state.page; if (!state.page) await renderHome(); openNew(); return; }
    closeOverlay(true);
    state.base = path;
    if (parts[0] === 'e' && parts[1]) return await renderEvent(parts[1], ['grid', 'places', 'about'].includes(parts[2]) ? parts[2] : 'timeline');
    if (parts[0] === 'verify') return renderVerify();
    if (parts[0] === 'receipt') return await renderReceipt();
    if (parts[0] === 'poster' && parts[1]) return await renderPoster(parts[1]);
    if (parts[0] === 'admin') { setNav(''); stopTimers(); state.page = 'admin'; setTitle('Moderation'); return await renderAdmin(app); }
    if (['how', 'terms', 'privacy', 'policy'].includes(parts[0])) {
      setNav(parts[0] === 'how' ? 'how' : ''); stopTimers();
      app.innerHTML = '<div class="page-enter" id="pg"></div>';
      renderPage($('#pg'), parts[0]);
      $('#pg').insertAdjacentHTML('beforeend', footer());
      state.page = parts[0]; setTitle({ how: 'How it works', terms: 'Terms of Use', privacy: 'Privacy Policy', policy: 'Content & Safety Policy' }[parts[0]]);
      window.scrollTo(0, 0);
      return;
    }
    if (path === '/') return await renderHome();
    errorPage({ status: 404 });
  } catch (err) { console.error(err); errorPage(err); }
}
nav.route = route;

async function routeRecord(rec) {
  const r = await api(`/api/records/${encodeURIComponent(rec)}`);
  state.overlayPushed = !!state.page && state.ev && state.ev.slug === r.slug;
  if (!state.ev || state.ev.slug !== r.slug || state.page !== 'e:' + r.slug) await renderEvent(r.slug, 'timeline', true);
  state.base = `/e/${r.slug}`;
  if (r.status !== 'published') return openTombstone(r);
  const t = Number(new URLSearchParams(location.search).get('t')) || 0;
  openPlayer(r.record, t);
}

/* ---------- home ---------- */
function spark(arr, color) {
  if (!arr) return '';
  const max = Math.max(1, ...arr);
  return `<div class="spark" style="--c:${color}" aria-hidden="true">${arr.map((v) => `<i style="height:${Math.max(3, (v / max) * 34)}px;opacity:${v ? 0.95 : 0.25}"></i>`).join('')}</div>`;
}
function eventCard(e) {
  return `<a class="ecard" href="/e/${e.slug}" style="--c:${e.color}">
    <div class="cover"><img src="${e.cover ? poster(e.cover) : fallbackImg(e.slug)}" alt="" loading="lazy"><div class="date">${shortDate(e.date)}</div>
      <div class="status">${e.live ? '<span class="live">Live</span>' : ''}</div></div>
    <div class="body">
      <h3>${esc(e.title)}</h3>
      <div class="where">${ic('pin', 15)}${esc(e.city)}${e.country ? ', ' + esc(e.country) : ''}${e.nplaces > 1 ? ` · ${e.nplaces} places` : ''}</div>
      <div class="foot"><div class="stat"><b>${num(e.n)}</b><span>${e.n === 1 ? 'clip' : 'clips'}</span></div>${e.n ? spark(e.spark, e.color) : ''}</div>
    </div></a>`;
}
function clipCard(c, ev, opts = {}) {
  return `<a class="clip ${c.x ? 'sensitive' : ''}" href="/r/${c.r}" data-clip="${c.r}" style="--accent:${ev.color}">
    ${c.img ? `<img src="${poster(c.r)}" alt="" loading="lazy">` : `<div class="noimg">${ic('film', 30)}</div>`}
    <div class="top"><span class="dur">${dur(c.d)}</span>${sIco(c.s)}</div>
    ${c.x ? `<div class="sens">${ic('eyeoff', 22)}<b>Sensitive</b><span>May show injury. Tap to view.</span></div>` : '<div class="play"><span>' + ic('play', 22) + '</span></div>'}
    <div class="bot"><span class="time">${fmtTime(c.lm)}</span><span class="cplace">${esc(opts.title || c.place)}</span></div>
  </a>`;
}
function justInItem(c, isNew) {
  const lm = localMin(c.t, c.tz);
  return `<a class="item ${isNew ? 'new' : ''}" href="/r/${c.r}" data-r="${c.r}">${c.img ? `<img src="${poster(c.r)}" alt="">` : `<span class="noimg sm" style="--accent:${c.color}">${ic('film', 18)}</span>`}<div><b>${fmtTime(lm)}</b><span>${esc(c.place || c.title)} · ${dur(c.d)}</span></div></a>`;
}
function stepsHtml() {
  return `<div class="steps">
    <div class="step"><span class="n">1</span><div class="ico" style="--ic:#ff3d7f">${ic('phone', 24)}</div><h3>Film it</h3><p>Any phone, any quality. Unedited is best.</p></div>
    <div class="step"><span class="n">2</span><div class="ico" style="--ic:#7c5cff">${ic('lock', 24)}</div><h3>Upload safely</h3><p>Location and phone details are removed on your phone. No account.</p></div>
    <div class="step"><span class="n">3</span><div class="ico" style="--ic:#12b886">${ic('archive', 24)}</div><h3>Kept on record</h3><p>The original file, fingerprinted so anyone can prove it hasn’t changed.</p></div>
  </div>`;
}

async function renderHome() {
  setNav('home'); setTitle('');
  if (!state.page) loading();
  const h = await loadHome();
  const f = h.featured;
  const covers = f && f.covers.length ? f.covers.map(poster) : FALLBACK.slice(0, 4).map((x) => `/img/${x}-l.jpg`);
  const hero = f ? `
    <section class="hero" style="--accent:${f.color}">
      <div class="hero-media">${covers.map((src, i) => `<img src="${src}" alt="" class="${i === 0 ? 'show' : ''}">`).join('')}</div>
      <div class="hero-body">
        <div class="hero-top">${f.live ? '<span class="live">Live</span>' : `<span class="chip glass">${ic('calendar', 15)}${fmtDate(f.date)}</span>`}<span class="chip glass">${ic('pin', 15)}${esc(f.city)}${f.nplaces > 1 ? ` + ${plural(f.nplaces - 1, 'place')}` : ''}</span></div>
        <div class="bigdate">${bigDate(f.date)}</div>
        <h1>${esc(f.title)}</h1>
        <div class="meta">
          <span class="chip glass">${ic('film', 15)}<b class="counter">${num(f.n)}</b>&nbsp;${f.n === 1 ? 'clip' : 'clips'}</span>
          ${f.secs ? `<span class="chip glass">${ic('clock', 15)}${hm(f.secs)} of footage</span>` : ''}
          ${f.n ? `<span class="chip glass">${ic('shield', 15)}${Math.round((f.checked / f.n) * 100)}% checked</span>` : ''}
        </div>
        <div class="ctas">
          <a class="btn btn-primary btn-lg" href="/e/${f.slug}">${ic('play', 18)}Watch the day</a>
          <a class="btn btn-accent btn-lg" href="/upload/${f.slug}">${ic('upload', 18)}Add your footage</a>
        </div>
      </div>
      ${h.justIn.length ? `<aside class="justin" aria-label="Just in"><h3><span>Just in</span><span class="mono" style="color:#ff6b6b">● REC</span></h3><div id="justin">${h.justIn.slice(0, 4).map((c) => justInItem(c)).join('')}</div></aside>` : ''}
    </section>` : `
    <section class="hero" style="--accent:#ff3d7f">
      <div class="hero-media">${covers.map((src, i) => `<img src="${src}" alt="" class="${i === 0 ? 'show' : ''}">`).join('')}</div>
      <div class="hero-body">
        <div class="hero-top"><span class="chip glass">${ic('archive', 15)}Open-source footage archive</span></div>
        <h1 class="hero-claim">Footage that can’t be quietly deleted.</h1>
        <p class="hero-sub">Something happening near you? Start an archive, share its QR code, and everyone who was there can add what they filmed.</p>
        <div class="ctas"><a class="btn btn-accent btn-lg" href="/new">${ic('plus', 18)}Start an archive</a><a class="btn btn-primary btn-lg" href="/how">How it works</a></div>
      </div>
    </section>`;
  mount(`<div class="wrap">${hero}
    <section class="section">
      <div class="section-head"><div><h2>Every event, on record</h2><p>Raw footage, sorted by when it was filmed.</p></div><button class="btn btn-ghost" data-action="search">${ic('search', 17)}Search</button></div>
      <div class="events">${h.events.map(eventCard).join('')}
        <a class="ecard new" href="/new"><span class="plus">${ic('plus', 28)}</span><h3>Start an archive</h3><p>Something happening near you? Create the event and share its QR code.</p></a>
      </div>
    </section>
    ${f && h.latest.length ? `<section class="section">
      <div class="section-head"><div><h2>Latest footage</h2><p>${esc(f.title)}</p></div><a class="link" href="/e/${f.slug}">Open event ${ic('arrow', 16)}</a></div>
      <div class="grid">${h.latest.map((c) => clipCard({ ...c, lm: localMin(c.t, f.tz), place: (f.places.find((p) => p.id === c.p) || {}).name || '' }, f)).join('')}</div>
    </section>` : ''}
    <section class="section">
      <div class="section-head"><div><h2>Film it. Upload it. It stays.</h2></div><a class="link" href="/how">How it works ${ic('arrow', 16)}</a></div>
      ${stepsHtml()}
    </section>
  </div>${footer()}`, 'home');
  let k = 0;
  every(() => {
    const imgs = $$('.hero-media img'); if (imgs.length < 2) return;
    imgs[k % imgs.length].classList.remove('show'); k++; imgs[k % imgs.length].classList.add('show');
  }, 6000);
  every(async () => {
    if (document.hidden || state.page !== 'home') return;
    const old = new Set($$('#justin .item').map((a) => a.dataset.r));
    const fresh = await loadHome(true).catch(() => null);
    const box = $('#justin'); if (!fresh || !box) return;
    fresh.justIn.slice(0, 4).reverse().forEach((c) => { if (!old.has(c.r)) box.insertAdjacentHTML('afterbegin', justInItem(c, true)); });
    $$('.item', box).slice(4).forEach((x) => x.remove());
    const cnt = $('.hero .counter'); if (cnt && fresh.featured) cnt.textContent = num(fresh.featured.n);
  }, 30000);
}

/* ---------- event page ---------- */
const VIEWS = [['timeline', 'list', 'Timeline'], ['grid', 'grid', 'Grid'], ['places', 'pin', 'Places'], ['about', 'info', 'About']];
let D = null; // current event data { ev, clips }

function filtered() {
  const f = state.ev.filters;
  let list = D.clips;
  if (f.has('checked')) list = list.filter((c) => c.s === 'checked' || c.s === 'verified' || c.s === 'consistent');
  if (f.has('long')) list = list.filter((c) => (c.d || 0) >= 60);
  if (f.has('safe')) list = list.filter((c) => !c.x);
  if (state.ev.place) list = list.filter((c) => c.p === state.ev.place);
  return list;
}
const inWindow = (list) => { const s = state.ev.sel; return s ? list.filter((c) => c.lm >= s[0] && c.lm < s[1]) : list; };

function span() {
  if (!D.clips.length) return null;
  let lo = Math.min(...D.clips.map((c) => c.lm)), hi = Math.max(...D.clips.map((c) => c.end));
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil((hi + 0.01) / 60) * 60;
  if (hi - lo < 120) hi = lo + 120;
  const size = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].find((s) => (hi - lo) / s <= 96) || 1440;
  hi = lo + Math.ceil((hi - lo) / size) * size;
  return { lo, hi, size, n: (hi - lo) / size, multi: hi - lo > 26 * 60 };
}

async function renderEvent(slug, view, quiet) {
  setNav('home');
  if (!state.page || !state.page.startsWith('e:' + slug)) loading();
  const data = await loadEvent(slug, state.page !== 'e:' + slug && !quiet);
  if (data.removed) {
    mount(`<div class="wrap empty" style="padding:110px 0"><b>This event was removed</b><p>“${esc(data.title)}” is no longer public.</p><a class="btn btn-primary" href="/" style="margin-top:14px">Home</a></div>${footer()}`, 'removed');
    return;
  }
  D = data;
  const ev = D.ev;
  if (!state.ev || state.ev.slug !== slug) state.ev = { slug, view, sel: null, filters: new Set(), place: null, playing: false, head: null };
  state.ev.view = view;
  if (state.pendingPlace) { state.ev.place = state.pendingPlace; state.pendingPlace = null; }
  setTitle(ev.title);
  if (state.page === 'e:' + slug) { refreshBars(); switchView(view); return; }
  const sp = span();
  const cover = ev.covers[0] ? poster(ev.covers[0]) : fallbackImg(ev.slug);
  mount(`
    <section class="ehero" style="--accent:${ev.color}">
      <div class="bg"><img src="${cover}" alt=""></div>
      <div class="wrap">
        <div class="crumbs"><a href="/">Events</a>${ic('right', 14)}<span>${esc(ev.city)}${ev.country ? ', ' + esc(ev.country) : ''}</span>${ic('right', 14)}<span>${fmtDate(ev.date)}</span></div>
        ${ev.status === 'pending' ? `<div class="banner">${ic('clock', 16)}<span><b>Not listed yet.</b> This page works and uploads are open — it appears in search after a quick review.</span></div>` : ''}
        <div class="row">
          <div>
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">${ev.live ? '<span class="live">Live</span>' : ''}<span class="chip">${esc(ev.kind)}</span>${ev.pending ? `<span class="chip">${ic('clock', 14)}${plural(ev.pending, 'video')} in review</span>` : ''}</div>
            <div class="bigdate" style="--accent:${ev.color}">${bigDate(ev.date)}</div>
            <h1>${esc(ev.title)}</h1>
            <div class="facts">
              <span class="chip">${ic('pin', 15)}${esc(ev.city)}${ev.nplaces > 1 ? ` · ${ev.nplaces} places` : ''}</span>
              <span class="chip">${ic('film', 15)}<span id="evcount">${num(ev.n)}</span>&nbsp;${ev.n === 1 ? 'clip' : 'clips'}</span>
              ${ev.secs ? `<span class="chip">${ic('clock', 15)}${hm(ev.secs)}</span>` : ''}
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-ghost" data-action="share-event">${ic('share', 17)}Share</button>
            <button class="btn btn-ghost" data-action="qr-event">${ic('qr', 17)}Show QR</button>
            <a class="btn btn-accent btn-lg" href="/upload/${ev.slug}" style="--accent:${ev.color}">${ic('upload', 18)}Add your footage</a>
          </div>
        </div>
      </div>
    </section>
    ${sp ? `<div class="scrubwrap" style="--accent:${ev.color}"><div class="wrap"><div class="scrub">
      <div class="clock"><b id="clockv">All day</b><span id="clocks"></span></div>
      <div class="bars" id="bars">${barsHtml()}</div>
      <div class="ctl"><button class="btn btn-primary btn-sm" data-action="playday">${ic('play', 15)}<span>Play the day</span></button><button class="btn btn-ghost btn-sm" data-action="clearsel" id="clearsel" hidden>Clear</button></div>
    </div></div></div>` : ''}
    <div class="wrap" style="--accent:${ev.color}">
      <div class="toolbar">
        <div class="tabs" role="tablist">${VIEWS.map(([v, i, l]) => `<button role="tab" aria-selected="${view === v}" class="${view === v ? 'on' : ''}" data-view="${v}">${ic(i, 16)}<span>${l}</span></button>`).join('')}</div>
        <div class="filters">${[['checked', 'Checked'], ['long', 'Over 1 min'], ['safe', 'Hide sensitive']].map(([k, l]) => `<button class="chip ${state.ev.filters.has(k) ? 'on' : ''}" data-filter="${k}" aria-pressed="${state.ev.filters.has(k)}">${l}</button>`).join('')}</div>
      </div>
      <div class="elayout"><div id="evmain"></div><aside class="rail">${railHtml()}</aside></div>
    </div>${footer()}`, 'e:' + slug);
  qr($('#railqr'), `${origin()}/u/${ev.code}`);
  renderMain();
  if (sp) bindBars();
  if (ev.live) {
    every(async () => {
      if (document.hidden || state.page !== 'e:' + slug || state.ev.playing) return;
      const before = D.clips.length;
      const fresh = await loadEvent(slug, true).catch(() => null);
      if (!fresh || fresh.removed || fresh.clips.length === before) return;
      D = fresh;
      $('#evcount').textContent = num(D.ev.n);
      refreshBars(); renderMain(true);
      toast(`${plural(D.clips.length - before, 'new clip')}`, 'film');
    }, 45000);
  }
}

function switchView(v) {
  state.ev.view = v;
  $$('.tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-selected', b.dataset.view === v); });
  renderMain(true);
}

function railHtml() {
  const ev = D.ev;
  return `
    <div class="card qrcard" style="--accent:${ev.color}">
      <div><h4>Scan to add footage</h4><p>Point any phone camera at it. No app needed.</p><div class="code mono">${ev.code}</div><button class="btn btn-ghost btn-sm" data-action="qr-event">${ic('qr', 15)}Show QR</button></div>
      <div class="qrbox" id="railqr"></div>
    </div>
    <div class="card">
      <div class="statgrid">
        <div><b>${num(ev.n)}</b><span>clips</span></div>
        <div><b>${hm(ev.secs)}</b><span>of footage</span></div>
        <div><b>${ev.nplaces}</b><span>${ev.nplaces === 1 ? 'place' : 'places'}</span></div>
        <div><b>${ev.n ? Math.round((ev.checked / ev.n) * 100) : 0}%</b><span>checked</span></div>
      </div>
      ${ev.figures ? `<div class="figures"><b>${esc(ev.figures.label)}</b><div class="range"></div><div class="lbl"><span>${esc(ev.figures.low)}</span><span>${esc(ev.figures.high)}</span></div><span style="color:var(--muted)">${esc(ev.figures.note)}</span></div>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-ghost btn-sm" style="flex:1" data-action="share-event">${ic('share', 15)}Share</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="dl-event" ${ev.n ? '' : 'disabled'}>${ic('download', 15)}Download list</button></div>
    </div>`;
}

function bins() {
  const sp = span(); const arr = new Array(sp.n).fill(0);
  filtered().forEach((c) => { const i = Math.floor((c.lm - sp.lo) / sp.size); if (i >= 0 && i < sp.n) arr[i]++; });
  return { ...sp, arr };
}
function barsHtml() {
  const b = bins(); const max = Math.max(1, ...b.arr); const w = 1000 / b.n;
  const total = b.hi - b.lo; const labels = [];
  const every = [15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 10080].find((x) => x >= total / 7 && x % b.size === 0) || total;
  for (let t = Math.ceil(b.lo / every) * every; t <= b.hi; t += every) {
    const pos = ((t - b.lo) / total) * 100;
    labels.push(`<span style="left:${pos}%;transform:translateX(${pos < 4 ? 0 : pos > 96 ? -100 : -50}%)">${b.multi && every >= 1440 ? fmtDay(t) : t % 60 ? fmtTime(t).replace(/ [AP]M$/, '') : fmtHour(t)}</span>`);
  }
  return `<svg viewBox="0 0 1000 52" preserveAspectRatio="none" aria-hidden="true">${b.arr.map((v, i) => { const hgt = Math.max(v ? 4 : 2, (v / max) * 52); return `<rect class="b" data-i="${i}" x="${i * w + 1}" y="${52 - hgt}" width="${Math.max(1, w - 2)}" height="${hgt}" rx="2"></rect>`; }).join('')}</svg>
    <div class="sel" id="selbox" style="opacity:0"></div><div class="head" id="playhead" hidden></div><div class="tip" id="bartip" hidden></div><div class="axis">${labels.join('')}</div>`;
}
function paintBars() {
  const sp = span(); if (!sp) return;
  const s = state.ev.sel, head = state.ev.head;
  $$('#bars rect.b').forEach((r) => {
    const t0 = sp.lo + +r.dataset.i * sp.size;
    r.classList.toggle('in', !!s && t0 + sp.size > s[0] && t0 < s[1]);
    r.classList.toggle('hot', head !== null && Math.abs(t0 - head) < Math.max(30, sp.size));
  });
  const box = $('#selbox');
  if (box) {
    if (s) { const L = ((s[0] - sp.lo) / (sp.hi - sp.lo)) * 100, R = ((s[1] - sp.lo) / (sp.hi - sp.lo)) * 100; box.style.left = Math.max(0, L) + '%'; box.style.width = (Math.min(100, R) - Math.max(0, L)) + '%'; box.style.opacity = 1; } else box.style.opacity = 0;
  }
  const cl = $('#clearsel'); if (cl) cl.hidden = !s || state.ev.playing;
  const cv = $('#clockv'), cs = $('#clocks');
  if (cv) {
    const list = inWindow(filtered());
    const fmtT = (m) => (sp.multi ? `${fmtDay(m)}, ${fmtTime(m)}` : fmtTime(m));
    if (state.ev.playing) { cv.textContent = fmtT(head); cs.textContent = `${plural(list.length, 'clip')} around now`; }
    else if (s) { cv.textContent = `${fmtT(s[0])} – ${fmtTime(s[1])}`; cs.textContent = plural(list.length, 'clip'); }
    else { cv.textContent = 'All day'; cs.textContent = `${plural(filtered().length, 'clip')} · drag across the bars to pick a time · ${tzName(D.ev.tz, D.clips[0] && D.clips[0].t)}`; }
  }
}
function bindBars() {
  const el = $('#bars'); if (!el) return;
  const sp = span();
  const toT = (x) => { const r = el.getBoundingClientRect(); return sp.lo + Math.max(0, Math.min(1, (x - r.left) / r.width)) * (sp.hi - sp.lo); };
  const snap = (v) => sp.lo + Math.round((v - sp.lo) / sp.size) * sp.size;
  let a = null;
  const tip = $('#bartip');
  el.addEventListener('pointerdown', (e) => { if (state.ev.playing) stopPlayDay(); el.setPointerCapture(e.pointerId); a = toT(e.clientX); state.ev.sel = [snap(a), snap(a) + sp.size]; paintBars(); });
  el.addEventListener('pointermove', (e) => {
    const v = toT(e.clientX); const r = el.getBoundingClientRect();
    tip.hidden = false; tip.style.left = (e.clientX - r.left) + 'px'; tip.textContent = sp.multi ? `${fmtDay(v)} ${fmtTime(v)}` : fmtTime(v);
    if (a === null) return;
    const lo = Math.min(a, v), hi = Math.max(a, v);
    state.ev.sel = [snap(lo), Math.max(snap(hi), snap(lo) + sp.size)]; paintBars();
  });
  el.addEventListener('pointerleave', () => { tip.hidden = true; });
  const end = () => { if (a === null) return; a = null; renderMain(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  paintBars();
}
function refreshBars() { const b = $('#bars'); if (!b) return; b.innerHTML = barsHtml(); const nb = b.cloneNode(true); b.replaceWith(nb); bindBars(); }

let playTimer = null;
function startPlayDay() {
  const sp = span(); if (!sp) return;
  state.ev.playing = true; state.ev.head = sp.lo; state.ev.sel = null;
  const btn = $('[data-action="playday"]'); if (btn) btn.innerHTML = `${ic('pause', 15)}<span>Pause</span>`;
  const ph = $('#playhead'); if (ph) ph.hidden = false;
  const stepMin = (sp.hi - sp.lo) / 160; const win = Math.max(20, sp.size * 1.5);
  const step = () => {
    state.ev.head += stepMin;
    if (state.ev.head >= sp.hi) { stopPlayDay(); return; }
    state.ev.sel = [state.ev.head - win, state.ev.head + win];
    if (ph) ph.style.left = ((state.ev.head - sp.lo) / (sp.hi - sp.lo)) * 100 + '%';
    paintBars(); renderMain(true);
  };
  playTimer = setInterval(step, 160); step();
}
function stopPlayDay() {
  if (!playTimer) return;
  clearInterval(playTimer); playTimer = null;
  if (!state.ev) return;
  state.ev.playing = false; state.ev.head = null;
  const btn = $('[data-action="playday"]'); if (btn) btn.innerHTML = `${ic('play', 15)}<span>Play the day</span>`;
  const ph = $('#playhead'); if (ph) ph.hidden = true;
  paintBars();
}

function renderMain(quiet) {
  const host = $('#evmain'); if (!host || !D) return;
  const ev = D.ev; const v = state.ev.view;
  if (v === 'about') { host.innerHTML = aboutHtml(); paintBars(); return; }
  if (!D.clips.length) {
    host.innerHTML = `<div class="empty card" style="padding:56px 24px"><b>No public footage yet</b>${ev.pending ? `${plural(ev.pending, 'video')} ${ev.pending === 1 ? 'is' : 'are'} waiting for review.` : 'Add the first clip — or share the QR code so people who were there can add theirs.'}<div style="margin-top:18px"><a class="btn btn-accent" href="/upload/${ev.slug}">${ic('upload', 17)}Add your footage</a></div></div>`;
    return;
  }
  const list = inWindow(filtered());
  if (v === 'grid') host.innerHTML = list.length ? `<div class="grid dense">${list.map((c) => clipCard(c, ev)).join('')}</div>` : emptyWin();
  else if (v === 'places') host.innerHTML = placesHtml(list);
  else host.innerHTML = timelineHtml(list);
  if (!quiet && state.ev.sel && v === 'timeline') { const first = $('.hourgroup', host); if (first) first.scrollIntoView({ block: 'start' }); }
  paintBars();
}
const emptyWin = () => `<div class="empty"><b>No footage for this time yet</b>Were you there? <a class="link" style="display:inline-flex;color:var(--accent)" href="/upload/${D.ev.slug}">Add yours ${ic('arrow', 14)}</a></div>`;
function timelineHtml(list) {
  if (!list.length) return emptyWin();
  const sp = span();
  const groups = new Map();
  list.forEach((c) => { const h = Math.floor(c.lm / 60); if (!groups.has(h)) groups.set(h, []); groups.get(h).push(c); });
  const hours = [...groups.keys()].sort((a, b) => a - b);
  let out = '', prev = null;
  const label = (h) => (sp.multi ? `${fmtDay(h * 60)} · ${fmtHour(h * 60)}` : fmtHour(h * 60));
  hours.forEach((h) => {
    if (prev !== null && h - prev > 1) out += `<div class="gap">${ic('clock', 16)}<span>${fmtTime((prev + 1) * 60)} – ${fmtTime(h * 60)} · no footage yet</span><a href="/upload/${D.ev.slug}" class="link" style="color:var(--accent)">Were you there? Add yours →</a></div>`;
    const g = groups.get(h);
    out += `<div class="hourgroup"><div class="h"><b>${label(h)}</b><span>${plural(g.length, 'clip')}</span><i style="width:${Math.min(100, g.length * 6)}%"></i></div><div class="grid">${g.map((c) => clipCard(c, D.ev)).join('')}</div></div>`;
    prev = h;
  });
  return out;
}
function placesHtml(list) {
  const sel = state.ev.place;
  const places = D.ev.places.filter((p) => p.n || p.id === sel);
  const unplaced = list.filter((c) => !c.p).length;
  const tiles = places.map((p, i) => {
    const cl = list.filter((c) => c.p === p.id);
    const range = cl.length ? `${fmtTime(cl[0].lm)} – ${fmtTime(cl[cl.length - 1].lm)}` : 'No footage in this window';
    const img = cl.find((c) => c.img && !c.x);
    return `<button class="place ptile ${sel === p.id ? 'on' : ''}" data-place="${p.id}" style="--h:${(i * 47) % 360}">${img ? `<img src="${poster(img.r)}" alt="">` : ''}<b>${esc(p.name)}</b><span class="n">${cl.length}</span><small>${range}</small></button>`;
  }).join('');
  const chosen = sel ? list.filter((c) => c.p === sel) : [];
  return `<div class="ptiles">${tiles}${unplaced ? `<div class="place ptile muted"><b>Place not given</b><span class="n">${unplaced}</span><small>Uploader didn’t say where</small></div>` : ''}</div>
    ${sel ? `<div style="margin-top:22px"><div class="section-head"><div><h2 style="font-size:24px">${esc((D.ev.places.find((p) => p.id === sel) || {}).name || '')}</h2></div><button class="btn btn-ghost btn-sm" data-action="clearplace">Show all places</button></div><div class="grid">${chosen.map((c) => clipCard(c, D.ev)).join('')}</div></div>` : ''}`;
}
function aboutHtml() {
  const ev = D.ev;
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return `<div class="about">
    <div>
      <p class="lead">${ev.summary ? esc(ev.summary) : 'A moderator adds a short, neutral summary and links to reporting about this event.'}</p>
      ${ev.sources.length ? `<div class="srcs">${ev.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${ic('globe', 17)}<b>${esc(s.title || host(s.url))}</b><span>${esc(host(s.url))} ↗</span></a>`).join('')}</div>` : ''}
    </div>
    <div class="card">
      <h4>About this record</h4>
      <dl class="kv" style="margin-top:12px">
        <dt>Date</dt><dd>${fmtDate(ev.date)}${ev.live ? ' · <span style="color:var(--rec);font-weight:700">Live</span>' : ''}</dd>
        <dt>Place</dt><dd>${esc(ev.city)}${ev.country ? ', ' + esc(ev.country) : ''}</dd>
        <dt>Time zone</dt><dd>${esc(ev.tz)} · ${tzName(ev.tz)}</dd>
        ${ev.aliases.length ? `<dt>Also called</dt><dd>${ev.aliases.map(esc).join(', ')}</dd>` : ''}
        <dt>Short code</dt><dd class="mono">${ev.code}</dd>
      </dl>
      <p style="margin-top:14px">Summary by moderators. Videos carry their uploaders’ own words. <button class="link" data-action="report-event" style="display:inline;color:var(--accent)">Report a problem</button></p>
    </div>
  </div>`;
}

/* ---------- player ---------- */
let video = null;
function anglesOf(c) {
  return D.clips.filter((x) => x.r !== c.r && !x.x && x.lm <= c.end + 5 && x.end >= c.lm - 5).sort((a, b) => a.lm - b.lm).slice(0, 8);
}
function openPlayer(rec, t = 0) {
  const c = D.clips.find((x) => x.r === rec); if (!c) return;
  state.player = { r: rec, revealed: !c.x, t0: t };
  openOverlay(`<div class="player" role="dialog" aria-label="${rec}" style="--accent:${D.ev.color}">
    <div class="stagecol"><div class="stage" id="stage"></div><div class="controls" id="controls"></div><div class="angles" id="angles"></div></div>
    <div class="info" id="pinfo"></div></div>`);
  setTitle(`${rec} · ${D.ev.title}`);
  drawPlayer();
}
function clipNow() { return state.player && D.clips.find((x) => x.r === state.player.r); }
function drawPlayer(autoplay) {
  const P = state.player; const c = clipNow(); if (!c) return;
  const ev = D.ev; const i = D.clips.indexOf(c);
  const stage = $('#stage');
  stage.innerHTML = `
    ${P.revealed ? `<video id="vid" playsinline preload="metadata" ${c.img ? `poster="${poster(c.r)}"` : ''} src="/m/v/${c.r}"></video>` : `${c.img ? `<img class="frame" src="${poster(c.r)}" alt="" style="filter:blur(30px)">` : ''}`}
    <div class="wall"><b id="wall">${fmtTime(c.lm + P.t0 / 60, true)}</b><span>${tzName(ev.tz, c.t)} · filmed time</span></div>
    <button class="iconbtn close" data-action="close" aria-label="Close">${ic('x', 20)}</button>
    ${i > 0 ? `<button class="iconbtn navbtn prev" data-action="pprev" aria-label="Previous clip">${ic('left', 22)}</button>` : ''}
    ${i < D.clips.length - 1 ? `<button class="iconbtn navbtn next" data-action="pnext" aria-label="Next clip">${ic('right', 22)}</button>` : ''}
    ${P.revealed ? `<button class="bigplay" data-action="ptoggle" aria-label="Play">${ic('play', 34)}</button><div class="vidfail" id="vidfail" hidden>${ic('alert', 26)}<b>This browser can’t play this file format</b><span>Download the original to watch it.</span><a class="btn btn-primary btn-sm" href="/m/d/${c.r}" data-native>${ic('download', 15)}Download original</a></div>`
    : `<button class="sensgate" data-action="reveal">${ic('eyeoff', 34)}<b>Sensitive</b><span>May show injury or violence. Tap to view.</span></button>`}`;
  video = $('#vid');
  drawControls();
  if (video) {
    video.muted = store.get('roe.muted', false);
    video.addEventListener('loadedmetadata', () => { if (P.t0) { video.currentTime = Math.min(P.t0, Math.max(0, video.duration - 0.5)); P.t0 = 0; } tick(); });
    video.addEventListener('timeupdate', tick);
    video.addEventListener('play', () => { $('.bigplay')?.classList.add('hide'); drawControls(); });
    video.addEventListener('pause', () => { $('.bigplay')?.classList.remove('hide'); drawControls(); });
    video.addEventListener('error', () => { const f = $('#vidfail'); if (f) f.hidden = false; $('.bigplay')?.classList.add('hide'); });
    if (autoplay) video.play().catch(() => {});
  }
  const ang = anglesOf(c);
  $('#angles').innerHTML = `<h5>${ic('layers', 15)}${ang.length ? `Other angles at this moment · ${ang.length}` : 'No other angles yet'}</h5>
    <div class="strip">${ang.map((a, k) => { const off = Math.round((a.lm - c.lm) * 60); return `<button class="angle" data-angle="${a.r}">${a.img ? `<img src="${poster(a.r)}" alt="">` : '<span class="noimg sm"></span>'}<em>${String.fromCharCode(66 + k)}</em><span>${off >= 0 ? '+' : '−'}${dur(Math.abs(off))}${a.place ? ' · ' + esc(a.place) : ''}</span></button>`; }).join('')}</div>`;
  const steps = { unverified: 2, consistent: 3, verified: 4, disputed: 2 }[c.s] || 2;
  const src = { metadata: 'from the video file', file: 'from the file date — approximate', manual: 'set by the uploader' }[c.ts] || '';
  $('#pinfo').innerHTML = `
    <div class="rid"><b>${c.r}</b><button class="btn btn-sm" style="background:rgba(255,255,255,.07)" data-action="copyid">${ic('copy', 15)}Copy</button></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${badge(c.s)}${c.x ? `<span class="badge disputed">${ic('eyeoff', 13)}Sensitive</span>` : ''}</div>
    <div class="verifyline" title="Received · Reviewed · Place checked · Verified">${[1, 2, 3, 4].map((k) => `<i class="${k <= steps ? 'on' : ''}"></i>`).join('')}</div>
    <h3>${c.place ? esc(c.place) + ' · ' : ''}${fmtTime(c.lm)}</h3>
    <dl class="kv">
      <dt>Filmed</dt><dd>${fmtDay(c.lm)}, ${fmtTime(c.lm, true)} ${tzName(ev.tz, c.t)}<small>${src}</small></dd>
      ${c.place ? `<dt>Place</dt><dd>${esc(c.place)}<small>chosen by the uploader</small></dd>` : ''}
      <dt>Event</dt><dd><a href="/e/${ev.slug}" style="text-decoration:underline;text-underline-offset:3px">${esc(ev.title)}</a></dd>
      <dt>File</dt><dd>${c.w && c.h ? `${c.w}×${c.h} · ` : ''}${dur(c.d)} · ${bytes(c.z)}<small>${c.stripped.length ? 'Original file; hidden location/phone details removed before upload' : 'Original file, unchanged'}</small></dd>
      <dt>Licence</dt><dd>CC BY 4.0 · Anonymous</dd>
    </dl>
    ${c.n ? `<div class="note"><small>Uploader’s note</small>“${esc(c.n)}”</div>` : ''}
    <div><div style="font-size:12px;color:rgba(255,255,255,.55);margin-bottom:6px">Fingerprint · SHA-256</div><div class="hash">${ic('hash', 15)}<span>${c.sha}</span><button data-action="copyhash" aria-label="Copy fingerprint">${ic('copy', 15)}</button></div>
    ${c.sho && c.sho !== c.sha ? `<div style="font-size:12px;color:rgba(255,255,255,.55);margin:8px 0 6px">Before details were removed (uploader’s copy)</div><div class="hash">${ic('hash', 15)}<span>${c.sho}</span></div>` : ''}</div>
    <div class="actions2">
      <a class="btn primary" href="/m/d/${c.r}" data-native>${ic('download', 17)}Download original · ${bytes(c.z)}</a>
      <button class="btn" data-action="shareat">${ic('share', 16)}<span id="shareat">Share at 0:00</span></button>
      <button class="btn" data-action="cite">${ic('quote', 16)}Cite</button>
      <button class="btn" data-action="report" style="grid-column:1/-1;color:#ff8f87">${ic('flag', 16)}Report a problem</button>
    </div>`;
}
function drawControls() {
  const c = clipNow(); const box = $('#controls'); if (!c || !box) return;
  const playing = video && !video.paused;
  box.innerHTML = `
    <button class="iconbtn" data-action="ptoggle" aria-label="${playing ? 'Pause' : 'Play'}" ${video ? '' : 'disabled'}>${ic(playing ? 'pause' : 'play', 20)}</button>
    <span class="t mono" id="ptime">${dur(video ? video.currentTime : 0)} / ${dur(video && video.duration ? video.duration : c.d)}</span>
    <div class="seek" id="seek" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuemax="${Math.round(c.d || 0)}"><i id="seekfill" style="width:${video && video.duration ? (video.currentTime / video.duration) * 100 : 0}%"></i></div>
    <button class="iconbtn" data-action="pmute" aria-label="${video && video.muted ? 'Unmute' : 'Mute'}">${ic(video && video.muted ? 'mute' : 'sound', 20)}</button>
    <button class="iconbtn" data-action="pfull" aria-label="Fullscreen">${ic('full', 20)}</button>`;
  const seek = $('#seek');
  const to = (x) => { if (!video || !video.duration) return; const r = seek.getBoundingClientRect(); video.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * video.duration; tick(); };
  seek.addEventListener('pointerdown', (e) => { seek.setPointerCapture(e.pointerId); to(e.clientX); const mv = (ev) => to(ev.clientX); seek.addEventListener('pointermove', mv); seek.addEventListener('pointerup', () => seek.removeEventListener('pointermove', mv), { once: true }); });
}
function tick() {
  const c = clipNow(); if (!c || !video) return;
  const t = video.currentTime || 0;
  const w = $('#wall'); if (w) w.textContent = fmtTime(c.lm + t / 60, true);
  const f = $('#seekfill'); if (f && video.duration) f.style.width = (t / video.duration) * 100 + '%';
  const tm = $('#ptime'); if (tm) tm.textContent = `${dur(t)} / ${dur(video.duration || c.d)}`;
  const sa = $('#shareat'); if (sa) sa.textContent = `Share at ${dur(t)}`;
  const sk = $('#seek'); if (sk) sk.setAttribute('aria-valuenow', Math.round(t));
}
function switchClip(rec, keepWall) {
  const old = clipNow(); const nc = D.clips.find((x) => x.r === rec); if (!nc) return;
  const wasPlaying = video && !video.paused;
  const wall = old.lm + (video ? video.currentTime : 0) / 60;
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  state.player = { r: rec, revealed: !nc.x, t0: keepWall ? Math.max(0, (wall - nc.lm) * 60) : 0 };
  history.replaceState(null, '', `/r/${rec}`);
  drawPlayer(wasPlaying);
  if (keepWall) toast('Switched angle — same moment', 'layers');
}
function openTombstone(r) {
  const label = { withdrawn: 'Removed by the person who uploaded it', removed: 'Removed', rejected: 'Not accepted', hidden: 'Hidden', pending: 'Waiting for review' }[r.status] || r.status;
  openOverlay(`<div class="modal sm" role="dialog" aria-label="${esc(r.record)}"><div class="mhead"><h2 class="mono">${esc(r.record)}</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
    <div class="mbody"><div class="empty" style="padding:20px 0"><b>${esc(label)}</b>${r.status === 'pending' ? 'This video was uploaded and is waiting for a moderator. Check back soon.' : esc(r.reason || 'This record is no longer public.')}</div></div></div>`);
}

/* ---------- overlays ---------- */
export function openOverlay(html) { ovbody.innerHTML = html; ov.classList.add('open'); document.body.classList.add('lock'); }
export function closeOverlay(silent) {
  if (!ov.classList.contains('open')) return;
  if (!silent && uploadBusy()) { toast('Upload still running — use Pocket mode or wait until it finishes', 'upload'); return; }
  if (video) { video.pause(); video = null; }
  state.player = null;
  ov.classList.remove('open'); ovbody.innerHTML = ''; document.body.classList.remove('lock');
  $('#pocket').classList.remove('on');
  if (D && state.page === 'e:' + (state.ev && state.ev.slug)) setTitle(D.ev.title);
  if (!silent) {
    if (state.overlayPushed) { state.overlayPushed = false; history.back(); } else history.replaceState(null, '', state.base || '/');
  }
}
function showQr(ev) {
  const url = `${origin()}/u/${ev.code}`;
  openOverlay(`<div class="modal sm" role="dialog" aria-label="QR code" style="--accent:${ev.color}">
    <div class="mhead"><h2>Scan to add footage</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
    <div class="mbody" style="display:grid;justify-items:center;gap:14px;text-align:center">
      <div class="qrbox" id="bigqr"></div>
      <div class="code mono" style="font-size:44px;margin:0">${ev.code}</div>
      <p style="margin:0;color:var(--muted)">Or open <b class="mono" style="color:var(--text)">${esc(url.replace(/^https?:\/\//, ''))}</b></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(`${ev.title} — add your footage: ${url}`)}" target="_blank" rel="noopener">${ic('share', 16)}WhatsApp</a><button class="btn btn-ghost" data-action="copytext" data-text="${esc(url)}">${ic('copy', 16)}Copy link</button><a class="btn btn-ghost" href="/poster/${ev.slug}">${ic('download', 16)}Print poster</a></div>
    </div></div>`);
  qr($('#bigqr'), url);
}
function showDownloads(ev) {
  openOverlay(`<div class="modal sm" role="dialog" aria-label="Download list"><div class="mhead"><h2>Download the record</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
    <div class="mbody vstack">
      <p style="margin:0;color:var(--muted)">A list of every public clip with its filming time, fingerprint and a link to the original file. Use it to mirror or cite the archive.</p>
      <a class="pickrow" href="/api/events/${ev.slug}/manifest.json" data-native download><span class="ic-tile">${ic('list', 22)}</span><div><b>manifest.json</b><span>Every record, with download links</span></div></a>
      <a class="pickrow" href="/api/events/${ev.slug}/sha256sums.txt" data-native download><span class="ic-tile">${ic('hash', 22)}</span><div><b>SHA256SUMS.txt</b><span>Check downloaded files with sha256sum -c</span></div></a>
    </div></div>`);
}

/* ---------- new event ---------- */
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function openNew() {
  state.nw = { title: '', date: todayLocal(), city: '', country: '', kind: 'Protest', tz: browserTz(), created: null, busy: false, dupes: [] };
  openOverlay('<div class="modal sm" role="dialog" aria-label="Create an event" id="newmodal"></div>');
  drawNew();
}
function drawNew() {
  const N = state.nw; const m = $('#newmodal'); if (!m) return;
  if (N.created) {
    const e = N.created; const url = `${origin()}/u/${e.code}`;
    m.style.setProperty('--accent', e.color);
    m.innerHTML = `<div class="mhead"><h2>Your event is ready</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
      <div class="mbody"><div class="created"><div class="qrbox" id="newqr"></div><div><span class="live" style="background:${e.color}">New</span><h3 style="margin:10px 0 4px;font:650 22px var(--font-display)">${esc(e.title)}</h3><p style="color:var(--muted);margin:0">${fmtDate(e.date)} · ${esc(e.city)}</p><div class="code mono">${e.code}</div></div></div>
      <p style="color:var(--muted);margin:16px 0">Share the QR code or link — anyone who opens it can add footage straight away.${e.status === 'pending' ? ' It shows up in search after a quick review.' : ''}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><a class="btn btn-accent" href="/upload/${e.slug}" style="grid-column:1/-1">${ic('upload', 17)}Add the first clips</a><a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(`${e.title} — add your footage: ${url}`)}" target="_blank" rel="noopener">${ic('share', 16)}WhatsApp</a><button class="btn btn-ghost" data-action="copytext" data-text="${esc(url)}">${ic('copy', 16)}Copy link</button><a class="btn btn-ghost" href="/poster/${e.slug}">${ic('download', 16)}Print poster</a><a class="btn btn-ghost" href="/e/${e.slug}">Open event ${ic('arrow', 16)}</a></div></div>`;
    qr($('#newqr'), url);
    return;
  }
  const ok = N.title.trim().length >= 6 && N.city.trim().length >= 2 && N.date;
  const tzs = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return [N.tz]; } })();
  if (!tzs.includes(N.tz)) tzs.unshift(N.tz);
  m.innerHTML = `<div class="mhead"><h2>Start an archive</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
    <form class="mbody" id="newform" novalidate>
      <div class="field"><label for="ne-title">What happened?</label><input id="ne-title" maxlength="140" value="${esc(N.title)}" placeholder="e.g. Teachers’ march to city hall" autocomplete="off"></div>
      <div id="dupebox">${dupeHtml(N.dupes)}</div>
      <div class="row2"><div class="field"><label for="ne-date">When</label><input id="ne-date" type="date" value="${N.date}" max="${todayLocal()}"></div><div class="field"><label for="ne-city">City or place</label><input id="ne-city" maxlength="80" value="${esc(N.city)}" placeholder="e.g. Nairobi" autocomplete="address-level2"></div></div>
      <div class="row2"><div class="field"><label for="ne-country">Country</label><input id="ne-country" maxlength="80" value="${esc(N.country)}" placeholder="e.g. Kenya" autocomplete="country-name"></div><div class="field"><label for="ne-tz">Local time zone</label><select id="ne-tz">${tzs.map((z) => `<option ${z === N.tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Type</label><div class="cats">${(config.kinds.length ? config.kinds : ['Protest', 'March', 'Rally', 'Other']).map((k) => `<button type="button" class="${N.kind === k ? 'on' : ''}" data-kind="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
      <p class="err" id="neerr" hidden></p>
    </form>
    <div class="mfoot"><span class="hint">${ic('lock', 14)} No account needed</span><button class="btn btn-primary" data-action="create" ${ok && !N.busy ? '' : 'disabled'}>${N.busy ? 'Creating…' : 'Create event'}</button></div>`;
  const ti = $('#ne-title'), ci = $('#ne-city'), co = $('#ne-country'), da = $('#ne-date'), tz = $('#ne-tz');
  let t = null; let lastKey = N.dupes.map((x) => x.slug).join('|');
  const upd = () => {
    N.title = ti.value; N.city = ci.value; N.country = co.value; N.date = da.value; N.tz = tz.value;
    const b = $('[data-action="create"]'); if (b) b.disabled = !(N.title.trim().length >= 6 && N.city.trim().length >= 2 && N.date);
    clearTimeout(t);
    t = setTimeout(async () => {
      const qtext = `${N.title} ${N.city}`.trim(); if (qtext.length < 5) return;
      const r = await api(`/api/search?mode=dupe&q=${encodeURIComponent(qtext)}&date=${N.date}`).catch(() => null);
      if (!r || !$('#dupebox')) return;
      N.dupes = r.events; const k = N.dupes.map((x) => x.slug).join('|');
      if (k !== lastKey) { lastKey = k; $('#dupebox').innerHTML = dupeHtml(N.dupes); }
    }, 350);
  };
  [ti, ci, co, da, tz].forEach((el) => el.addEventListener('input', upd));
  $('#newform').addEventListener('submit', (e) => { e.preventDefault(); createEvent(); });
  ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length);
}
function dupeHtml(d) {
  if (!d.length) return '';
  return `<div class="dupe"><h5>${ic('alert', 15)} Already in the archive?</h5><div class="pick">${d.map((e) => `<div class="pickrow" style="--accent:${e.color}"><img src="${e.cover ? poster(e.cover) : fallbackImg(e.slug)}" alt=""><div><b>${esc(e.title)}</b><span>${fmtDate(e.date)} · ${esc(e.city)}</span></div><a class="btn btn-primary btn-sm" href="/upload/${e.slug}">Use this</a></div>`).join('')}</div></div>`;
}
async function createEvent() {
  const N = state.nw; if (N.busy) return;
  N.busy = true; drawNew();
  try {
    const r = await api('/api/events', { body: { title: N.title, date: N.date, city: N.city, country: N.country, tz: N.tz, kind: N.kind } });
    N.created = r.event; cache.home = null;
  } catch (e) {
    N.busy = false; drawNew();
    const el = $('#neerr'); if (el) { el.textContent = e.message; el.hidden = false; }
    return;
  }
  N.busy = false; drawNew();
}

/* ---------- search ---------- */
function openSearch() {
  openOverlay(`<div class="modal search" role="dialog" aria-label="Search"><div class="sinput">${ic('search', 22)}<input id="sq" placeholder="Search events, places, dates, record numbers" autocomplete="off" enterkeyhint="search"><button class="iconbtn" data-action="close" aria-label="Close" style="width:36px;height:36px">${ic('x', 18)}</button></div><div class="sresults" id="sres"></div></div>`);
  const inp = $('#sq'); inp.focus();
  let t = null, seq = 0;
  const run = () => {
    clearTimeout(t);
    const v = inp.value.trim();
    if (v.length < 2) { $('#sres').innerHTML = searchHints(); return; }
    t = setTimeout(async () => {
      const my = ++seq;
      const r = await api(`/api/search?q=${encodeURIComponent(v)}`).catch((e) => ({ error: e.message }));
      if (my !== seq || !$('#sres')) return;
      $('#sres').innerHTML = searchResults(v, r);
    }, 180);
  };
  inp.addEventListener('input', run); run();
  inp.addEventListener('keydown', (e) => {
    const items = $$('#sres .sres'); if (!items.length) return;
    let i = items.findIndex((x) => x.classList.contains('on'));
    if (e.key === 'ArrowDown') { e.preventDefault(); i = Math.min(items.length - 1, i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(0, i - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); (items[i] || items[0]).click(); return; } else return;
    items.forEach((x, k) => x.classList.toggle('on', k === i)); items[i].scrollIntoView({ block: 'nearest' });
  });
}
function searchHints() {
  const evs = (cache.home && cache.home.events.slice(0, 5)) || [];
  return `${evs.length ? `<h6>Recent events</h6>${evs.map((e) => `<a class="sres" href="/e/${e.slug}"><img src="${e.cover ? poster(e.cover) : fallbackImg(e.slug)}" alt=""><div><b>${esc(e.title)}</b><span>${fmtDate(e.date)} · ${esc(e.city)}</span></div>${e.live ? '<span class="live">Live</span>' : ''}</a>`).join('')}` : ''}
    <h6>You can search by</h6><div class="shints"><span class="chip">Event name</span><span class="chip">City or place</span><span class="chip mono">10102026</span><span class="chip mono">ROE-261010-0042</span></div>`;
}
function hl(text, q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  let out = esc(text);
  words.forEach((w) => { const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'); out = out.replace(re, '<mark>$1</mark>'); });
  return out;
}
function searchResults(q, r) {
  if (r.error) return `<div class="empty" style="padding:30px"><b>Search isn’t available</b>${esc(r.error)}</div>`;
  let out = '';
  if (r.events.length) out += '<h6>Events</h6>' + r.events.map((e) => `<a class="sres" href="/e/${e.slug}"><img src="${e.cover ? poster(e.cover) : fallbackImg(e.slug)}" alt=""><div><b>${hl(e.title, q)}</b><span>${fmtDate(e.date)} · ${hl(e.city, q)}${e.country ? ', ' + esc(e.country) : ''} · ${plural(e.n, 'clip')}</span></div>${e.live ? '<span class="live">Live</span>' : ''}</a>`).join('');
  if (r.places.length) out += '<h6>Places</h6>' + r.places.map((p) => `<a class="sres" href="/e/${p.slug}/places" data-setplace="${p.id}"><span class="ic-tile" style="color:${p.color}">${ic('pin', 20)}</span><div><b>${hl(p.name, q)}</b><span>${esc(p.title)} · ${plural(p.n, 'clip')}</span></div></a>`).join('');
  if (r.records.length) out += '<h6>Records</h6>' + r.records.map((c) => `<a class="sres" href="/r/${c.r}">${c.img ? `<img src="${poster(c.r)}" alt="">` : `<span class="ic-tile">${ic('film', 20)}</span>`}<div><b class="mono">${hl(c.r, q)}</b><span>${fmtTime(localMin(c.t, c.tz))} · ${esc(c.title)}</span></div>${badge(c.s)}</a>`).join('');
  return out || `<div class="empty" style="padding:30px"><b>No results</b>Nothing matches “${esc(q)}”.<a class="btn btn-ghost" href="/new" style="margin-top:12px">${ic('plus', 16)}Start an archive for it</a></div>`;
}

/* ---------- report ---------- */
const REASONS = [
  ['me', 'I’m in this video', 'and it puts me at risk'],
  ['injury', 'Shows injury without a warning', 'we’ll add a warning screen'],
  ['private', 'Private or sexual content', 'hidden as a priority'],
  ['wrong-event', 'Not from this event', 'tell us where it’s really from'],
  ['wrong-time', 'Wrong time or place', 'suggest the right one'],
  ['copyright', 'It’s my copyright', 'owners can ask for removal'],
  ['illegal', 'Illegal content', 'tell us what law it breaks'],
  ['other', 'Something else', ''],
];
function openReport(target) {
  state.rep = { ...target, reason: null, details: '', contact: '', done: null, busy: false };
  if (video) video.pause();
  openOverlay('<div class="modal sm" role="dialog" aria-label="Report a problem" id="repmodal"></div>');
  drawReport();
}
function drawReport() {
  const R = state.rep; const m = $('#repmodal'); if (!m) return;
  if (R.done) {
    m.innerHTML = `<div class="mhead"><h2>Report received</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div><div class="mbody"><div class="done"><div class="check"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div><h3 class="mono" style="font-size:22px">${esc(R.done)}</h3><p>A moderator will look at it. Quote this number if you contact us.${config.contact ? ` <br><span class="mono">${esc(config.contact)}</span>` : ''}</p></div></div>`;
    return;
  }
  m.innerHTML = `<div class="mhead"><h2>Report a problem</h2><button class="iconbtn" data-action="close" aria-label="Close">${ic('x', 20)}</button></div>
    <div class="mbody"><div class="pickrow" style="margin-bottom:14px;cursor:default">${R.record ? `<span class="ic-tile">${ic('film', 20)}</span><div><b class="mono">${esc(R.record)}</b><span>${esc(D ? D.ev.title : '')}</span></div>` : `<span class="ic-tile">${ic('calendar', 20)}</span><div><b>${esc(D ? D.ev.title : '')}</b><span>The event page</span></div>`}</div>
    <div class="reasons">${REASONS.map(([k, a, b]) => `<button class="reason ${R.reason === k ? 'on' : ''}" data-reason="${k}"><b>${a}</b><span class="radio"></span>${b ? `<span>${b}</span>` : ''}</button>`).join('')}</div>
    ${R.reason ? `<div class="field" style="margin-top:14px"><label for="rp-d">Details <span style="color:var(--dim)">(optional)</span></label><textarea id="rp-d" rows="3" maxlength="2000" placeholder="What should a moderator know?">${esc(R.details)}</textarea></div>
    <div class="field"><label for="rp-c">How can we reach you? <span style="color:var(--dim)">(optional)</span></label><input id="rp-c" maxlength="200" value="${esc(R.contact)}" placeholder="Email or phone — only if you want a reply"></div>` : ''}
    <p class="err" id="rperr" hidden></p></div>
    <div class="mfoot"><span class="hint">Your name isn’t required</span><button class="btn btn-primary" data-action="sendreport" ${R.reason && !R.busy ? '' : 'disabled'}>${R.busy ? 'Sending…' : 'Send report'}</button></div>`;
  const d = $('#rp-d'), c = $('#rp-c');
  if (d) d.addEventListener('input', () => { R.details = d.value; });
  if (c) c.addEventListener('input', () => { R.contact = c.value; });
}
async function sendReport() {
  const R = state.rep; if (!R || R.busy) return;
  R.busy = true; drawReport();
  try { const r = await api('/api/reports', { body: { record: R.record, event: R.event, reason: R.reason, details: R.details, contact: R.contact } }); R.done = r.ref; }
  catch (e) { R.busy = false; drawReport(); const el = $('#rperr'); if (el) { el.textContent = e.message; el.hidden = false; } return; }
  drawReport();
}

/* ---------- verify ---------- */
function renderVerify() {
  setNav('verify'); setTitle('Verify a file');
  mount(`<div class="wrap" style="max-width:820px;padding-top:56px">
    <div style="text-align:center;margin-bottom:28px"><span class="chip" style="margin-bottom:16px">${ic('shield', 15)}SHA-256</span><h1 class="page-h">Is this video in the archive?</h1><p style="color:var(--muted);font-size:17px;margin:0">Drop any video. We compare its fingerprint — the file never leaves your device.</p></div>
    <label class="drop" id="vdrop" style="padding:56px 20px"><input type="file" class="vh" id="vfile"><span class="big" style="background:#12b886;box-shadow:0 16px 40px -12px #12b886">${ic('shield', 32, 2.2)}</span><b>Drop a video here</b><p>or tap to choose a file</p></label>
    <div id="vres" style="margin-top:18px" aria-live="polite"></div>
    <div class="field" style="margin-top:26px"><label for="vhash">Or paste a SHA-256 fingerprint</label><div class="privlink"><input id="vhash" class="mono" placeholder="64 characters, 0–9 and a–f" spellcheck="false" autocomplete="off"><button class="btn btn-primary btn-sm" data-action="verifyhash">Check</button></div></div>
  </div>${footer()}`, 'verify');
  const d = $('#vdrop'), inp = $('#vfile');
  ['dragenter', 'dragover'].forEach((e) => d.addEventListener(e, (x) => { x.preventDefault(); d.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => d.addEventListener(e, (x) => { x.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', (e) => verifyFile(e.dataTransfer.files[0]));
  inp.addEventListener('change', () => verifyFile(inp.files[0]));
}
async function verifyFile(file) {
  if (!file) return;
  const r = $('#vres');
  r.innerHTML = `<div class="file"><div class="th">${ic('hash', 26)}</div><div style="min-width:0"><b>${esc(file.name)}</b><div class="sub"><span>${bytes(file.size)}</span><span id="vpct">Fingerprinting on your device… 0%</span></div></div><span></span><div class="bar"><i id="vbar" style="width:0%"></i></div></div>`;
  const h = await sha256File(file, (p) => { const b = $('#vbar'), t = $('#vpct'); if (b) b.style.width = p * 100 + '%'; if (t) t.textContent = `Fingerprinting on your device… ${Math.round(p * 100)}%`; });
  await verifyHash(h, file.name);
}
async function verifyHash(h, name) {
  const r = $('#vres'); if (!r) return;
  h = (h || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) { toast('That isn’t a SHA-256 fingerprint', 'alert'); return; }
  let res;
  try { res = await api(`/api/verify/${h}`); } catch (e) { r.innerHTML = `<div class="card"><b>${esc(e.message)}</b></div>`; return; }
  const m = res.matches.find((x) => x.status === 'published');
  const other = res.matches.find((x) => x.status !== 'published');
  const hashRow = `<div class="hash" style="margin-top:14px;background:var(--surface-2);color:var(--text)">${ic('hash', 15)}<span>${h}</span><button data-action="copytext" data-text="${h}" aria-label="Copy">${ic('copy', 15)}</button></div>`;
  if (m) {
    r.innerHTML = `<div class="card" style="border-color:var(--ok)"><div style="display:flex;gap:14px;align-items:center"><div class="check" style="width:56px;height:56px">${ic('check', 28, 3)}</div><div style="min-width:0"><h4 style="font-size:22px">Exact match</h4><p>${name ? esc(name) + ' is' : 'This file is'} on record as <a class="mono" href="/r/${m.record}" style="color:var(--text);text-decoration:underline">${m.record}</a>${m.original ? ' (the uploader’s original, before hidden details were removed)' : ''} — filmed ${fmtDay(localMin(m.t, m.tz))}, ${fmtTime(localMin(m.t, m.tz), true)} ${tzName(m.tz, m.t)}, ${esc(m.title)}.</p></div></div>${hashRow}</div>`;
  } else if (other) {
    r.innerHTML = `<div class="card"><h4 style="font-size:22px">Uploaded, not public</h4><p>This exact file was uploaded as <b class="mono">${esc(other.record || '')}</b>. Status: ${esc(other.status === 'pending' ? 'waiting for review' : other.reason || other.status)}.</p>${hashRow}</div>`;
  } else {
    r.innerHTML = `<div class="card"><div style="display:flex;gap:14px;align-items:center"><div style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--surface-3);flex:none">${ic('search', 26)}</div><div><h4 style="font-size:22px">No exact match</h4><p>This exact file isn’t in the archive. An edited, trimmed or re-compressed copy (for example one sent through a messaging app) has a different fingerprint.</p></div></div>${hashRow}</div>`;
  }
}

/* ---------- receipts ---------- */
const STATUS = { pending: ['In review', 'clock'], published: ['Public', 'check'], rejected: ['Not accepted', 'x'], hidden: ['Hidden', 'eyeoff'], removed: ['Removed', 'trash'], withdrawn: ['Removed by you', 'trash'] };
async function renderReceipt() {
  setNav('receipt'); setTitle('My uploads');
  const token = location.hash.slice(1);
  const saved = store.get('roe.receipts', []);
  if (!token) {
    mount(`<div class="wrap" style="max-width:820px;padding-top:56px">
      <h1 class="page-h">My uploads</h1><p style="color:var(--muted);font-size:17px;margin:0 0 26px">Receipts saved on this device. Each one lets you check or remove the videos you uploaded — there are no accounts.</p>
      ${saved.length ? `<div class="pick">${saved.map((s) => `<a class="pickrow" href="/receipt#${esc(s.token)}" style="--accent:${esc(s.color || '#ff3d7f')}"><span class="ic-tile" style="color:var(--accent)">${ic('receipt', 22)}</span><div><b>${esc(s.title)}</b><span>${plural(s.count || 0, 'video')} · uploaded ${ago(s.at)}</span></div>${ic('right', 18)}</a>`).join('')}</div>`
      : `<div class="empty card" style="padding:48px 20px"><b>No receipts on this device</b>After an upload you get a private receipt link. Open it here to see your videos.<div style="margin-top:16px"><a class="btn btn-accent" href="/upload">${ic('upload', 17)}Upload footage</a></div></div>`}
      <div class="field" style="margin-top:26px"><label for="rlink">Have a receipt link from another device?</label><div class="privlink"><input id="rlink" placeholder="Paste the receipt link" autocomplete="off"><button class="btn btn-primary btn-sm" data-action="openreceipt">Open</button></div></div>
    </div>${footer()}`, 'receipt');
    return;
  }
  loading();
  let r;
  try { r = await api('/api/receipt', { body: { token } }); } catch (e) { errorPage(e); return; }
  const ev = r.event;
  const tz = ev.tz;
  mount(`<div class="wrap" style="max-width:860px;padding-top:56px;--accent:${ev.color}">
    <span class="chip" style="margin-bottom:14px">${ic('lock', 14)}Private receipt — don’t share this page’s link</span>
    <h1 class="page-h">Your uploads</h1>
    <p style="color:var(--muted);font-size:17px;margin:0 0 22px">To <a href="/e/${ev.slug}" style="color:var(--text);text-decoration:underline">${esc(ev.title)}</a> · ${fmtDate(ev.date)}</p>
    <div class="files" id="rcpt">${r.clips.map((c) => `<div class="file" data-id="${c.id}">
      <div class="th">${c.poster ? `<img src="${esc(c.poster)}" alt="">` : ic('film', 26)}</div>
      <div style="min-width:0"><b>${c.record && c.status === 'published' ? `<a href="/r/${c.record}" class="mono">${c.record}</a>` : `<span class="mono">${esc(c.record || '')}</span>`}</b>
        <div class="sub"><span class="st st-${c.status}">${ic((STATUS[c.status] || STATUS.pending)[1], 13)}${(STATUS[c.status] || [c.status])[0]}</span><span>${esc(c.name)}</span><span>${fmtTime(localMin(c.t, tz))}</span><span>${bytes(c.z)}</span>${c.reason && c.status !== 'published' ? `<span>${esc(c.reason)}</span>` : ''}</div></div>
      ${['withdrawn', 'removed', 'rejected'].includes(c.status) ? '<span></span>' : `<button class="btn btn-ghost btn-sm" data-action="withdraw" data-id="${c.id}">${ic('trash', 15)}Remove</button>`}
    </div>`).join('') || '<div class="empty">No finished uploads on this receipt.</div>'}</div>
    <p style="color:var(--dim);font-size:13.5px;margin-top:18px">Removing a video deletes the file from the archive. Its record number stays, marked “Removed by the person who uploaded it”.</p>
  </div>${footer()}`, 'receipt:' + token.slice(0, 6));
  const list = store.get('roe.receipts', []);
  if (!list.find((x) => x.token === token)) { list.unshift({ token, slug: ev.slug, title: ev.title, color: ev.color, at: r.created, count: r.clips.length }); store.set('roe.receipts', list.slice(0, 50)); }
}
async function withdraw(btn) {
  if (!btn.classList.contains('confirm')) { btn.classList.add('confirm'); btn.innerHTML = `${ic('trash', 15)}Tap again to remove`; setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.innerHTML = `${ic('trash', 15)}Remove`; } }, 4000); return; }
  btn.disabled = true;
  try {
    await api('/api/receipt/withdraw', { body: { token: location.hash.slice(1), clip: Number(btn.dataset.id) } });
    toast('Removed from the archive', 'trash');
    cache.events = {}; cache.home = null;
    renderReceipt();
  } catch (e) { btn.disabled = false; toast(e.message, 'alert'); }
}

/* ---------- printable poster ---------- */
async function renderPoster(slug) {
  setNav(''); const d = await loadEvent(slug); if (d.removed) return errorPage({ status: 404 });
  const ev = d.ev; const url = `${origin()}/u/${ev.code}`;
  setTitle('Poster · ' + ev.title);
  mount(`<div class="poster" style="--accent:${ev.color}">
    <div class="poster-tools"><a class="btn btn-ghost" href="/e/${ev.slug}">${ic('left', 16)}Back</a><button class="btn btn-primary" data-action="print">${ic('download', 16)}Print or save as PDF</button></div>
    <div class="sheet">
      <div class="logo"><span class="dot"></span>${esc(config.name)}</div>
      <h1>Were you there?<br>Add your footage.</h1>
      <div class="bigdate">${bigDate(ev.date)}</div>
      <h2>${esc(ev.title)}</h2>
      <p>${esc(ev.city)}${ev.country ? ', ' + esc(ev.country) : ''}</p>
      <div class="qrbox" id="posterqr"></div>
      <div class="code mono">${ev.code}</div>
      <p class="mono">${esc(url.replace(/^https?:\/\//, ''))}</p>
      <p class="small">Scan with any phone camera. No app, no account. Location is removed from videos before upload.</p>
    </div></div>`, 'poster');
  qr($('#posterqr'), url);
}

/* ---------- global events ---------- */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    const href = a.getAttribute('href');
    if (a.dataset.setplace && state.ev) state.pendingPlace = Number(a.dataset.setplace);
    if (href.startsWith('/') && !href.startsWith('//') && !a.target && !a.hasAttribute('download') && !a.dataset.native && !/^\/(m|api)\//.test(href)) {
      e.preventDefault();
      go(href);
      return;
    }
  }
  const t = e.target.closest('[data-action],[data-view],[data-filter],[data-place],[data-angle],[data-kind],[data-reason]');
  if (!t) return;
  const act = t.dataset.action;
  if (t.dataset.view) { const v = t.dataset.view; history.replaceState(null, '', `/e/${state.ev.slug}${v === 'timeline' ? '' : '/' + v}`); state.base = location.pathname; switchView(v); return; }
  if (t.dataset.filter) { const f = state.ev.filters; f.has(t.dataset.filter) ? f.delete(t.dataset.filter) : f.add(t.dataset.filter); t.classList.toggle('on'); t.setAttribute('aria-pressed', f.has(t.dataset.filter)); refreshBars(); renderMain(true); return; }
  if (t.dataset.place && state.ev) { const id = Number(t.dataset.place); state.ev.place = state.ev.place === id ? null : id; refreshBars(); renderMain(true); return; }
  if (t.dataset.angle) { switchClip(t.dataset.angle, true); return; }
  if (t.dataset.kind) { state.nw.kind = t.dataset.kind; $$('.cats button').forEach((b) => b.classList.toggle('on', b.dataset.kind === state.nw.kind)); return; }
  if (t.dataset.reason) { state.rep.reason = t.dataset.reason; drawReport(); return; }
  const ev = D && D.ev;
  switch (act) {
    case 'close': e.preventDefault(); closeOverlay(); break;
    case 'search': openSearch(); break;
    case 'theme': setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); break;
    case 'reload': route(); break;
    case 'playday': state.ev.playing ? stopPlayDay() : startPlayDay(); break;
    case 'clearsel': state.ev.sel = null; renderMain(true); break;
    case 'clearplace': state.ev.place = null; refreshBars(); renderMain(true); break;
    case 'share-event': share(`${origin()}/e/${ev.slug}`, ev.title); break;
    case 'qr-event': showQr(ev); break;
    case 'dl-event': showDownloads(ev); break;
    case 'report-event': openReport({ event: ev.slug }); break;
    case 'print': window.print(); break;
    case 'ptoggle': if (video) { if (video.paused) video.play().catch(() => {}); else video.pause(); } break;
    case 'pmute': if (video) { video.muted = !video.muted; store.set('roe.muted', video.muted); drawControls(); } break;
    case 'pfull': { const s = $('#stage'); const go2 = s && (s.requestFullscreen || s.webkitRequestFullscreen); if (video && video.webkitEnterFullscreen && !go2) video.webkitEnterFullscreen(); else if (go2) Promise.resolve(go2.call(s)).catch(() => {}); break; }
    case 'reveal': state.player.revealed = true; drawPlayer(true); break;
    case 'pprev': case 'pnext': { const i = D.clips.findIndex((x) => x.r === state.player.r); const n = D.clips[i + (act === 'pnext' ? 1 : -1)]; if (n) switchClip(n.r, false); break; }
    case 'copyid': copy(state.player.r, 'Record number copied'); break;
    case 'copyhash': copy(clipNow().sha, 'Fingerprint copied'); break;
    case 'copytext': copy(t.dataset.text); break;
    case 'shareat': { const c = clipNow(); const s = Math.floor(video ? video.currentTime : 0); share(`${origin()}/r/${c.r}${s ? '?t=' + s : ''}`, c.r); break; }
    case 'cite': { const c = clipNow(); copy(`${config.name}, ${c.r}, filmed ${fmtDate(D.ev.date)} ${fmtTime(c.lm, true)} ${tzName(D.ev.tz, c.t)}${c.place ? ', ' + c.place : ''} (${D.ev.title}). SHA-256 ${c.sha}. ${origin()}/r/${c.r}`, 'Citation copied'); break; }
    case 'report': openReport({ record: state.player.r }); break;
    case 'sendreport': sendReport(); break;
    case 'create': createEvent(); break;
    case 'verifyhash': verifyHash($('#vhash').value); break;
    case 'withdraw': withdraw(t); break;
    case 'openreceipt': { const v = $('#rlink').value.trim(); const tok = v.includes('#') ? v.split('#').pop() : v; if (tok.length > 20) go('/receipt#' + tok); else toast('That doesn’t look like a receipt link', 'alert'); break; }
    default: break;
  }
});

window.addEventListener('popstate', () => route());
window.addEventListener('hashchange', () => { if (location.pathname.startsWith('/receipt')) route(); });
$('#pocket').addEventListener('click', () => $('#pocket').classList.remove('on'));

document.addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (e.key === 'Escape' && ov.classList.contains('open')) { closeOverlay(); return; }
  if (typing || state.page === 'admin') return;
  if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openSearch(); return; }
  if (state.player && video) {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (video.paused) video.play().catch(() => {}); else video.pause(); }
    if (e.key === 'ArrowRight') video.currentTime += 5;
    if (e.key === 'ArrowLeft') video.currentTime -= 5;
    if (e.key === 'm') { video.muted = !video.muted; drawControls(); }
  }
  if (state.player) {
    if (e.key === ']' || e.key === 'ArrowDown') { e.preventDefault(); $('[data-action="pnext"]')?.click(); }
    if (e.key === '[' || e.key === 'ArrowUp') { e.preventDefault(); $('[data-action="pprev"]')?.click(); }
  }
});

function setTheme(th) {
  document.documentElement.dataset.theme = th;
  try { localStorage.setItem('roe.theme', th); } catch { /* ignore */ }
  paintThemeIcon();
}
function paintThemeIcon() {
  const b = $('[data-action="theme"]'); if (b) b.innerHTML = ic(document.documentElement.dataset.theme === 'light' ? 'sun' : 'moon', 18);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = document.documentElement.dataset.theme === 'light' ? '#f4f3ef' : '#08080b';
}

(async function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  paintThemeIcon();
  try { Object.assign(config, await api('/api/config')); } catch { /* use defaults */ }
  await route();
})();
