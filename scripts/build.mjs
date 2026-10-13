// Production build: bundles the app into dist/ (served as static files by Vercel) and refreshes
// the HTML template used by the server function.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { root, web, FONTS, fontPath, bundleOptions, css, writeTemplate } from './shared.mjs';

const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });

await esbuild.build({ ...bundleOptions, outfile: path.join(dist, 'app.js'), minify: true });
fs.writeFileSync(path.join(dist, 'styles.css'), (await esbuild.transform(css(), { loader: 'css', minify: true })).code);
for (const name of Object.keys(FONTS)) fs.copyFileSync(fontPath(name), path.join(dist, 'fonts', name));
for (const entry of fs.readdirSync(web)) {
  if (['js', 'styles.css', 'pages.css'].includes(entry)) continue;
  fs.cpSync(path.join(web, entry), path.join(dist, entry), { recursive: true });
}
writeTemplate();

const size = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log(`Built dist/ — app.js ${size('app.js')}, styles.css ${size('styles.css')}`);
