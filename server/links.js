// Videos added by link (Google Drive, Dropbox, OneDrive or a direct file URL). The server reads the
// source in byte ranges and copies it into storage part by part; the browser drives the loop, so a
// dropped connection or a function timeout resumes from the last finished part. Location and phone
// details are blanked with the same scrubber the browser uses (mp4.js) and both fingerprints are kept
// as saved hasher states between requests.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { createSHA256 } from 'hash-wasm';
import { inspect } from '../web/js/mp4.js';

export const IMPORT_PART = 16 * 1024 * 1024;
const HEAD = 256 * 1024; // first read: enough to recognise the file and usually its first boxes
const WINDOW = 512 * 1024; // small reads during inspection fetch this much around them
const UA = 'Mozilla/5.0 (compatible; RecordsOfEvent/1.0; video import)';

const linkErr = (message, status = 422) => Object.assign(new Error(message), { status, expose: true });
const transient = (message) => Object.assign(new Error(message), { status: 502, expose: true, transient: true });
const PRIVATE = 'That link points to a private network address.';

/* ---------- where a link really leads ---------- */
const NO_FILE = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'X'], [/(^|\.)(facebook\.com|fb\.watch)$/, 'Facebook'], [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram'], [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'],
];

export function resolveLink(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw linkErr('That doesn’t look like a link. Paste the full address, starting with https://'); }
  if (!/^https?:$/.test(u.protocol)) throw linkErr('Only http and https links can be added.');
  const host = u.hostname.toLowerCase();
  for (const [re, name] of NO_FILE) {
    if (re.test(host)) throw linkErr(`Videos on ${name} can’t be copied from a link. Save the original video and add the file instead.`);
  }
  if (/(^|\.)(drive|docs)\.google\.com$/.test(host) || host === 'drive.usercontent.google.com') {
    if (/\/folders\//.test(u.pathname)) throw linkErr('That’s a Drive folder. Open the video itself and copy its link.');
    const id = (u.pathname.match(/\/d\/([\w-]{10,})/) || [])[1] || u.searchParams.get('id');
    if (!id || !/^[\w-]{10,}$/.test(id)) throw linkErr('We couldn’t find a file in that Drive link. In Drive, use Share → Copy link on the video.');
    const rk = u.searchParams.get('resourcekey');
    return { kind: 'drive', id, host: 'Google Drive', url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t${rk ? '&resourcekey=' + encodeURIComponent(rk) : ''}` };
  }
  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.delete('raw'); u.searchParams.set('dl', '1');
    return { kind: 'dropbox', host: 'Dropbox', url: u.href };
  }
  if (host === '1drv.ms' || /(^|\.)onedrive\.live\.com$/.test(host)) {
    return { kind: 'onedrive', host: 'OneDrive', url: `https://api.onedrive.com/v1.0/shares/u!${Buffer.from(u.href).toString('base64url')}/root/content` };
  }
  return { kind: 'direct', host: host.replace(/^www\./, ''), url: u.href };
}

/* ---------- fetching, with every hop checked against private addresses ---------- */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  const v4 = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return privateIp(v4[1]);
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('::ffff:') || s.startsWith('64:ff9b:') || s.startsWith('2002:');
}
// Checked at connect time, so a name can't resolve to a public address first and a private one later.
function lookup(host, opts, cb) {
  dns.lookup(host, opts, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some((a) => privateIp(a.address))) return cb(Object.assign(new Error(PRIVATE), { code: 'EPRIVATE' }));
    cb(null, address, family);
  });
}

function get(url, range, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(linkErr('The link redirected somewhere invalid.')); }
    if (!/^https?:$/.test(u.protocol) || (u.port && u.port !== '80' && u.port !== '443')) return reject(linkErr(hops ? 'The link redirected somewhere we can’t read from.' : 'Only ordinary web links can be added (no custom ports).'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) ? privateIp(host) : /(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) return reject(linkErr(PRIVATE));
    const headers = { 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity' };
    if (range) headers.range = `bytes=${range[0]}-${range[1]}`;
    const req = (u.protocol === 'https:' ? https : http).get(u, { headers, lookup, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= 6) return reject(linkErr('That link redirects too many times.'));
        return resolve(get(new URL(res.headers.location, u).href, range, hops + 1));
      }
      res.finalUrl = u.href;
      resolve(res);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => reject(e.code === 'EPRIVATE' ? linkErr(PRIVATE)
      : e.code === 'ENOTFOUND' ? linkErr('That website couldn’t be found. Check the link.')
        : transient('We couldn’t reach that link just now.')));
  });
}

