// Production build: bundles the app into dist/ (served as static files by Vercel) and refreshes
// the HTML template used by the server function. JS, CSS and theme.js get content-hashed names
// under dist/assets/ (cached forever, see vercel.json); index.html is rewritten to point at them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';
import { root, web, FONTS, fontPath, bundleOptions, workerEntry, workerOptions, css, rewriteHtml, writeTemplate } from './shared.mjs';

const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
fs.mkdirSync(assets, { recursive: true });

const hashed = (name, ext, text) => {
  const file = `${name}-${crypto.createHash('sha256').update(text).digest('base64url').slice(0, 10).replace(/[-_]/g, 'x')}${ext}`;
  fs.writeFileSync(path.join(assets, file), text);
  return '/assets/' + file;
};

const js = await esbuild.build({ ...bundleOptions, absWorkingDir: root, outdir: dist, entryNames: 'assets/[name]-[hash]', minify: true, metafile: true });
const outputs = Object.entries(js.metafile.outputs);
const [entryFile, entryMeta] = outputs.find(([, o]) => o.entryPoint);
const url = (f) => '/' + path.relative(dist, path.resolve(root, f)).split(path.sep).join('/');
// Preload the chunks the entry imports statically so they download in parallel with it.
const preload = entryMeta.imports.filter((i) => i.kind === 'import-statement' && !i.external)
  .map((i) => `<link rel="modulepreload" href="${url(i.path)}">\n`).join('');

const styles = hashed('styles', '.css', (await esbuild.transform(css(), { loader: 'css', minify: true })).code);
const theme = hashed('theme', '.js', (await esbuild.transform(fs.readFileSync(path.join(web, 'theme.js'), 'utf8'), { loader: 'js', minify: true })).code);
if (fs.existsSync(workerEntry)) await esbuild.build({ ...workerOptions, outfile: path.join(dist, 'hash-worker.js'), minify: true });
else console.warn('web/js/hash-worker.js not found — /hash-worker.js not built (mp4.js falls back to the main thread)');

for (const name of Object.keys(FONTS)) fs.copyFileSync(fontPath(name), path.join(dist, 'fonts', name));
const skip = ['js', 'index.html', 'theme.js', 'styles.css', 'pages.css', 'player.css'];
for (const entry of fs.readdirSync(web)) {
  if (!skip.includes(entry)) fs.cpSync(path.join(web, entry), path.join(dist, entry), { recursive: true });
}
const html = rewriteHtml(fs.readFileSync(path.join(web, 'index.html'), 'utf8'), { '/app.js': url(entryFile), '/styles.css': styles, '/theme.js': theme }, preload);
fs.writeFileSync(path.join(dist, 'index.html'), html);
writeTemplate(html);

// Every asset the HTML references must exist.
for (const [, ref] of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
  if (!fs.existsSync(path.join(dist, ref))) throw new Error(`dist/index.html references missing ${ref}`);
}
const kb = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
const chunks = outputs.filter(([f, o]) => f.endsWith('.js') && !o.entryPoint).map(([f]) => `${path.basename(f)} ${kb(url(f))}`);
console.log(`Built dist/ — ${url(entryFile)} ${kb(url(entryFile))}, ${styles} ${kb(styles)}${fs.existsSync(path.join(dist, 'hash-worker.js')) ? `, hash-worker.js ${kb('hash-worker.js')}` : ''}`);
if (chunks.length) console.log('Chunks: ' + chunks.join(', '));
