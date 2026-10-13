// Object storage for video files. Works with any S3-compatible service (Cloudflare R2 recommended:
// no egress fees). Browsers upload straight to storage with presigned URLs, so large files never
// pass through the serverless function. Without S3 settings (local development) files go to .data/storage.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const env = process.env;
export const s3 = env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
  ? {
      endpoint: env.S3_ENDPOINT.replace(/\/+$/, ''),
      bucket: env.S3_BUCKET,
      region: env.S3_REGION || 'auto',
      key: env.S3_ACCESS_KEY_ID,
      secret: env.S3_SECRET_ACCESS_KEY,
    }
  : null;
export const LOCAL_DIR = path.resolve(env.LOCAL_STORAGE_DIR || '.data/storage');
export const configured = () => !!s3 || !env.VERCEL;

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const keyCache = new Map();

// AWS Signature V4, query-string form. `at` lets callers pin the signing time so URLs stay
// identical (and cacheable) for a while.
function presign(method, key, { query = {}, expires = 3600, at = new Date() } = {}) {
  const u = new URL(s3.endpoint);
  const host = u.host;
  const amzDate = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${s3.key}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const uri = `${u.pathname.replace(/\/$/, '')}/${s3.bucket}/${key.split('/').map(enc).join('/')}`;
  const canonical = [method, uri, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  let k = keyCache.get(scope);
  if (!k) { k = hmac(hmac(hmac(hmac('AWS4' + s3.secret, day), s3.region), 's3'), 'aws4_request'); keyCache.set(scope, k); }
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return `${u.protocol}//${host}${uri}?${qs}&X-Amz-Signature=${sig}`;
}

async function call(method, key, query, body) {
  const r = await fetch(presign(method, key, { query, expires: 300 }), { method, body });
  const text = await r.text();
  if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`Storage ${method} failed (${r.status}): ${text.slice(0, 200)}`);
  return { status: r.status, text, headers: r.headers };
}

const localUrl = (key, q = {}) => { const s = String(new URLSearchParams(q)); return `/__storage/${key}${s ? '?' + s : ''}`; };
const localPath = (key) => {
  const p = path.resolve(LOCAL_DIR, key);
  if (!p.startsWith(LOCAL_DIR)) throw new Error('bad key');
  return p;
};

export async function createMultipart(key) {
  if (!s3) return 'local-' + crypto.randomBytes(8).toString('hex');
  const { text } = await call('POST', key, { uploads: '' });
  const m = text.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new Error('No UploadId from storage');
  return m[1];
}

export function partUrl(key, uploadId, n) {
  if (!s3) return localUrl(key, { uploadId, partNumber: n });
  return presign('PUT', key, { query: { partNumber: String(n), uploadId }, expires: 6 * 3600 });
}

export function putUrl(key) {
  if (!s3) return localUrl(key, { single: 1 });
  return presign('PUT', key, { expires: 6 * 3600 });
}

export async function completeMultipart(key, uploadId, parts) {
  if (!s3) {
    const dir = localPath(key) + '.parts';
    const out = await fs.open(localPath(key), 'w');
    for (const p of parts) await out.write(await fs.readFile(path.join(dir, String(p.n))));
    await out.close();
    await fs.rm(dir, { recursive: true, force: true });
    return;
  }
  const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag.replace(/[<>&]/g, '')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  const { text } = await call('POST', key, { uploadId }, xml);
  if (/<Error>/.test(text)) throw new Error('Storage could not join the parts: ' + text.slice(0, 200));
}

export async function abortMultipart(key, uploadId) {
  if (!s3) { await fs.rm(localPath(key) + '.parts', { recursive: true, force: true }); return; }
  await call('DELETE', key, { uploadId }).catch(() => {});
}

export async function size(key) {
  if (!s3) { try { return (await fs.stat(localPath(key))).size; } catch { return null; } }
  const r = await fetch(presign('HEAD', key, { expires: 300 }), { method: 'HEAD' });
  return r.ok ? Number(r.headers.get('content-length')) : null;
}

export async function remove(key) {
  if (!key) return;
  if (!s3) { await fs.rm(localPath(key), { force: true }); return; }
  await call('DELETE', key);
}

// Read URLs are signed against the start of the current 3-hour window and stay valid for 9 hours,
// so the same URL is reused (and cached) for a while and long videos don't expire mid-play.
export function getUrl(key, { download } = {}) {
  if (!s3) return localUrl(key, download ? { download } : {});
  const w = 3 * 3600 * 1000;
  const at = new Date(Math.floor(Date.now() / w) * w);
  const query = download ? { 'response-content-disposition': `attachment; filename="${download}"` } : {};
  return presign('GET', key, { query, expires: 9 * 3600, at });
}
