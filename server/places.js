// Place search for the event and upload forms, from free services built on open data (no keys needed):
// - Open-Meteo's geocoder (GeoNames): towns and cities, fast, ranked by population, with time zones.
// - Photon (komoot's OpenStreetMap search): also streets, squares and landmarks, near the event first.
// Searches go through this server, so visitors' IP addresses and what they type never reach them.
import { countryByCode, norm } from '../web/js/countries.js';

const env = process.env;
export const placesOn = env.PLACES !== 'off';
const PHOTON = env.PLACES_URL || 'https://photon.komoot.io/api/'; // or your own Photon server
const OPEN_METEO = 'https://geocoding-api.open-meteo.com/v1/search';
const UA = `RecordsOfEvent/1.0 (+${env.REPO_URL || env.SITE_URL || 'https://github.com'})`;
const CITY_LAYERS = ['city', 'district', 'locality', 'county', 'state']; // Photon, for where an event happened
const SHOWN = 8;
const TTL = 24 * 3600e3;
const cache = new Map(); // per instance; the CDN caches /api/places answers as well

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
// One result: `detail` ("Street, City, Region, Country") tells apart places with the same name;
// `city` is the town it's in, for labels. Countries always use the names in countries.js.
function place({ name, city = '', parts, cc, lat, lon, tz = null }) {
  const country = countryByCode(cc);
  if (!name || !country || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const detail = [];
  for (const p of [...parts, country.name]) {
    // Skips blanks, repeats, and a region named after the city before it ("Nairobi, Nairobi County").
    if (p && !same(p, name) && !detail.some((x) => same(x, p) || p.toLowerCase().startsWith(x.toLowerCase() + ' '))) detail.push(p);
  }
  return { name, detail: detail.join(', '), city, cc: country.code, lat: round(lat, 5), lon: round(lon, 5), tz };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error(`${url.host} answered ${r.status}`);
  return r.json();
}

// Its fuzzy matching puts far-fetched names first, so names that start with the search lead, biggest first.
async function openMeteo(q) {
  const u = new URL(OPEN_METEO);
  u.searchParams.set('name', q); u.searchParams.set('count', '20'); u.searchParams.set('language', 'en');
  const n = norm(q);
  const rows = ((await getJson(u)).results || []).map((r, i) => ({ r, i, lead: norm(r.name).startsWith(n) ? 0 : 1 }));
  rows.sort((a, b) => a.lead - b.lead || (b.r.population || 0) - (a.r.population || 0) || a.i - b.i);
  return rows.map(({ r, lead }) => {
    const p = place({ name: r.name, city: r.name, parts: [r.admin1], cc: r.country_code, lat: r.latitude, lon: r.longitude, tz: r.timezone || null });
    return p && Object.assign(p, { lead: !lead });
  });
}

async function photon(q, kind, near) {
  const u = new URL(PHOTON);
  u.searchParams.set('q', q); u.searchParams.set('limit', '15'); u.searchParams.set('lang', 'en');
  if (kind === 'city') CITY_LAYERS.forEach((l) => u.searchParams.append('layer', l));
  if (near) { // strongly prefer what's near the event; well-known places elsewhere still show up
    u.searchParams.set('lat', near.lat); u.searchParams.set('lon', near.lon);
    u.searchParams.set('zoom', '12'); u.searchParams.set('location_bias_scale', '0.1');
  }
  return ((await getJson(u)).features || []).map((f) => {
    const p = f.properties || {}, [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    let cc = p.countrycode;
    if (cc === 'CN' && /^(hong kong|maca[ou])/i.test(p.state || p.city || '')) cc = /^h/i.test(p.state || p.city) ? 'HK' : 'MO'; // OSM files them under China
    return place({ name: p.name || [p.street, p.housenumber].filter(Boolean).join(' '), city: p.city || '',
      parts: [p.type === 'street' ? '' : p.street, p.city || p.county, p.state], cc, lat, lon });
  });
}

const settle = (p, label) => p.then((l) => l.filter(Boolean), (e) => { console.warn(`Place search (${label}): ${e.message}`); return null; });

// [{ name, detail, city, cc, lat, lon, tz }], best first; null when no service could answer.
// kind 'city': where an event happened. 'spot': where footage was filmed, near `near` ({ lat, lon }) if given.
export async function searchPlaces(q, kind, near) {
  const key = [kind, norm(q), near ? `${near.lat},${near.lon}` : ''].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.list;
  let found;
  if (kind === 'city') {
    const towns = await settle(openMeteo(q), 'Open-Meteo');
    // Squares, districts and other places without a town's name ("Tahrir Square") come from OpenStreetMap.
    const more = towns && towns.some((p) => p.lead) ? [] : await settle(photon(q, kind), 'Photon');
    found = towns || more ? [...(more || []), ...(towns || [])] : null;
  } else found = await settle(photon(q, kind, near), 'Photon');
  if (!found) return null;
  // One row per place people would tell apart: a street mapped in several pieces is one street,
  // and a town both services know is listed once.
  const seen = new Set(), list = [];
  for (const { lead, ...p } of found) {
    const keys = [`${p.name}|${p.detail}`.toLowerCase(), `${norm(p.name)}|${p.cc}|${Math.round(p.lat * 5)}|${Math.round(p.lon * 5)}`];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    list.push(p);
    if (list.length === SHOWN) break;
  }
  if (cache.size >= 2000) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), list });
  return list;
}
