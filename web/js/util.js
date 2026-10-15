// Shared helpers: icons, formatting, time zones, API calls, toasts, QR codes, navigation.
import qrcode from 'qrcode-generator';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const I = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.8M6.5 7.6A17 17 0 0 0 3 12s4 6 9 6a9 9 0 0 0 4.3-1.1"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  face: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9 15c1.6 1.3 4.4 1.3 6 0"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  layers: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M8 4h11a2 2 0 0 1 2 2v9"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  quote: '<path d="M9 7H5v6h4v-2M19 7h-4v6h4v-2M9 13c0 2-1 3-3 4M19 13c0 2-1 3-3 4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
};
export const ic = (n, s = 18, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;

/* ---------- formatting ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function dur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export function hm(sec) { // "9h 41m"
  const m = Math.round((sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}
export function bytes(b) {
  if (!b) return '0 MB';
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GB';
  if (b >= 1024 ** 2) return Math.max(1, Math.round(b / 1024 ** 2)) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const num = (n) => Number(n || 0).toLocaleString('en-US');

/* ---------- time zones ----------
   Clip times are stored in UTC. On screen they are shown as the wall-clock time where the event
   happened. "Local minutes" = minutes since 1970 on that wall clock, so plain arithmetic works. */
const fmts = {};
const partsFmt = (tz) => fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-GB', {
  timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}));
export function localMin(iso, tz) {
  const p = {};
  try { partsFmt(tz).formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; }); } catch { return new Date(iso).getTime() / 60000; }
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 60000;
}
const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtTime(lm, withSec) {
  const d = new Date(Math.floor(lm * 60) * 1000);
  const h = d.getUTCHours();
  return `${((h + 11) % 12) + 1}:${pad(d.getUTCMinutes())}${withSec ? ':' + pad(d.getUTCSeconds()) : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtHour(lm) { const h = new Date(lm * 60000).getUTCHours(); return `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`; }
export function fmtDay(lm) { const d = new Date(lm * 60000); return `${D[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]}`; }
export function fmtDate(date) { // 'YYYY-MM-DD' → 'Sat 10 Oct 2026'
  const d = new Date(date + 'T12:00:00Z');
  return `${D[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const bigDate = (date) => `${date.slice(8, 10)}<span>.</span>${date.slice(5, 7)}<span>.</span>${date.slice(2, 4)}`;
export const shortDate = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
export function tzName(tz, iso) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(iso || Date.now())).find((x) => x.type === 'timeZoneName').value; } catch { return tz; }
}
export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/* ---------- labels ---------- */
export const LABEL = {
  verified: ['Verified', 'check', 'Matched to the event by independent evidence'],
  consistent: ['Place checked', 'pin', 'Time and place are consistent with the event'],
  unverified: ['Not yet verified', 'clock', 'Shown as uploaded; not independently checked'],
  disputed: ['Disputed', 'alert', 'Questions have been raised about this clip'],
};
export const badge = (s) => `<span class="badge ${s}" title="${esc((LABEL[s] || LABEL.unverified)[2])}">${ic((LABEL[s] || LABEL.unverified)[1], 13, s === 'verified' ? 3 : 2.4)}${(LABEL[s] || LABEL.unverified)[0]}</span>`;
export const sIco = (s) => (s === 'unverified' || !LABEL[s] ? '' : `<span class="sico ${s}" title="${LABEL[s][0]}">${ic(LABEL[s][1], 13, 2.6)}</span>`);

/* ---------- media URLs (signed storage URLs from the API, /m/ routes as fallback) ---------- */
export const posterOf = (c) => c.pu || '/m/p/' + c.r;
export const videoOf = (c) => c.vu || '/m/v/' + c.r;
export const downloadOf = (c) => c.du || '/m/d/' + c.r;
export const coverOf = (e) => e.coverUrl || (e.cover ? '/m/p/' + e.cover : null);

/* ---------- API ----------
   Times out (10 s GET, 30 s otherwise; opts.timeout overrides) and retries a GET once on a
   network error, timeout or 5xx. Errors carry .status when the server answered. */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function apiOnce(path, init, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), ms);
  let r;
  try { r = await fetch(path, ctl ? { ...init, signal: ctl.signal } : init); }
  catch {
    const e = new Error(ctl && ctl.signal.aborted ? 'The server is taking too long to answer. Check your connection and try again.' : 'No connection. Check your internet and try again.');
    e.retry = true; throw e;
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) { const e = new Error((data && data.error) || `Request failed (${r.status})`); e.status = r.status; e.retry = r.status >= 500; throw e; }
  return data;
}
// Moderators get uncached public data: the CDN caches /api/home and /api/events/* per URL only,
// so a signed-in moderator would otherwise see the public copy (e.g. a hidden event as "removed").
let moderator = false;
try { moderator = localStorage.getItem('roe.mod') === '1'; } catch { /* ignore */ }
export function setModerator(on) {
  moderator = !!on;
  try { on ? localStorage.setItem('roe.mod', '1') : localStorage.removeItem('roe.mod'); } catch { /* ignore */ }
}
export async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const get = init.method === 'GET';
  if (get) init.cache = 'no-cache'; // the app keeps its own cache; never let the browser hand back stale JSON
  if (get && (opts.fresh || moderator) && /^\/api\/(home|events\/)/.test(path)) path += (path.includes('?') ? '&' : '?') + 'fresh=1';
  const ms = opts.timeout || (get ? 10000 : 30000);
  try { return await apiOnce(path, init, ms); } catch (e) {
    if (!get || !e.retry || opts.retry === false) throw e;
    await sleep(400);
    return apiOnce(path, init, ms);
  }
}

/* ---------- UI bits ---------- */
let toastT;
export function toast(msg, icon = 'check') {
  const el = $('#toast');
  el.innerHTML = ic(icon, 18, 2.4) + `<span>${esc(msg)}</span>`;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
export function copy(text, msg = 'Copied') {
  const done = () => toast(msg, 'copy');
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); done();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
export function share(url, title) {
  if (navigator.share && matchMedia('(pointer:coarse)').matches) { navigator.share({ title, url }).catch(() => {}); return; }
  copy(url, 'Link copied');
}
export function qr(el, text) {
  if (!el) return;
  const code = qrcode(0, 'M'); code.addData(text); code.make();
  el.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  const svg = el.querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = '100%'; svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code for ' + text); }
}
export const origin = () => location.origin;
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ---------- navigation (set up by main.js) ---------- */
export const nav = { route: () => {} };
export function go(path, { replace = false } = {}) {
  if (path === location.pathname + location.search + location.hash && !replace) { nav.route(); return; }
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  nav.route();
}
export const config = { name: 'Records of Event', moderation: 'pre', maxFileBytes: 5 * 1024 ** 3, storage: true, kinds: [] };
