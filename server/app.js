// One request handler for the whole backend: JSON API under /api, media redirects under /m,
// and server-rendered <head> tags for shareable pages (/e, /r, /u, /upload).
import crypto from 'node:crypto';
import { ready, q, q1, next } from './db.js';
import * as store from './storage.js';
import { TEMPLATE } from './template.js';

const env = process.env;
const cfg = {
  name: env.SITE_NAME || 'Records of Event',
  moderation: env.MODERATION === 'post' ? 'post' : 'pre',
  maxFileBytes: (Number(env.MAX_FILE_GB) || 5) * 1024 ** 3,
  dailyBytes: (Number(env.DAILY_UPLOAD_GB) || 50) * 1024 ** 3,
  contact: env.CONTACT_EMAIL || '',
  operator: env.OPERATOR_NAME || '',
  repo: env.REPO_URL || '',
};
const SECRET = env.APP_SECRET || crypto.createHash('sha256').update('roe:' + (env.DATABASE_URL || env.POSTGRES_URL || 'dev') + (env.ADMIN_PASSWORD || '')).digest('hex');
const KINDS = ['Protest', 'March', 'Rally', 'Strike', 'Vigil', 'Election', 'Disaster', 'Accident', 'Public meeting', 'Other'];
const LABELS = ['verified', 'consistent', 'unverified', 'disputed'];
const REASONS = ['me', 'injury', 'wrong-event', 'wrong-time', 'private', 'copyright', 'illegal', 'other'];
const PALETTE = ['#ff3d7f', '#ff7a1a', '#22c3e6', '#8b5cf6', '#12b886', '#ffb020', '#e64980', '#4c6ef5', '#f03e3e', '#0ca678'];
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', '3gp', 'avi', 'mts', 'ts'];
const PART_MAX = 10000;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; this.expose = true; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const need = (cond, message, status = 400) => { if (!cond) fail(status, message); };