// Reads the body: exactly `want` bytes, or (cut) at most `want` bytes and then hangs up.
function body(res, want, ms, cut) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, over = false;
    const finish = (fn, x) => { clearTimeout(timer); fn(x); };
    const timer = setTimeout(() => { res.destroy(); finish(reject, transient('The link is very slow to answer.')); }, ms);
    res.on('data', (c) => {
      if (over) return;
      if (n + c.length > want) {
        over = true; res.destroy();
        if (!cut) return finish(reject, linkErr('The link sent more data than it said it would.'));
        chunks.push(c.subarray(0, want - n)); n = want;
        return finish(resolve, Buffer.concat(chunks, n));
      }
      chunks.push(c); n += c.length;
    });
    res.on('end', () => { if (!over) finish(resolve, Buffer.concat(chunks, n)); });
    res.on('error', () => { if (!over) finish(reject, transient('The download from the link was interrupted.')); });
    res.on('aborted', () => { if (!over) finish(reject, transient('The download from the link was interrupted.')); });
  });
}

const looksHtml = (b) => /^\s*(<!doctype|<html|<\?xml|<head|<body|\{)/i.test(b.toString('latin1', 0, 200));
function refused(src, status) {
  if (src.kind === 'drive') return 'Google Drive didn’t hand over this video. In Drive, set sharing to “Anyone with the link”, then copy the link again. (Drive also blocks very popular files for a day.)';
  if (status === 401 || status === 403) return 'That link needs a sign-in. Use a public link that anyone can open.';
  if (status === 404 || status === 410) return 'Nothing was found at that link. It may have been deleted or mistyped.';
  return 'That link opens a web page, not a video file. Use a link that downloads the video itself.';
}

function sniff(b) {
  const s = (i, n) => b.toString('latin1', i, i + n);
  if (b.length >= 12 && ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(s(4, 4))) {
    const brand = s(4, 4) === 'ftyp' ? s(8, 4) : '';
    return brand.startsWith('qt') ? { ext: 'mov', mime: 'video/quicktime' } : brand.startsWith('3g') ? { ext: '3gp', mime: 'video/3gpp' } : { ext: 'mp4', mime: 'video/mp4' };
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return /webm/.test(s(0, 64)) ? { ext: 'webm', mime: 'video/webm' } : { ext: 'mkv', mime: 'video/x-matroska' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'AVI ') return { ext: 'avi', mime: 'video/x-msvideo' };
  if (b.length > 376 && b[0] === 0x47 && b[188] === 0x47) return { ext: 'ts', mime: 'video/mp2t' };
  if (b.length > 388 && b[4] === 0x47 && b[196] === 0x47) return { ext: 'mts', mime: 'video/mp2t' };
  return null;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|3gp|avi|mts|ts)$/i;
function fileName(cd, url, ext) {
  let n = '';
  const star = /filename\*\s*=\s*(?:utf-8|iso-8859-1)?'[^']*'([^;]+)/i.exec(cd || '');
  if (star) { try { n = decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ } }
  if (!n) { const m = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(cd || ''); if (m) n = (m[1] ?? m[2]).trim(); }
  if (!n) { try { n = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* ignore */ } }
  n = n.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!n || n === 'content' || n === 'download') n = 'video';
  return VIDEO_EXT.test(n) ? n : `${n}.${ext}`;
}

// Size from a 206 Content-Range, or the length of a plain 200.
const totalOf = (res) => (res.statusCode === 206
  ? Number((/\/(\d+)\s*$/.exec(res.headers['content-range'] || '') || [])[1])
  : Number(res.headers['content-length']));

// A read-only "file" over the link for mp4.js: small reads are served from cached windows.
function remote(url, size, head) {
  const cache = [{ from: 0, buf: head }];
  let reads = 0;
  const read = async (a, b) => {
    for (const c of cache) if (a >= c.from && b <= c.from + c.buf.length) return c.buf.subarray(a - c.from, b - c.from);
    if (++reads > 24) throw new Error('too many reads');
    const to = Math.min(size, Math.max(b, a + WINDOW));
    const res = await get(url, [a, to - 1]);
    if (res.statusCode !== 206) { res.resume(); throw new Error('range refused'); }
    const buf = await body(res, to - a, 30000);
    if (buf.length !== to - a) throw new Error('short read');
    cache.push({ from: a, buf });
    return buf.subarray(0, b - a);
  };
  return {
    size,
    slice: (a, b) => ({ arrayBuffer: async () => { const u = await read(a, Math.min(size, b)); return u.buffer.slice(u.byteOffset, u.byteOffset + u.length); } }),
  };
}

