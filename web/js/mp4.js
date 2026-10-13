// MP4/MOV privacy scrub and fingerprints, run in the uploader's browser.
// Metadata boxes are blanked in place (type -> 'free', rest zeroed), so the file
// size and every byte offset stay the same and nothing is re-encoded.
import { createSHA256 } from 'hash-wasm';

const CHUNK = 8 * 1024 * 1024;
const MAX_BOX = 64 * 1024 * 1024;
const MAC_EPOCH = 2082844800; // seconds from 1904-01-01 to 1970-01-01
const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2100, 0, 1);
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
const FIRST = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);
const GPS_TRACKS = new Set(['gpmd', 'camm']); // GoPro GPMF, Google camera motion
const FREE = [0x66, 0x72, 0x65, 0x65];
const LABELS = ['Location', 'Phone make & model', 'Software', 'Other metadata'];
const [LOC, PHONE, SOFT, OTHER] = LABELS;
const TAGS = {
  '\xa9xyz': LOC, loci: LOC,
  '\xa9mak': PHONE, '\xa9mod': PHONE,
  '\xa9swr': SOFT, '\xa9too': SOFT,
};
const WARN = {
  type: "We couldn't check this file type for hidden location data.",
  big: "This video is too complex for us to check for hidden location data.",
  damaged: "This file looks damaged, so we couldn't fully check it for hidden location data.",
  gps: "This video has a GPS data track that we can't remove.",
};

const fourcc = (u8, i) => String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
const utf8 = (u8) => new TextDecoder().decode(u8).replace(/\0+$/, '');
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const view = (u8, base) => ({ u8, dv: new DataView(u8.buffer, u8.byteOffset, u8.byteLength), base });
const dateOk = (t) => (t >= MIN_DATE && t < MAX_DATE ? new Date(t) : null);

async function readAt(file, off, len) {
  return new Uint8Array(await file.slice(off, Math.min(file.size, off + len)).arrayBuffer());
}

// Box header at i; limit is the parent's end. Null if it doesn't fit.
function header(b, i, limit) {
  if (i + 8 > limit) return null;
  let size = b.dv.getUint32(i);
  let hs = 8;
  if (size === 1) {
    if (i + 16 > limit) return null;
    size = Number(b.dv.getBigUint64(i + 8));
    hs = 16;
  } else if (size === 0) size = limit - i;
  if (size < hs || i + size > limit) return null;
  return { type: fourcc(b.u8, i + 4), start: i, body: i + hs, end: i + size, hs };
}

function kids(b, from, to) {
  const out = [];
  let i = from;
  while (i + 8 <= to) {
    const x = header(b, i, to);
    if (!x) { out.bad = true; break; }
    out.push(x);
    i = x.end;
  }
  return out;
}

const child = (b, c, type) => c && kids(b, c.body, c.end).find((k) => k.type === type);

function parseDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?\s*(Z|[+-]\d\d:?\d\d)?/i.exec(s.trim());
  if (!m) return null;
  let t = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? Math.round(+`0.${m[7]}` * 1000) : 0);
  const z = m[8];
  if (z && z.toUpperCase() !== 'Z') {
    const d = z.slice(1).replace(':', '');
    t -= (z[0] === '-' ? -1 : 1) * (+d.slice(0, 2) * 60 + +d.slice(2)) * 60000;
  }
  return dateOk(t);
}

function keyLabel(name) {
  const n = name.toLowerCase();
  if (/location|gps|iso6709|xyz/.test(n)) return LOC;
  if (/(^|\.)(make|model)$|camera|lens/.test(n)) return PHONE;
  if (/software|version|encoder/.test(n)) return SOFT;
  return OTHER;
}