/* ---------- small helpers ---------- */
const hmacHex = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const shaHex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pad = (n, w = 2) => String(n).padStart(w, '0');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const todayIn = (tz) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
const yymmdd = (date) => date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
const randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const slugify = (s) => s.replace(/['’]/g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const extOf = (name) => { const e = (name.split('.').pop() || '').toLowerCase(); return VIDEO_EXT.includes(e) ? e : 'mp4'; };

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}
// IPs are never stored. A keyed hash that changes every day is enough for rate limits.
const ipHash = (req) => hmacHex(clientIp(req) + '|' + new Date().toISOString().slice(0, 10)).slice(0, 24);

// Counts a hit and returns the total for this window; limit() turns it into a 429.
async function hit(req, name, windowSec = 3600) {
  const w = Math.floor(Date.now() / 1000 / windowSec);
  return (await q1('insert into hits (k, w) values ($1, $2) on conflict (k, w) do update set n = hits.n + 1 returning n', [name + ':' + ipHash(req), w])).n;
}
const tooMany = (n, max) => { if (n > max) fail(429, 'Too many requests from your connection. Please wait a little and try again.'); };
async function limit(req, name, max, windowSec = 3600) { tooMany(await hit(req, name, windowSec), max); }

function siteUrl(req) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body) || '{}'); } catch { fail(400, 'Invalid JSON'); }
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1e6) fail(413, 'Request too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail(400, 'Invalid JSON'); }
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (typeof body === 'string' || Buffer.isBuffer(body)) { res.end(body); return; }
  if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
  if (!res.getHeader('cache-control')) res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
const cached = (seconds) => ({ 'cache-control': `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}` });

/* ---------- admin session ---------- */
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function adminOf(req) {
  const c = cookies(req).roe_admin;
  if (!c || !env.ADMIN_PASSWORD) return null;
  const [name, exp, sig] = c.split('.');
  if (!sig || Number(exp) < Date.now()) return null;
  const good = hmacHex('admin|' + name + '|' + exp);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  return Buffer.from(name, 'base64url').toString('utf8');
}
function requireAdmin(req) {
  const who = adminOf(req);
  need(who, 'Please sign in as a moderator.', 401);
  if (req.method === 'POST' && req.headers.origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    need(new URL(req.headers.origin).host === host, 'Cross-site request blocked', 403);
  }
  return who;
}
const log = (actor, action, target, detail = null) => q('insert into modlog (actor, action, target, detail) values ($1, $2, $3, $4)', [actor, action, target, detail ? JSON.stringify(detail) : null]);

/* ---------- serializers ---------- */
// One pass over each event's clips (index clips_event) instead of a subquery per figure.
const EVENT_SQL = `select e.id, e.slug, e.code, e.title, e.kind, e.date, e.tz, e.city, e.country, e.aliases, e.summary,
  e.figures, e.sources, e.color, e.status, e.created_at, e.updated_at,
  s.n, s.pending, s.checked, coalesce(s.secs, 0)::float8 as secs, s.last_upload, pl.nplaces
  from events e
  left join lateral (select count(*) filter (where c.status = 'published')::int as n,
    count(*) filter (where c.status = 'pending')::int as pending,
    count(*) filter (where c.status = 'published' and c.label in ('verified', 'consistent'))::int as checked,
    sum(c.duration) filter (where c.status = 'published') as secs,
    max(c.created_at) as last_upload
    from clips c where c.event_id = e.id and c.status in ('pending', 'published')) s on true
  left join lateral (select count(*)::int as nplaces from places p where p.event_id = e.id) pl on true`;
// Columns pubClip needs (keys are only used to sign media URLs, never sent as-is).
const CLIP_COLS = `c.id, c.record, c.event_id, c.place_id, c.captured_at, c.duration, c.width, c.height, c.label, c.sensitive, c.note,
  c.size, c.sha256, c.sha256_original, c.time_source, c.has_poster, c.mime, c.stripped, c.published_at, c.storage_key, c.poster_key`;

const isLive = (e) => e.status !== 'hidden' && ((e.last_upload && Date.now() - new Date(e.last_upload).getTime() < 3 * 3600e3) || e.date === todayIn(e.tz));

function pubEvent(e, extra = {}) {
  return {
    slug: e.slug, code: e.code, title: e.title, kind: e.kind, date: e.date, tz: e.tz, city: e.city, country: e.country,
    aliases: e.aliases || [], summary: e.summary, figures: e.figures || null, sources: e.sources || [], color: e.color,
    status: e.status, created: e.created_at, live: isLive(e),
    n: e.n ?? 0, pending: e.pending ?? 0, checked: e.checked ?? 0, secs: e.secs ?? 0, nplaces: e.nplaces ?? 0, ...extra,
  };
}
// Signed storage URLs go straight into the JSON so browsers skip the /m/* redirect (function +
// DB + 302) per image and video. They stay valid for 6+ hours, far longer than any API cache.
const posterUrl = (c) => (c.has_poster && c.poster_key ? store.getUrl(c.poster_key) : null);
const downloadName = (c) => `${c.record}.${extOf(c.storage_key)}`;
function pubClip(c) {
  return {
    r: c.record, t: c.captured_at, d: c.duration, w: c.width, h: c.height, p: c.place_id, s: c.label, x: c.sensitive,
    n: c.note, z: c.size, sha: c.sha256, sho: c.sha256_original, ts: c.time_source, img: c.has_poster, m: c.mime,
    stripped: c.stripped || [], at: c.published_at,
    pu: posterUrl(c), vu: store.getUrl(c.storage_key), du: store.getUrl(c.storage_key, { download: downloadName(c) }),
  };
}

// Cover pick: landscape first, then most recently published; never sensitive or poster-less.
const COVER_ORDER = '(width >= height) desc nulls last, published_at desc';
const coverRank = (c) => (c.width == null || c.height == null ? 0 : c.width >= c.height ? 2 : 1);
const pickCovers = (clips, n) => clips.filter((c) => c.has_poster && !c.sensitive)
  .sort((a, b) => coverRank(b) - coverRank(a) || new Date(b.published_at) - new Date(a.published_at)).slice(0, n);
const coverOut = (rows) => ({ covers: rows.map((r) => r.record), coverUrls: rows.map((r) => store.getUrl(r.poster_key)) });

// { [event id]: [{ record, poster_key }] }
async function coversFor(ids, perEvent = 1) {
  if (!ids.length) return {};
  const rows = await q(`select event_id, record, poster_key from (
      select event_id, record, poster_key, row_number() over (partition by event_id order by ${COVER_ORDER}) as rn
      from clips where status = 'published' and has_poster and not sensitive and event_id = any($1)) x where rn <= $2`, [ids, perEvent]);
  const out = {};
  rows.forEach((r) => { (out[r.event_id] = out[r.event_id] || []).push(r); });
  return out;
}
// Fields for an event card: `cover` record plus its signed `coverUrl`.
const cardCover = (rows) => { const r = rows?.[0]; return { cover: r ? r.record : null, coverUrl: r ? store.getUrl(r.poster_key) : null }; };
async function sparksFor(ids, bins = 22) {
  if (!ids.length) return {};
  const rows = await q(`with r as (select event_id, min(captured_at) as mn, max(captured_at) as mx from clips where status = 'published' and event_id = any($1) group by event_id)
    select c.event_id, width_bucket(extract(epoch from c.captured_at)::float8, extract(epoch from r.mn)::float8, extract(epoch from r.mx)::float8 + 1, $2) as b, count(*)::int as n
    from clips c join r on r.event_id = c.event_id where c.status = 'published' group by 1, 2`, [ids, bins]);
  const out = {};
  rows.forEach((r) => { const a = out[r.event_id] || (out[r.event_id] = new Array(bins).fill(0)); a[Math.min(bins, Math.max(1, r.b)) - 1] = r.n; });
  return out;
}

async function eventBySlug(slug) { return q1(`${EVENT_SQL} where e.slug = $1`, [slug]); }

/* ---------- public API ---------- */
async function apiConfig() {
  return {
    name: cfg.name, moderation: cfg.moderation, maxFileBytes: cfg.maxFileBytes, storage: store.configured(),
    contact: cfg.contact, operator: cfg.operator, repo: cfg.repo, kinds: KINDS,
  };
}

// Two round-trip levels: events + just-in together, then everything that needs the event ids.
async function apiHome() {
  const [rows, justInRows] = await Promise.all([
    q(`${EVENT_SQL} where e.status = 'published' order by e.date desc, e.id desc limit 60`),
    q(`select ${CLIP_COLS}, e.slug, e.title, e.color, e.tz, p.name as place from clips c
      join events e on e.id = c.event_id left join places p on p.id = c.place_id
      where c.status = 'published' and e.status = 'published' and not c.sensitive order by c.published_at desc limit 6`),
  ]);
  const ids = rows.map((e) => e.id);
  const order = rows.map((e) => ({ e, live: isLive(e), n: e.n ?? 0 }))
    .sort((a, b) => (b.live - a.live) || (b.live && a.live ? b.n - a.n : 0));
  const top = (order.find((o) => o.n > 0) || order[0])?.e || null;
  const [covers, sparks, latestRows, places] = await Promise.all([
    coversFor(ids, 4), sparksFor(ids),
    top ? q(`select ${CLIP_COLS} from clips c where c.event_id = $1 and c.status = 'published' and not c.sensitive order by c.captured_at desc limit 12`, [top.id]) : [],
    top ? q('select id, name from places where event_id = $1', [top.id]) : [],
  ]);
  const events = order.map(({ e }) => pubEvent(e, { ...cardCover(covers[e.id]), spark: sparks[e.id] || null }));
  const featured = top && events.find((e) => e.slug === top.slug);
  const justIn = justInRows.map((c) => ({ ...pubClip(c), slug: c.slug, title: c.title, color: c.color, tz: c.tz, place: c.place }));
  return { events, featured: featured && { ...featured, ...coverOut(covers[top.id] || []), places }, latest: latestRows.map(pubClip), justIn };
}

// All three queries go out at once, keyed by slug; covers and place counts come from the clip list.
async function apiEvent(req, slug) {
  const [e, placeRows, clips] = await Promise.all([
    eventBySlug(slug),
    q('select p.id, p.name from places p join events e on e.id = p.event_id where e.slug = $1', [slug]),
    q(`select ${CLIP_COLS} from clips c join events e on e.id = c.event_id where e.slug = $1 and c.status = 'published' order by c.captured_at, c.id`, [slug]),
  ]);
  need(e, 'Event not found', 404);
  if (e.status === 'hidden' && !adminOf(req)) return { removed: true, title: e.title };
  const count = {};
  clips.forEach((c) => { if (c.place_id != null) count[c.place_id] = (count[c.place_id] || 0) + 1; });
  const places = placeRows.map((p) => ({ id: p.id, name: p.name, n: count[p.id] || 0 }))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const covers = pickCovers(clips, 4);
  return { event: pubEvent(e, { places, ...coverOut(covers), coverUrl: covers[0] ? store.getUrl(covers[0].poster_key) : null }), clips: clips.map(pubClip) };
}

async function apiRecord(rec) {
  const c = await q1(`select c.record, c.status, c.reason, e.slug from clips c join events e on e.id = c.event_id where c.record = $1`, [rec.toUpperCase()]);
  need(c, 'Record not found', 404);
  return { record: c.record, slug: c.slug, status: c.status, reason: c.status === 'published' ? '' : c.reason };
}

async function apiSearch(url) {
  const raw = str(url.searchParams.get('q'), 120);
  const mode = url.searchParams.get('mode');
  if (raw.length < 2) return { events: [], places: [], records: [] };
  const out = { events: [], places: [], records: [] };
  const rec = raw.toUpperCase().replace(/\s+/g, '').match(/^ROE-?(\d{6})-?(\d{1,6})$/);
  if (rec) {
    const r = await q(`select ${CLIP_COLS}, e.slug, e.title, e.color, e.tz from clips c join events e on e.id = c.event_id
      where c.status = 'published' and c.record like $1 order by c.record limit 6`, [`ROE-${rec[1]}-%${rec[2]}%`]);
    out.records = r.map((c) => ({ ...pubClip(c), slug: c.slug, title: c.title, color: c.color, tz: c.tz }));
  }
  const digits = raw.replace(/[^0-9]/g, '');
  let date = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = raw;
  else if (digits.length === 8 && digits === raw.replace(/[\s./-]/g, '')) {
    const a = `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`; // DDMMYYYY
    const b = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`; // YYYYMMDD
    date = /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(a) ? a : b;
  }
  const words = raw.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > (mode === 'dupe' ? 3 : 1)).slice(0, 8);
  const hay = `(e.title || ' ' || e.city || ' ' || e.country || ' ' || e.kind || ' ' || array_to_string(e.aliases, ' '))`;
  const statuses = mode === 'dupe' ? ['published', 'pending'] : ['published'];
  if (date || words.length) {
    const conds = []; const params = [statuses];
    if (date) { params.push(date); conds.push(`e.date = $${params.length}`); }
    if (words.length) { params.push(words.map((w) => `%${w}%`)); conds.push(`${hay} ilike ${mode === 'dupe' ? 'any' : 'all'}($${params.length})`); }
    let where = conds.join(mode === 'dupe' ? ' or ' : ' or ');
    if (mode === 'dupe' && url.searchParams.get('date')) {
      params.push(url.searchParams.get('date'));
      where = `(${where}) and abs(e.date::date - $${params.length}::date) <= 3`;
    }
    const rows = await q(`${EVENT_SQL} where e.status = any($1) and (${where}) order by e.date desc limit ${mode === 'dupe' ? 3 : 8}`, params);
    const covers = await coversFor(rows.map((e) => e.id));
    out.events = rows.map((e) => pubEvent(e, cardCover(covers[e.id])));
  }
  if (words.length && mode !== 'dupe') {
    out.places = await q(`select p.id, p.name, e.slug, e.title, e.color, (select count(*)::int from clips c where c.place_id = p.id and c.status = 'published') as n
      from places p join events e on e.id = p.event_id where e.status = 'published' and p.name ilike all($1) order by n desc limit 5`, [words.map((w) => `%${w}%`)]);
  }
  return out;
}

async function apiCreateEvent(req) {
  const b = await readBody(req);
  const title = str(b.title, 140), city = str(b.city, 80), country = str(b.country, 80), date = str(b.date, 10);
  const tz = validTz(b.tz) ? b.tz : 'UTC';
  const kind = KINDS.includes(b.kind) ? b.kind : 'Other';
  need(title.length >= 6, 'Give the event a name (at least 6 characters).');
  need(city.length >= 2, 'Add the city or place.');
  need(/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)), 'Pick a date.');
  need(date >= '1900-01-01' && date <= todayIn('Pacific/Kiritimati'), 'The date can’t be in the future.');
  await limit(req, 'event', 6);
  await limit(req, 'event-day', 20, 86400);
  const words = slugify(title).split('-').filter(Boolean).slice(0, 6).join('-');
  const base = [date, slugify(city), words].filter(Boolean).join('-').slice(0, 90).replace(/-+$/, '') || date + '-event';
  let slug = base;
  for (let i = 2; await q1('select 1 from events where slug = $1', [slug]); i++) slug = `${base}-${i}`;
  let code;
  do { code = randomCode(4); } while (await q1('select 1 from events where code = $1', [code]));
  const count = (await q1('select count(*)::int as n from events')).n;
  const status = cfg.moderation === 'pre' ? 'pending' : 'published';
  const e = await q1(`insert into events (slug, code, title, kind, date, tz, city, country, color, status, ip)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`, [slug, code, title, kind, date, tz, city, country, PALETTE[count % PALETTE.length], status, ipHash(req)]);
  await q('insert into places (event_id, name) values ($1, $2) on conflict do nothing', [e.id, city]);
  return { event: pubEvent(e) };
}

async function apiCode(code) {
  const e = await q1(`select slug from events where code = $1 and status <> 'hidden'`, [code.toUpperCase()]);
  need(e, 'No event with that code', 404);
  return { slug: e.slug };
}

/* ---------- uploads ---------- */
async function batchFor(token, clipId) {
  need(typeof token === 'string' && token.length >= 32, 'Missing receipt token', 403);
  const c = await q1(`select c.* from clips c join batches b on b.id = c.batch_id where b.token = $1 and c.id = $2`, [shaHex(token), Number(clipId) || 0]);
  need(c, 'Upload not found for this receipt', 404);
  return c;
}

async function apiUploadStart(req) {
  need(store.configured(), 'Uploads are not configured on this server yet.', 503);
  const b = await readBody(req);
  const f = b.file || {};
  const size = Number(f.size);
  need(Number.isFinite(size) && size > 0, 'Empty file');
  need(size <= cfg.maxFileBytes, `Files can be up to ${Math.round(cfg.maxFileBytes / 1024 ** 3)} GB.`, 413);
  need(isHex64(f.sha256) && isHex64(f.sha256o), 'Missing fingerprint');
  const mime = str(f.mime, 60);
  const name = str(f.name, 160);
  need(!mime || mime.startsWith('video/') || VIDEO_EXT.includes(extOf(name)), 'Only video files can be uploaded.');
  const captured = new Date(f.captured);
  need(!isNaN(captured) && captured.getFullYear() >= 1990 && captured.getTime() < Date.now() + 864e5, 'Invalid filming time');
  const ip = ipHash(req);
  let token = typeof b.token === 'string' && b.token ? b.token : null;
  // Round trip 1: event, existing batch, daily usage and duplicate check in one query, next to the rate-limit hit.
  const [e, hits] = await Promise.all([
    q1(`select e.id, e.date,
        (select b.id from batches b where b.token = $2 and b.event_id = e.id) as batch_id,
        (select coalesce(sum(size), 0)::float8 from clips where ip = $3 and created_at > now() - interval '1 day') as used,
        d.record as dupe, d.status as dupe_status
      from events e left join lateral (select record, status from clips
        where (sha256_original = $4 or sha256 = $4 or sha256 = $5) and status in ('pending', 'published') limit 1) d on true
      where e.slug = $1 and e.status <> 'hidden'`, [str(b.event, 120), token ? shaHex(token) : null, ip, f.sha256o, f.sha256]),
    hit(req, 'file'),
  ]);
  need(e, 'Event not found', 404);
  tooMany(hits, 300);
  need(e.used + size <= cfg.dailyBytes, 'Daily upload limit reached for your connection. Please try again tomorrow.', 429);
  if (e.dupe) return { duplicate: e.dupe, status: e.dupe_status };

  const id = crypto.randomBytes(12).toString('hex');
  const key = `v/${e.date.slice(0, 4)}/${e.id}/${id}.${extOf(name)}`;
  const posterKey = `p/${e.date.slice(0, 4)}/${e.id}/${id}.jpg`;
  const fresh = !e.batch_id;
  if (fresh) token = crypto.randomBytes(24).toString('base64url');
  const place = str(b.place, 80);
  // Round trip 2: storage multipart, new batch and place upsert side by side.
  const [uploadId, batchId, placeId] = await Promise.all([
    store.createMultipart(key),
    fresh ? q1('insert into batches (token, event_id, ip) values ($1, $2, $3) returning id', [shaHex(token), e.id, ip]).then((r) => r.id) : e.batch_id,
    place ? q1('insert into places (event_id, name) values ($1, $2) on conflict (event_id, lower(name)) do update set name = places.name returning id', [e.id, place]).then((r) => r.id) : null,
  ]);
  const stripped = Array.isArray(f.stripped) ? f.stripped.filter((s) => typeof s === 'string').slice(0, 8).map((s) => s.slice(0, 40)) : [];
  const timeSource = ['metadata', 'file', 'manual'].includes(f.ts) ? f.ts : 'file';
  const clip = await q1(`insert into clips (event_id, batch_id, place_id, status, sensitive, note, name, captured_at, time_source, duration, width, height, size, mime, sha256, sha256_original, stripped, storage_key, poster_key, ip, upload_id)
    values ($1, $2, $3, 'uploading', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) returning id`,
  [e.id, batchId, placeId, !!b.sensitive, str(f.note, 500), name, captured.toISOString(), timeSource,
    Number(f.duration) > 0 ? Number(f.duration) : null, Number(f.width) || null, Number(f.height) || null, size, mime,
    f.sha256, f.sha256o, stripped, key, posterKey, ip, uploadId]);
  return { clip: clip.id, token: fresh ? token : undefined, posterUrl: store.putUrl(posterKey) };
}

async function apiUploadParts(req) {
  const b = await readBody(req);
  const c = await batchFor(b.token, b.clip);
  need(c.status === 'uploading', 'This upload is already finished.', 409);
  const parts = (Array.isArray(b.parts) ? b.parts : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= PART_MAX).slice(0, 100);
  const urls = {};
  parts.forEach((n) => { urls[n] = store.partUrl(c.storage_key, c.upload_id, n); });
  return { urls };
}

async function apiUploadComplete(req) {
  const b = await readBody(req);
  const c = await batchFor(b.token, b.clip);
  if (c.record && c.status !== 'uploading') return { record: c.record, status: c.status };
  const parts = (Array.isArray(b.parts) ? b.parts : []).map((p) => ({ n: Number(p.n), etag: String(p.etag || '') })).sort((a, z) => a.n - z.n);
  need(parts.length && parts.every((p, i) => p.n === i + 1 && p.etag), 'Some parts are missing.');
  await store.completeMultipart(c.storage_key, c.upload_id, parts);
  const got = await store.size(c.storage_key);
  if (got !== Number(c.size)) {
    await store.remove(c.storage_key);
    await q('delete from clips where id = $1', [c.id]);
    fail(422, 'The file did not arrive complete. Please upload it again.');
  }
  const hasPoster = !!b.poster && (await store.size(c.poster_key)) > 0;
  const e = await q1('select date from events where id = $1', [c.event_id]);
  const d = yymmdd(e.date);
  const record = `ROE-${d}-${pad(await next('rec:' + d), 4)}`;
  const status = cfg.moderation === 'pre' ? 'pending' : 'published';
  await q(`update clips set record = $1, status = $2, has_poster = $3, upload_id = null, published_at = case when $2 = 'published' then now() else null end where id = $4`, [record, status, hasPoster, c.id]);
  return { record, status };
}

async function apiUploadAbort(req) {
  const b = await readBody(req);
  const c = await batchFor(b.token, b.clip);
  if (c.status !== 'uploading') return { ok: true };
  await store.abortMultipart(c.storage_key, c.upload_id);
  await store.remove(c.poster_key).catch(() => {});
  await q('delete from clips where id = $1', [c.id]);
  return { ok: true };
}

async function apiReceipt(req) {
  const b = await readBody(req);
  need(typeof b.token === 'string' && b.token.length >= 32, 'Invalid receipt link', 403);
  const batch = await q1('select b.*, e.slug, e.title, e.color, e.tz, e.date from batches b join events e on e.id = b.event_id where b.token = $1', [shaHex(b.token)]);
  need(batch, 'This receipt link is not valid.', 404);
  const clips = await q(`select * from clips where batch_id = $1 and status <> 'uploading' order by captured_at`, [batch.id]);
  return {
    event: { slug: batch.slug, title: batch.title, color: batch.color, tz: batch.tz, date: batch.date },
    created: batch.created_at,
    clips: clips.map((c) => ({
      id: c.id, record: c.record, status: c.status, name: c.name, t: c.captured_at, z: c.size, d: c.duration, reason: c.reason,
      poster: c.has_poster && !['withdrawn', 'removed', 'rejected'].includes(c.status) ? store.getUrl(c.poster_key) : null,
    })),
  };
}

async function apiWithdraw(req) {
  const b = await readBody(req);
  const c = await batchFor(b.token, b.clip);
  need(!['withdrawn', 'removed'].includes(c.status), 'Already removed.', 409);
  await store.remove(c.storage_key);
  await store.remove(c.poster_key);
  await q(`update clips set status = 'withdrawn', reason = 'Removed by the person who uploaded it', has_poster = false where id = $1`, [c.id]);
  await log('uploader', 'withdraw', c.record || String(c.id));
  return { ok: true };
}

async function apiVerify(hash) {
  need(isHex64(hash), 'Invalid fingerprint');
  const rows = await q(`select c.record, c.status, c.captured_at, c.reason, c.sha256, c.sha256_original, e.slug, e.title, e.color, e.tz
    from clips c join events e on e.id = c.event_id where (c.sha256 = $1 or c.sha256_original = $1) and c.status <> 'uploading' limit 5`, [hash]);
  return {
    matches: rows.map((r) => (r.status === 'published'
      ? { record: r.record, status: r.status, t: r.captured_at, slug: r.slug, title: r.title, color: r.color, tz: r.tz, original: r.sha256_original === hash }
      : { record: r.record, status: r.status, reason: r.reason })),
  };
}

async function apiReport(req) {
  const b = await readBody(req);
  need(REASONS.includes(b.reason), 'Pick a reason');
  await limit(req, 'report', 12);
  let clip = null, event = null;
  if (b.record) { clip = await q1('select id, event_id, status from clips where record = $1', [str(b.record, 30).toUpperCase()]); need(clip, 'Record not found', 404); }
  else { event = await q1('select id from events where slug = $1', [str(b.event, 120)]); need(event, 'Event not found', 404); }
  const today = new Date().toISOString().slice(0, 10);
  const ref = `REQ-${yymmdd(today)}-${pad(await next('req:' + yymmdd(today)), 4)}`;
  const ip = ipHash(req);
  await q(`insert into reports (ref, clip_id, event_id, reason, details, contact, ip) values ($1, $2, $3, $4, $5, $6, $7)`,
    [ref, clip?.id || null, clip ? clip.event_id : event.id, b.reason, str(b.details, 2000), str(b.contact, 200), ip]);
  if (clip && clip.status === 'published') {
    // Three separate people reporting the same clip hides it until a moderator looks.
    const n = (await q1(`select count(distinct ip)::int as n from reports where clip_id = $1 and status = 'open'`, [clip.id])).n;
    if (n >= 3) {
      await q(`update clips set status = 'hidden', reason = 'Hidden while reports are reviewed' where id = $1`, [clip.id]);
      await log('system', 'auto-hide', b.record, { reports: n });
    }
  }
  return { ref };
}

async function exportEvent(req, res, slug, kind) {
  const e = await eventBySlug(slug);
  need(e && e.status !== 'hidden', 'Event not found', 404);
  const clips = await q(`select c.*, p.name as place from clips c left join places p on p.id = c.place_id where c.event_id = $1 and c.status = 'published' order by c.captured_at`, [e.id]);
  const site = siteUrl(req);
  const headers = { ...cached(300), 'content-disposition': `attachment; filename="${e.slug}-${kind === 'sums' ? 'SHA256SUMS.txt' : 'manifest.json'}"` };
  if (kind === 'sums') {
    return send(res, 200, clips.map((c) => `${c.sha256}  ${c.record}.${extOf(c.storage_key)}`).join('\n') + '\n', { ...headers, 'content-type': 'text/plain; charset=utf-8' });
  }
  const body = {
    archive: cfg.name, generated: new Date().toISOString(), licence: 'CC BY 4.0',
    event: { title: e.title, date: e.date, timezone: e.tz, city: e.city, country: e.country, url: `${site}/e/${e.slug}` },
    records: clips.map((c) => ({
      record: c.record, filmed_at: c.captured_at, time_source: c.time_source, place: c.place || null, duration_seconds: c.duration,
      size_bytes: c.size, sha256: c.sha256, sha256_original_file: c.sha256_original, label: c.label,
      page: `${site}/r/${c.record}`, download: `${site}/m/d/${c.record}`,
    })),
  };
  return send(res, 200, JSON.stringify(body, null, 2), { ...headers, 'content-type': 'application/json; charset=utf-8' });
}

/* ---------- media ---------- */
async function media(req, res, kind, rec) {
  const c = await q1('select * from clips where record = $1', [rec.toUpperCase()]);
  const ok = c && (c.status === 'published' || (adminOf(req) && !['withdrawn', 'removed', 'rejected'].includes(c.status)));
  if (!ok || (kind === 'p' && !c.has_poster)) return send(res, 404, 'Not found', { 'content-type': 'text/plain', 'cache-control': 'public, max-age=60' });
  const key = kind === 'p' ? c.poster_key : c.storage_key;
  const url = store.getUrl(key, kind === 'd' ? { download: downloadName(c) } : {});
  send(res, 302, '', { location: url, 'cache-control': c.status === 'published' ? 'public, max-age=1800, s-maxage=1800' : 'no-store' });
}

/* ---------- moderation ---------- */
async function adminLogin(req, res) {
  need(env.ADMIN_PASSWORD, 'Set ADMIN_PASSWORD in the server settings to enable moderation.', 503);
  await limit(req, 'login', 10);
  const b = await readBody(req);
  const a = shaHex(String(b.password || '')), z = shaHex(env.ADMIN_PASSWORD);
  need(crypto.timingSafeEqual(Buffer.from(a), Buffer.from(z)), 'Wrong password', 401);
  const name = str(b.name, 40) || 'moderator';
  const n64 = Buffer.from(name).toString('base64url');
  const exp = Date.now() + 7 * 864e5;
  const secure = siteUrl(req).startsWith('https') ? '; Secure' : '';
  res.setHeader('set-cookie', `roe_admin=${n64}.${exp}.${hmacHex('admin|' + n64 + '|' + exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 86400}${secure}`);
  await log(name, 'login', '-');
  return { name };
}

function adminClip(c) {
  return {
    id: c.id, record: c.record, status: c.status, label: c.label, sensitive: c.sensitive, note: c.note, place: c.place || '',
    t: c.captured_at, ts: c.time_source, d: c.duration, w: c.width, h: c.height, z: c.size, mime: c.mime, reason: c.reason,
    stripped: c.stripped || [], created: c.created_at, sha: c.sha256,
    event: { slug: c.slug, title: c.title, color: c.color, tz: c.tz, status: c.estatus },
    video: ['withdrawn', 'removed', 'rejected'].includes(c.status) ? null : store.getUrl(c.storage_key),
    poster: c.has_poster && !['withdrawn', 'removed', 'rejected'].includes(c.status) ? store.getUrl(c.poster_key) : null,
    reports: c.reports || 0,
  };
}
const ADMIN_CLIP_SQL = `select c.*, p.name as place, e.slug, e.title, e.color, e.tz, e.status as estatus,
  (select count(*)::int from reports r where r.clip_id = c.id and r.status = 'open') as reports
  from clips c join events e on e.id = c.event_id left join places p on p.id = c.place_id`;

async function adminQueue(url) {
  const tab = url.searchParams.get('tab') || 'clips';
  const counts = await q1(`select
    (select count(*)::int from clips where status = 'pending') as clips,
    (select count(*)::int from events where status = 'pending') as events,
    (select count(*)::int from reports where status = 'open') as reports,
    (select count(*)::int from clips where status = 'hidden') as hidden`);
  let items = [];
  if (tab === 'clips') items = (await q(`${ADMIN_CLIP_SQL} where c.status = 'pending' order by c.created_at limit 40`)).map(adminClip);
  else if (tab === 'hidden') items = (await q(`${ADMIN_CLIP_SQL} where c.status = 'hidden' order by c.created_at desc limit 40`)).map(adminClip);
  else if (tab === 'recent') items = (await q(`${ADMIN_CLIP_SQL} where c.status = 'published' order by c.published_at desc limit 40`)).map(adminClip);
  else if (tab === 'events') items = (await q(`${EVENT_SQL} where e.status <> 'published' or e.updated_at > now() - interval '30 days' order by (e.status = 'pending') desc, e.created_at desc limit 60`)).map((e) => pubEvent(e, { id: e.id }));
  else if (tab === 'reports') {
    items = await q(`select r.*, c.record, c.status as clip_status, e.slug, e.title from reports r left join clips c on c.id = r.clip_id
      left join events e on e.id = r.event_id where r.status = 'open' order by r.created_at limit 60`);
    items = items.map((r) => ({ id: r.id, ref: r.ref, reason: r.reason, details: r.details, contact: r.contact, created: r.created_at, record: r.record, clipStatus: r.clip_status, slug: r.slug, title: r.title }));
  } else if (tab === 'log') items = await q('select * from modlog order by id desc limit 200');
  return { counts, items };
}

async function adminFind(url) {
  const s = str(url.searchParams.get('q'), 40).toUpperCase();
  const rows = await q(`${ADMIN_CLIP_SQL} where c.record = $1 or c.sha256 = $2 or c.sha256_original = $2 limit 5`, [s, s.toLowerCase()]);
  return { items: rows.map(adminClip) };
}

async function adminClipAction(req, who) {
  const b = await readBody(req);
  const c = await q1('select * from clips where id = $1', [Number(b.id) || 0]);
  need(c && c.status !== 'uploading', 'Clip not found', 404);
  const label = LABELS.includes(b.label) ? b.label : c.label;
  const sensitive = typeof b.sensitive === 'boolean' ? b.sensitive : c.sensitive;
  const reason = str(b.reason, 300);
  const target = c.record || String(c.id);
  switch (b.action) {
    case 'approve':
    case 'unhide':
      await q(`update clips set status = 'published', label = $1, sensitive = $2, reason = '', published_at = coalesce(published_at, now()) where id = $3`, [label, sensitive, c.id]);
      break;
    case 'update':
      await q('update clips set label = $1, sensitive = $2, note = $3 where id = $4', [label, sensitive, typeof b.note === 'string' ? str(b.note, 500) : c.note, c.id]);
      break;
    case 'hide':
      need(reason, 'Give a reason — it is shown publicly.');
      await q(`update clips set status = 'hidden', reason = $1 where id = $2`, [reason, c.id]);
      break;
    case 'reject':
    case 'delete':
      need(reason, 'Give a reason — it is shown publicly.');
      await store.remove(c.storage_key);
      await store.remove(c.poster_key);
      await q(`update clips set status = $1, reason = $2, has_poster = false where id = $3`, [b.action === 'reject' ? 'rejected' : 'removed', reason, c.id]);
      break;
    default: fail(400, 'Unknown action');
  }
  await log(who, 'clip:' + b.action, target, { label, sensitive, reason: reason || undefined });
  return { ok: true };
}

async function adminEventAction(req, who) {
  const b = await readBody(req);
  const e = await q1('select * from events where id = $1', [Number(b.id) || 0]);
  need(e, 'Event not found', 404);
  if (b.action === 'approve' || b.action === 'unhide') await q(`update events set status = 'published', updated_at = now() where id = $1`, [e.id]);
  else if (b.action === 'hide') await q(`update events set status = 'hidden', updated_at = now() where id = $1`, [e.id]);
  else if (b.action === 'update') {
    const f = b.fields || {};
    const sources = (Array.isArray(f.sources) ? f.sources : []).slice(0, 12)
      .map((s) => ({ title: str(s.title, 80), url: str(s.url, 400) })).filter((s) => /^https?:\/\//.test(s.url));
    const fig = f.figures && str(f.figures.label, 80) ? { label: str(f.figures.label, 80), low: str(f.figures.low, 40), high: str(f.figures.high, 40), note: str(f.figures.note, 200) } : null;
    await q(`update events set title = $1, kind = $2, summary = $3, aliases = $4, sources = $5, figures = $6, city = $7, country = $8, tz = $9, updated_at = now() where id = $10`, [
      str(f.title, 140) || e.title, KINDS.includes(f.kind) ? f.kind : e.kind, str(f.summary, 3000),
      (Array.isArray(f.aliases) ? f.aliases : []).map((a) => str(a, 60)).filter(Boolean).slice(0, 12),
      JSON.stringify(sources), fig ? JSON.stringify(fig) : null, str(f.city, 80) || e.city, str(f.country, 80), validTz(f.tz) ? f.tz : e.tz, e.id]);
  } else fail(400, 'Unknown action');
  await log(who, 'event:' + b.action, e.slug);
  return { ok: true };
}

async function adminReportAction(req, who) {
  const b = await readBody(req);
  const r = await q1('select * from reports where id = $1', [Number(b.id) || 0]);
  need(r, 'Report not found', 404);
  need(['resolved', 'dismissed'].includes(b.status), 'Unknown action');
  await q('update reports set status = $1, resolution = $2, resolved_at = now() where id = $3', [b.status, str(b.resolution, 500), r.id]);
  await log(who, 'report:' + b.status, r.ref);
  return { ok: true };
}

async function cron(req) {
  if (env.CRON_SECRET) need(req.headers.authorization === `Bearer ${env.CRON_SECRET}`, 'Unauthorized', 401);
  const stale = await q(`select id, storage_key, upload_id, poster_key from clips where status = 'uploading' and created_at < now() - interval '1 day' limit 200`);
  for (const c of stale) {
    if (c.upload_id) await store.abortMultipart(c.storage_key, c.upload_id);
    await store.remove(c.poster_key).catch(() => {});
    await q('delete from clips where id = $1', [c.id]);
  }
  await q('delete from hits where w < $1', [Math.floor(Date.now() / 1000 / 3600) - 72]);
  return { aborted: stale.length };
}

/* ---------- HTML pages with real link previews ---------- */
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtDate(date) {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
async function page(req, res, path, template) {
  const site = siteUrl(req);
  let title = cfg.name, desc = 'A public, open-source archive of raw footage from protests and other events. Film it. Upload it. It stays on record.', image = `${site}/og.png`;
  let status = 200;
  const m = path.match(/^\/(e|upload)\/([a-z0-9-]+)/) || path.match(/^\/r\/(ROE-\d{6}-\d+)/i);
  try {
    if (m) await ready();
    if (m && m[1] !== undefined && (m[1] === 'e' || m[1] === 'upload')) {
      const [e, coverRow] = await Promise.all([eventBySlug(m[2]), q1(`select c.record from clips c join events e on e.id = c.event_id
        where e.slug = $1 and c.status = 'published' and c.has_poster and not c.sensitive order by ${COVER_ORDER} limit 1`, [m[2]])]);
      if (e && e.status !== 'hidden') {
        const cover = coverRow?.record;
        title = `${e.title} · ${fmtDate(e.date)}`;
        desc = `${e.n} video${e.n === 1 ? '' : 's'} from ${e.city}${e.country ? ', ' + e.country : ''}. ${m[1] === 'upload' ? 'Were you there? Add your footage.' : 'Raw footage, in the order it was filmed.'}`;
        if (cover) image = `${site}/m/p/${cover}`;
      } else status = 404;
    } else if (m) {
      const c = await q1(`select c.record, c.captured_at, c.has_poster, c.status, c.sensitive, e.title, e.tz from clips c join events e on e.id = c.event_id where c.record = $1`, [m[1].toUpperCase()]);
      if (c && c.status === 'published') {
        const time = new Date(c.captured_at).toLocaleString('en-GB', { timeZone: c.tz, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        title = `${c.record} · ${c.title}`;
        desc = `Filmed ${time}. Original file with SHA-256 fingerprint.`;
        if (c.has_poster && !c.sensitive) image = `${site}/m/p/${c.record}`;
      } else if (!c) status = 404;
    }
  } catch (err) { console.error(err); }
  const tags = `<title>${escHtml(title === cfg.name ? title : `${title} · ${cfg.name}`)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta property="og:site_name" content="${escHtml(cfg.name)}">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:url" content="${escHtml(site + path)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">`;
  const html = template.replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, `<!--meta-->${tags}<!--/meta-->`);
  send(res, status, html, { 'content-type': 'text/html; charset=utf-8', ...cached(60) });
}

/* ---------- router ---------- */
// [method, path, handler, CDN seconds, needs the database (default true)]
const routes = [
  ['GET', /^\/api\/config$/, async () => apiConfig(), 300, false],
  ['GET', /^\/api\/home$/, async () => apiHome(), 20],
  ['GET', /^\/api\/search$/, async (req, url) => apiSearch(url), 20],
  ['POST', /^\/api\/events$/, async (req) => apiCreateEvent(req)],
  ['GET', /^\/api\/events\/([a-z0-9-]+)\/manifest\.json$/, async (req, url, m, res) => exportEvent(req, res, m[1], 'manifest')],
  ['GET', /^\/api\/events\/([a-z0-9-]+)\/sha256sums\.txt$/, async (req, url, m, res) => exportEvent(req, res, m[1], 'sums')],
  ['GET', /^\/api\/events\/([a-z0-9-]+)$/, async (req, url, m) => apiEvent(req, m[1]), 15],
  ['GET', /^\/api\/records\/([A-Za-z0-9-]+)$/, async (req, url, m) => apiRecord(m[1]), 30],
  ['GET', /^\/api\/code\/([A-Za-z0-9]{3,8})$/, async (req, url, m) => apiCode(m[1]), 60],
  ['POST', /^\/api\/uploads\/start$/, async (req) => apiUploadStart(req)],
  ['POST', /^\/api\/uploads\/parts$/, async (req) => apiUploadParts(req)],
  ['POST', /^\/api\/uploads\/complete$/, async (req) => apiUploadComplete(req)],
  ['POST', /^\/api\/uploads\/abort$/, async (req) => apiUploadAbort(req)],
  ['POST', /^\/api\/receipt$/, async (req) => apiReceipt(req)],
  ['POST', /^\/api\/receipt\/withdraw$/, async (req) => apiWithdraw(req)],
  ['GET', /^\/api\/verify\/([0-9a-f]{64})$/, async (req, url, m) => apiVerify(m[1])],
  ['POST', /^\/api\/reports$/, async (req) => apiReport(req)],
  ['POST', /^\/api\/admin\/login$/, async (req, url, m, res) => adminLogin(req, res)],
  ['POST', /^\/api\/admin\/logout$/, async (req, url, m, res) => { res.setHeader('set-cookie', 'roe_admin=; Path=/; Max-Age=0; SameSite=Strict'); return { ok: true }; }, 0, false],
  ['GET', /^\/api\/admin\/me$/, async (req) => ({ name: requireAdmin(req) }), 0, false],
  ['GET', /^\/api\/admin\/queue$/, async (req, url) => { requireAdmin(req); return adminQueue(url); }],
  ['GET', /^\/api\/admin\/find$/, async (req, url) => { requireAdmin(req); return adminFind(url); }],
  ['POST', /^\/api\/admin\/clip$/, async (req) => adminClipAction(req, requireAdmin(req))],
  ['POST', /^\/api\/admin\/event$/, async (req) => adminEventAction(req, requireAdmin(req))],
  ['POST', /^\/api\/admin\/report$/, async (req) => adminReportAction(req, requireAdmin(req))],
  ['GET', /^\/api\/cron\/cleanup$/, async (req) => cron(req)],
];

export default async function handler(req, res, opts = {}) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  try {
    if (/^\/u\/[A-Za-z0-9]{3,8}\/?$/.test(path)) {
      await ready();
      const e = await q1(`select slug from events where code = $1 and status <> 'hidden'`, [path.split('/')[2].toUpperCase()]);
      return send(res, 302, '', { location: e ? `/upload/${e.slug}` : '/', 'cache-control': 'public, max-age=0, s-maxage=300' });
    }
    const mm = path.match(/^\/m\/([pvd])\/([A-Za-z0-9-]+)$/);
    if (mm) { await ready(); return await media(req, res, mm[1], mm[2]); }
    if (!path.startsWith('/api/')) return await page(req, res, path, opts.template || TEMPLATE);
    // `?fresh=1` skips the CDN cache: the CDN keys on the URL only, so moderators (whose answers
    // differ, e.g. hidden events) and must-be-current reads send it and get an uncached reply.
    const shared = !url.searchParams.has('fresh') && !adminOf(req);
    for (const [method, re, fn, cache, db = true] of routes) {
      const m = path.match(re);
      if (!m) continue;
      if (req.method !== method && !(method === 'GET' && req.method === 'HEAD')) continue;
      if (db) await ready();
      const out = await fn(req, url, m, res);
      if (res.writableEnded) return;
      return send(res, 200, out, cache && shared ? cached(cache) : {});
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (!err.expose) console.error(err);
    if (res.headersSent) return res.end();
    return send(res, err.status || 500, { error: err.expose ? err.message : 'Something went wrong on our side. Please try again.' });
  }
}
