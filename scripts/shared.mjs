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

export const bundleOptions = {
  entryPoints: [path.join(web, 'js/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  legalComments: 'none',
  logLevel: 'warning',
};

export function css() {
  const extra = path.join(web, 'pages.css');
  return fs.readFileSync(path.join(web, 'styles.css'), 'utf8') + (fs.existsSync(extra) ? '\n' + fs.readFileSync(extra, 'utf8') : '');
}

// The server injects per-page <head> tags into this template (see server/app.js → page()).
export function writeTemplate() {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
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