function xmpLabels(u8, labels) {
  const s = utf8(u8);
  if (!s.trim()) return;
  if (/GPS(Latitude|Longitude|Coordinates)|Location(Created|Shown)/i.test(s)) labels.add(LOC);
  if (/tiff:(Make|Model)|LensModel/i.test(s)) labels.add(PHONE);
  if (/CreatorTool|tiff:Software/i.test(s)) labels.add(SOFT);
  labels.add(OTHER);
}

function metaLabels(b, c, labels, st) {
  if (c.body + 8 > c.end) return;
  // QuickTime meta has no version/flags; ISO meta (FullBox) has 4 bytes before hdlr
  const list = kids(b, fourcc(b.u8, c.body + 4) === 'hdlr' ? c.body : c.body + 4, c.end);
  if (list.bad) labels.add(OTHER);
  const keys = [];
  const k = list.find((x) => x.type === 'keys');
  if (k && k.body + 8 <= k.end) {
    const n = b.dv.getUint32(k.body + 4);
    for (let i = k.body + 8; keys.length < n && i + 8 <= k.end; ) {
      const len = b.dv.getUint32(i);
      if (len < 8 || i + len > k.end) break;
      keys.push(utf8(b.u8.subarray(i + 8, i + len)));
      i += len;
    }
  }
  for (const x of list) {
    if (x.type === 'ilst') {
      const items = kids(b, x.body, x.end);
      if (items.bad) labels.add(OTHER);
      for (const it of items) {
        const idx = b.dv.getUint32(it.start + 4);
        const data = kids(b, it.body, it.end).find((d) => d.type === 'data');
        const value = data ? b.u8.subarray(Math.min(data.body + 8, data.end), data.end) : b.u8.subarray(it.body, it.end);
        if (!value.length) continue;
        if (idx >= 1 && idx <= keys.length) {
          const name = keys[idx - 1];
          labels.add(keyLabel(name));
          if (/creationdate$/i.test(name) && !st.apple) st.apple = parseDate(utf8(value));
        } else labels.add(TAGS[it.type] || OTHER);
      }
    } else if (x.type === 'XMP_' || x.type === 'xml ') xmpLabels(b.u8.subarray(x.body, x.end), labels);
    else if (!['hdlr', 'keys', 'free', 'skip'].includes(x.type) && x.end > x.body) labels.add(OTHER);
  }
}

function udtaLabels(b, c, labels, st) {
  const list = kids(b, c.body, c.end);
  if (list.bad) labels.add(OTHER);
  for (const k of list) {
    if (k.type === 'free' || k.type === 'skip' || k.end === k.body) continue;
    if (k.type === 'meta') metaLabels(b, k, labels, st);
    else if (k.type === 'XMP_') xmpLabels(b.u8.subarray(k.body, k.end), labels);
    else labels.add(TAGS[k.type] || OTHER);
  }
}

// Turn box c into a same-size 'free' box, if it held anything worth reporting.
function blank(b, c, st, labels) {
  if (!labels.size) return;
  for (const l of labels) st.found.add(l);
  const bytes = new Uint8Array(c.end - c.start - 4);
  bytes.set(FREE);
  if (c.hs === 16) bytes.set(b.u8.subarray(c.start + 8, c.start + 16), 4);
  st.patches.push({ offset: b.base + c.start + 4, bytes });
}

function target(b, c, st) {
  const labels = new Set();
  if (c.type === 'udta') udtaLabels(b, c, labels, st);
  else metaLabels(b, c, labels, st);
  blank(b, c, st, labels);
}

function mvhd(b, c, st) {
  const v = b.u8[c.body];
  const p = c.body + 4;
  if (p + (v === 1 ? 32 : 20) > c.end) return;
  const created = v === 1 ? Number(b.dv.getBigUint64(p)) : b.dv.getUint32(p);
  const scale = b.dv.getUint32(p + (v === 1 ? 16 : 8));
  const dur = v === 1 ? b.dv.getBigUint64(p + 20) : b.dv.getUint32(p + 12);
  const unknown = v === 1 ? dur === 0xffffffffffffffffn : dur === 0xffffffff;
  if (created) st.created = dateOk((created - MAC_EPOCH) * 1000);
  if (scale && dur && !unknown) st.duration = Number(dur) / scale;
}

