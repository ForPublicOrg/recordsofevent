// Local development server: `npm run dev`. No accounts or cloud services needed — it uses an
// embedded Postgres (PGlite) and stores uploads in .data/storage. Put settings in .env to use
// a real database or bucket instead.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';
import { web, fontPath, bundleOptions, css, writeTemplate, loadEnv } from './shared.mjs';

loadEnv();
process.env.ADMIN_PASSWORD ||= 'admin';
writeTemplate();
const { default: handler } = await import('../server/app.js');
const { LOCAL_DIR } = await import('../server/storage.js');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4' };
const SERVER_PATHS = /^\/(api|m|e|r|u)\/|^\/upload\/./;

function sendFile(req, res, file, extra = {}) {
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', ...extra };
  if (range) {
    const start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  }
}

// Stand-in for S3/R2 when no bucket is configured (presigned URLs point here).
async function localStorage(req, res, url) {
  const key = decodeURIComponent(url.pathname.slice('/__storage/'.length));
  const file = path.resolve(LOCAL_DIR, key);
  if (!file.startsWith(LOCAL_DIR)) { res.writeHead(400).end(); return; }
  if (req.method === 'PUT') {
    const n = url.searchParams.get('partNumber');
    const target = n ? path.join(file + '.parts', n) : file;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const hash = crypto.createHash('md5');
    const out = fs.createWriteStream(target);
    req.on('data', (c) => hash.update(c));
    req.pipe(out);
    out.on('finish', () => { res.writeHead(200, { etag: `"${hash.digest('hex')}"`, 'access-control-expose-headers': 'ETag' }).end(); });
    return;
  }
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const dl = url.searchParams.get('download');
  sendFile(req, res, file, dl ? { 'content-disposition': `attachment; filename="${dl}"` } : {});
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p.startsWith('/__storage/')) return await localStorage(req, res, url);
    if (p === '/app.js') {
      const r = await esbuild.build({ ...bundleOptions, write: false, sourcemap: 'inline' });
      res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }).end(r.outputFiles[0].text);
      return;
    }
    if (p === '/styles.css') { res.writeHead(200, { 'content-type': TYPES['.css'], 'cache-control': 'no-store' }).end(css()); return; }
    if (p.startsWith('/fonts/')) { const f = fontPath(path.basename(p)); if (f) return sendFile(req, res, f); }
    if (SERVER_PATHS.test(p)) return await handler(req, res, { template: fs.readFileSync(path.join(web, 'index.html'), 'utf8') });
    const file = path.join(web, path.normalize(p).replace(/^([/\\])+/, ''));
    if (file.startsWith(web) && p !== '/' && fs.existsSync(file) && fs.statSync(file).isFile() && !p.startsWith('/js/')) return sendFile(req, res, file);
    if (!path.extname(p)) return sendFile(req, res, path.join(web, 'index.html'));
    res.writeHead(404).end('Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end(String(err.message || err));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Records of Event running at http://localhost:${PORT}`);
  console.log(process.env.DATABASE_URL ? 'Database: DATABASE_URL' : 'Database: embedded (.data/db)');
  console.log(process.env.S3_BUCKET ? `Storage: bucket ${process.env.S3_BUCKET}` : 'Storage: local folder (.data/storage)');
  console.log(`Moderation: http://localhost:${PORT}/admin  (password from ADMIN_PASSWORD, default "admin" locally)`);
});
