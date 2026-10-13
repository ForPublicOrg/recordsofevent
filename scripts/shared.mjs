// Shared by build.mjs and dev.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const web = path.join(root, 'web');

const fs_ = '@fontsource-variable';
export const FONTS = {
  'bricolage-latin.woff2': `${fs_}/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2`,
  'bricolage-latin-ext.woff2': `${fs_}/bricolage-grotesque/files/bricolage-grotesque-latin-ext-opsz-normal.woff2`,
  'instrument-latin.woff2': `${fs_}/instrument-sans/files/instrument-sans-latin-wght-normal.woff2`,
  'instrument-latin-ext.woff2': `${fs_}/instrument-sans/files/instrument-sans-latin-ext-wght-normal.woff2`,
  'jetbrains-latin.woff2': `${fs_}/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2`,
};
export const fontPath = (name) => FONTS[name] && path.join(root, 'node_modules', FONTS[name]);

// The app is split: main.js is the entry, dynamic import()s (upload, admin, mp4…) become chunks
// under assets/. Callers add outdir and entryNames.
export const bundleOptions = {
  entryPoints: { main: path.join(web, 'js/main.js') },
  bundle: true,
  splitting: true,
  format: 'esm',
  chunkNames: 'assets/[name]-[hash]',
  target: ['es2020', 'safari15'],
  legalComments: 'none',
  logLevel: 'warning',
};

// Hashing runs in a Web Worker loaded from /hash-worker.js (a classic script, so every browser can start it).
export const workerEntry = path.join(web, 'js/hash-worker.js');
export const workerOptions = {
  entryPoints: [workerEntry],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  legalComments: 'none',
  logLevel: 'warning',
};

export const CSS_FILES = ['styles.css', 'pages.css', 'player.css'];
export function css() {
  return CSS_FILES.map((f) => path.join(web, f)).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

// Points the HTML at built files: { '/app.js': '/assets/main-X.js', … }. Extra <head> tags go before </head>.
export function rewriteHtml(html, map, headExtra = '') {
  for (const [from, to] of Object.entries(map)) {
    const n = html.split(`"${from}"`).length - 1;
    if (n !== 1) throw new Error(`web/index.html must reference "${from}" exactly once (found ${n})`);
    html = html.replace(`"${from}"`, `"${to}"`);
  }
  return headExtra ? html.replace('</head>', headExtra + '</head>') : html;
}

// The server injects per-page <head> tags into this template (see server/app.js → page()).
export function writeTemplate(html = fs.readFileSync(path.join(web, 'index.html'), 'utf8')) {
  fs.writeFileSync(path.join(root, 'server/template.js'), `// Generated from web/index.html by scripts/build.mjs — do not edit.\nexport const TEMPLATE = ${JSON.stringify(html)};\n`);
}

export function loadEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