function trak(b, c, st) {
  const t = { handler: null, w: 0, h: 0 };
  const list = kids(b, c.body, c.end);
  if (list.bad) st.damaged = true;
  for (const k of list) {
    if (k.type === 'tkhd') {
      const v = b.u8[k.body];
      const m = k.body + (v === 1 ? 52 : 40); // transformation matrix
      if (m + 44 > k.end) continue;
      const [a, bb, cc, d] = [0, 4, 12, 16].map((o) => b.dv.getInt32(m + o));
      const rot = a === 0 && d === 0 && bb !== 0 && cc !== 0; // 90 or 270 degrees
      const w = Math.round(b.dv.getUint32(m + 36) / 65536);
      const h = Math.round(b.dv.getUint32(m + 40) / 65536);
      [t.w, t.h] = rot ? [h, w] : [w, h];
    } else if (k.type === 'mdia') {
      const hdlr = child(b, k, 'hdlr');
      if (hdlr && hdlr.body + 12 <= hdlr.end) t.handler = fourcc(b.u8, hdlr.body + 8);
      const stsd = child(b, child(b, child(b, k, 'minf'), 'stbl'), 'stsd');
      if (stsd && stsd.body + 16 <= stsd.end && GPS_TRACKS.has(fourcc(b.u8, stsd.body + 12))) st.gps = true;
    } else if (k.type === 'udta' || k.type === 'meta') target(b, k, st);
  }
  st.tracks.push(t);
}

function moov(b, c, st) {
  st.moov = true;
  const list = kids(b, c.body, c.end);
  if (list.bad) st.damaged = true;
  for (const k of list) {
    if (k.type === 'mvhd') mvhd(b, k, st);
    else if (k.type === 'trak') trak(b, k, st);
    else if (k.type === 'udta' || k.type === 'meta') target(b, k, st);
  }
}

export async function inspect(file) {
  const st = { found: new Set(), patches: [], tracks: [], apple: null, created: null, duration: null };
  let isMp4 = false;
  try {
    const size = file.size;
    for (let off = 0; off + 8 <= size; ) {
      const h = view(await readAt(file, off, 32), off);
      const x = header(h, 0, size - off);
      if (off === 0) {
        if (!x || !FIRST.has(x.type)) break;
        isMp4 = true;
      }
      if (!x) { st.damaged = true; break; }
      const len = x.end - x.start;
      const xmp = x.type === 'uuid' && hex(h.u8.subarray(x.body, x.body + 16)) === XMP_UUID;
      if (x.type === 'moov' || x.type === 'udta' || x.type === 'meta' || xmp) {
        if (len > MAX_BOX) st.big = true;
        else {
          const b = view(await readAt(file, off, len), off);
          const c = header(b, 0, len);
          if (x.type === 'moov') moov(b, c, st);
          else if (!xmp) target(b, c, st);
          else {
            const labels = new Set();
            xmpLabels(b.u8.subarray(c.body + 16, c.end), labels);
            blank(b, c, st, labels);
          }
        }
      }
      off += len;
    }
  } catch {
    st.damaged = true;
  }
  const v = st.tracks.find((t) => t.handler === 'vide' && t.w) || st.tracks.find((t) => t.w);
  return {
    isMp4,
    captured: st.apple || st.created,
    duration: st.duration,
    width: v ? v.w : null,
    height: v ? v.h : null,
    found: LABELS.filter((l) => st.found.has(l)),
    patches: st.patches.sort((a, b) => a.offset - b.offset),
    warning: !isMp4 ? WARN.type
      : st.big ? WARN.big
      : st.damaged || !st.moov ? WARN.damaged
      : st.gps ? WARN.gps
      : null,
  };
}