async function driveThumb(id, width) {
  try {
    const res = await get(`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`);
    if (res.statusCode !== 200 || !/^image\//.test(res.headers['content-type'] || '')) { res.resume(); return null; }
    return { type: res.headers['content-type'].split(';')[0], buf: await body(res, 2 * 1024 * 1024, 15000, true) };
  } catch { return null; }
}

/* ---------- checking a link before upload ---------- */
export async function probeLink(raw, maxBytes) {
  const src = resolveLink(raw);
  const res = await get(src.url, [0, HEAD - 1]);
  const status = res.statusCode;
  const type = String(res.headers['content-type'] || '').toLowerCase();
  if (status === 429 || status === 503) { res.resume(); throw linkErr('That site is limiting downloads right now. Please try again later.'); }
  if (status >= 400) { res.resume(); throw linkErr(status >= 500 ? `The link’s website answered with an error (${status}). Please try again later.` : refused(src, status)); }
  if (status !== 200 && status !== 206) { res.resume(); throw linkErr(refused(src, status)); }
  const size = totalOf(res);
  const ranged = status === 206;
  if (!ranged && size > IMPORT_PART) { res.destroy(); throw linkErr('That website doesn’t allow downloading in pieces, so large videos can’t be copied from it. Download the video and add the file instead.'); }
  const head = await body(res, ranged ? Math.min(HEAD, size || HEAD) : IMPORT_PART, 30000, true);
  if (/^text\/|html|json|xml/.test(type) || looksHtml(head)) throw linkErr(refused(src, status));
  if (!(size > 0)) throw linkErr('That link doesn’t say how big the video is, so it can’t be copied.');
  if (!ranged && head.length !== size) throw transient('The download from the link was interrupted.');
  const sig = sniff(head);
  if (!sig && !type.startsWith('video/')) throw linkErr('That link doesn’t lead to a video file.');
  if (size > maxBytes) throw linkErr(`That video is ${Math.round(size / 1024 ** 2)} MB. Videos can be up to ${Math.round(maxBytes / 1024 ** 3)} GB.`, 413);
  const ext = sig ? sig.ext : (type.split('/')[1] || 'mp4').replace(/[^a-z0-9]/g, '').slice(0, 4) || 'mp4';
  const [meta, thumb] = await Promise.all([
    inspect(remote(res.finalUrl, size, head)).catch(() => ({ warning: 'We couldn’t check this video for hidden location data.' })),
    src.kind === 'drive' ? driveThumb(src.id, 176) : null,
  ]);
  return {
    src, ranged, size, ext,
    mime: sig ? sig.mime : type.split(';')[0],
    name: fileName(res.headers['content-disposition'], res.finalUrl, ext),
    modified: Date.parse(res.headers['last-modified'] || '') || null,
    captured: meta.captured || null, duration: meta.duration || null, width: meta.width || null, height: meta.height || null,
    found: meta.found || [], patches: meta.patches || [], warning: meta.warning || null,
    thumb: thumb ? `data:${thumb.type};base64,${thumb.buf.toString('base64')}` : null,
  };
}

/* ---------- copying ---------- */
export const packPatches = (list) => list.map((p) => [p.offset, zlib.deflateRawSync(Buffer.from(p.bytes)).toString('base64')]);
export const unpackPatches = (list) => (list || []).map(([offset, b]) => ({ offset, bytes: zlib.inflateRawSync(Buffer.from(b, 'base64')) }));

// Part n (1-based) of the source, exactly as many bytes as it should be.
export async function fetchPart(t, n) {
  const from = (n - 1) * IMPORT_PART, to = Math.min(t.z, from + IMPORT_PART);
  const res = await get(t.s, t.r ? [from, to - 1] : null);
  const type = String(res.headers['content-type'] || '').toLowerCase();
  if (res.statusCode === 429 || res.statusCode >= 500) { res.resume(); throw transient('The link’s website is busy. Retrying…'); }
  if (res.statusCode >= 400 || /^text\/|html/.test(type)) { res.resume(); throw linkErr(t.k === 'drive' ? 'Google Drive stopped handing over this video. Check that it’s still shared with “Anyone with the link”.' : 'The link stopped working while the video was being copied.'); }
  const ok = t.r ? res.statusCode === 206 && totalOf(res) === t.z && new RegExp(`^bytes ${from}-${to - 1}/`).test(res.headers['content-range'] || '')
    : res.statusCode === 200 && totalOf(res) === t.z;
  if (!ok) { res.resume(); throw linkErr('The video at that link changed while it was being copied. Please add the link again.'); }
  const buf = await body(res, to - from, 40000);
  if (buf.length !== to - from) throw transient('The download from the link was interrupted.');
  return buf;
}

// The bytes as stored: scrubbed boxes overwritten in place (sizes and offsets unchanged).
export function scrub(buf, pos, patches) {
  let out = buf;
  for (const p of patches) {
    const s = Math.max(p.offset, pos), e = Math.min(p.offset + p.bytes.length, pos + buf.length);
    if (s >= e) continue;
    if (out === buf) out = Buffer.from(buf);
    out.set(p.bytes.subarray(s - p.offset, e - p.offset), s - pos);
  }
  return out;
}

// SHA-256 that survives between requests as a small saved state.
export async function hasher(state) {
  const h = await createSHA256();
  if (state) h.load(Buffer.from(state, 'base64')); else h.init();
  return h;
}
export const saveHash = (h) => Buffer.from(h.save()).toString('base64');

export async function posterFor(t) {
  if (t.k !== 'drive' || !t.i) return null;
  const th = await driveThumb(t.i, 720);
  return th && th.buf.length > 500 ? th.buf : null;
}
