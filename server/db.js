// Database access. Production uses any Postgres (Neon, Supabase, RDS…) through DATABASE_URL.
// Local development without DATABASE_URL falls back to an embedded Postgres (PGlite) in .data/.
import { SCHEMA, SCHEMA_VERSION } from './schema.js';

let driver = null;
let readyPromise = null;

async function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
    return {
      query: (text, params = []) => sql.unsafe(text, params),
      exec: (text) => sql.unsafe(text),
    };
  }
  if (process.env.VERCEL) throw Object.assign(new Error('DATABASE_URL is not set'), { status: 503, expose: true });
  const mod = '@electric-sql/pglite'; // kept out of the production bundle on purpose
  const { PGlite } = await import(mod);
  const dir = process.env.PGLITE_DIR || '.data/db';
  (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows,
    exec: (text) => db.exec(text),
  };
}

export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      driver = await connect();
      let v = null;
      try { v = (await driver.query('select v from meta where k = $1', ['schema']))[0]?.v; } catch { /* first run */ }
      if (v !== SCHEMA_VERSION) {
        await driver.exec(`begin; select pg_advisory_xact_lock(7342019); ${SCHEMA}
          insert into meta (k, v) values ('schema', '${SCHEMA_VERSION}') on conflict (k) do update set v = excluded.v; commit;`);
      }
    })().catch((e) => { readyPromise = null; throw e; });
  }
  return readyPromise;
}

export const q = (text, params) => driver.query(text, params);
export const q1 = async (text, params) => (await driver.query(text, params))[0] || null;

// Atomic counter, used for record numbers (ROE-YYMMDD-NNNN) and report numbers.
export async function next(key) {
  const r = await q1('insert into counters (k, n) values ($1, 1) on conflict (k) do update set n = counters.n + 1 returning n', [key]);
  return r.n;
}