export function patched(file, patches) {
  const parts = [];
  let pos = 0;
  for (const p of [...patches].sort((a, b) => a.offset - b.offset)) {
    parts.push(file.slice(pos, p.offset), p.bytes);
    pos = p.offset + p.bytes.length;
  }
  parts.push(file.slice(pos));
  return new Blob(parts, { type: file.type });
}

// Reads the file sequentially in CHUNK pieces, prefetching the next while fn runs.
async function eachChunk(file, onProgress, fn) {
  const size = file.size;
  const read = (pos) => file.slice(pos, Math.min(size, pos + CHUNK)).arrayBuffer();
  let next = size ? read(0) : null;
  for (let pos = 0; pos < size; ) {
    const u8 = new Uint8Array(await next);
    if (!u8.length) throw new Error('File could not be read');
    const end = pos + u8.length;
    next = end < size ? read(end) : null;
    fn(u8, pos);
    pos = end;
    onProgress?.(end / size);
  }
  if (!size) onProgress?.(1);
}

// Hashes on the calling thread. Runs inside hash-worker.js, and here as the fallback.
export async function hashLocal(file, patches = [], onProgress) {
  const list = [...patches].sort((a, b) => a.offset - b.offset);
  const orig = await createSHA256();
  const stored = list.length ? await createSHA256() : null;
  orig.init();
  stored?.init();
  await eachChunk(file, onProgress, (u8, pos) => {
    orig.update(u8);
    if (!stored) return;
    let out = u8;
    for (const p of list) {
      const s = Math.max(p.offset, pos);
      const e = Math.min(p.offset + p.bytes.length, pos + u8.length);
      if (s >= e) continue;
      if (out === u8) out = u8.slice();
      out.set(p.bytes.subarray(s - p.offset, e - p.offset), s - pos);
    }
    stored.update(out);
  });
  const original = orig.digest('hex');
  return { original, stored: stored ? stored.digest('hex') : original };
}

// Hashing runs in a Web Worker so the page stays responsive. If the worker can't start
// (blocked, missing, old browser) or goes quiet, the job is redone on the main thread.
let W = null, wid = 0;
const jobs = new Map();
function hashWorker() {
  if (W !== null) return W;
  try { W = new Worker('/hash-worker.js'); } catch { return (W = false); }
  W.onmessage = ({ data: m }) => {
    const j = jobs.get(m && m.id); if (!j) return;
    clearTimeout(j.timer);
    if (m.ack) return;
    if ('p' in m) { j.started = true; j.onProgress?.(m.p); return; }
    jobs.delete(m.id);
    if (m.result) j.resolve(m.result);
    else if (j.started) j.reject(new Error(m.error || 'File could not be read')); // reading failed part-way
    else j.fallback(); // failed before hashing began (e.g. WebAssembly blocked in workers)
  };
  W.onerror = (e) => { e.preventDefault?.(); killWorker(); };
  return W;
}
function killWorker() {
  if (W) W.terminate();
  W = false;
  const list = [...jobs.values()]; jobs.clear();
  list.forEach((j) => { clearTimeout(j.timer); j.fallback(); });
}

export function fingerprint(file, patches = [], onProgress) {
  const w = hashWorker();
  if (!w) return hashLocal(file, patches, onProgress);
  return new Promise((resolve, reject) => {
    const id = ++wid;
    const j = { resolve, reject, onProgress, started: false };
    j.fallback = () => hashLocal(file, patches, onProgress).then(resolve, reject);
    j.timer = setTimeout(killWorker, 8000); // no answer at all: the worker never came up
    jobs.set(id, j);
    try { w.postMessage({ id, file, patches }); } catch { jobs.delete(id); clearTimeout(j.timer); j.fallback(); }
  });
}

export async function sha256File(file, onProgress) {
  return (await fingerprint(file, [], onProgress)).original;
}
