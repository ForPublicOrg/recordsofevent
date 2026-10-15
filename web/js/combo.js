// Searchable pickers: a text box with a list under it, and the value is picked from that list.
// countryPicker() offers the fixed list in countries.js; placePicker() searches places through the
// server (/api/places → server/places.js). Only when place search is switched off or can't be
// reached can a place be used as typed.
import { $, ic, esc, api, config } from './util.js';
import { searchCountries, findCountry, norm } from './countries.js';

export { countryByCode, findCountry, norm } from './countries.js';

// The field's HTML (inside a .field); bind its input with countryPicker() or placePicker() once it's in the page.
export const comboHtml = (id, { value = '', placeholder = '', icon = 'search', chevron = false, name = '' } = {}) => `<div class="combo">
  <span class="lead">${ic(icon, 18)}</span>
  <input id="${id}"${name ? ` name="${name}"` : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" aria-describedby="${id}-note" autocomplete="off" autocapitalize="off" spellcheck="false">
  ${chevron ? `<span class="chev">${ic('down', 18)}</span>` : ''}
  <ul class="combo-list" id="${id}-list" role="listbox" hidden></ul>
  <p class="combo-note" id="${id}-note" aria-live="polite"></p></div>`;

const coarse = () => matchMedia('(pointer: coarse)').matches;
// A mouse button held down: focus leaves a box on mousedown, but the click only lands on mouseup.
let held = false;
addEventListener('pointerdown', (e) => { held = e.pointerType !== 'touch'; }, true);
addEventListener('pointerup', () => { held = false; }, true);
addEventListener('pointercancel', () => { held = false; }, true);
const afterRelease = (fn) => {
  const go = () => { removeEventListener('pointerup', go, true); removeEventListener('pointercancel', go, true); setTimeout(fn, 0); };
  addEventListener('pointerup', go, true); addEventListener('pointercancel', go, true);
};

// The time zone that goes with a picked place: the town's own when the search knows it, else its
// country's only one (where the browser can list them). null when unknown, or `current` already fits.
export function zoneFor(place, country, current) {
  if (place && place.tz) return place.tz;
  if (!country || !country.code) return null;
  let zones = [];
  try { const l = new Intl.Locale(`und-${country.code}`); zones = (l.getTimeZones ? l.getTimeZones() : l.timeZones) || []; } catch { /* not supported */ }
  return zones.length === 1 && zones[0] !== current ? zones[0] : null;
}

// o.search(q) → items, or { items, error }, or a promise of either ('' when the box opens untouched)
// o.option(item) → the row's HTML · o.text(item) → what the box shows · o.note(item) → HTML under the box
// o.onPick(item | null) · o.value: the current item · o.delay: ms to wait while typing (remote search)
// o.exact(text) → an item the typed text names exactly · o.none / o.invalid: messages
export function combo(input, o) {
  const box = input.closest('.combo'), list = $('.combo-list', box), note = $('.combo-note', box);
  let items = [], active = -1, picked = o.value || null, seq = 0, timer = 0, dirty = false;
  const text = (it) => (it ? o.text(it) : '');
  const settled = () => { const t = input.value.trim(); return !t || (!!picked && t === text(picked)); };

  function flag(bad) {
    input.setAttribute('aria-invalid', String(bad));
    box.classList.toggle('bad', bad);
    note.classList.toggle('bad', bad);
    note.innerHTML = bad ? `${ic('alert', 14)}<span>${esc(o.invalid)}</span>` : picked && o.note ? o.note(picked) : '';
  }
  function show(on) {
    list.hidden = !on;
    input.setAttribute('aria-expanded', String(on));
    if (!on) { active = -1; input.removeAttribute('aria-activedescendant'); }
  }
  // Moves the highlight, scrolling the list (never the page) to keep it in view.
  function mark() {
    for (const li of list.querySelectorAll('[role="option"]')) {
      const on = +li.dataset.i === active;
      li.classList.toggle('on', on); li.setAttribute('aria-selected', String(on));
      if (!on) continue;
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop - 6;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight + 6;
    }
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`); else input.removeAttribute('aria-activedescendant');
  }
  function paint(msg) {
    let html = '', group = '';
    items.forEach((it, i) => {
      if (it.group && it.group !== group) { group = it.group; html += `<li class="grp" role="presentation">${esc(group)}</li>`; }
      html += `<li role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="false">${o.option(it)}</li>`;
    });
    if (msg) html += `<li class="msg" role="presentation">${msg}</li>`;
    list.innerHTML = html;
    show(!!html && document.activeElement === input);
    mark();
    // Inside a modal, scroll just enough to show the list, never past the box itself.
    const sc = box.closest('.mbody');
    if (sc && !list.hidden) {
      const over = list.getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom + 8;
      if (over > 0) sc.scrollTop += Math.min(over, input.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8);
    }
  }
  // Opening an untouched box lists everything (the current pick highlighted); typing searches.
  function update(opening) {
    clearTimeout(timer);
    const q = opening ? '' : input.value.trim(), my = ++seq;
    const run = async () => {
      if (q && !items.length && o.delay) paint(`<span class="dots" aria-hidden="true"></span>Searching…`);
      box.classList.add('busy');
      let r;
      try { r = await o.search(q); } catch (e) { r = { items: [], error: e.message }; }
      if (my !== seq) return;
      box.classList.remove('busy');
      if (document.activeElement !== input) return;
      items = (Array.isArray(r) ? r : r.items) || [];
      active = opening ? items.findIndex((it) => picked && text(it) === text(picked)) : items.length ? 0 : -1;
      paint(r.error ? `${ic('alert', 15)}<span>${esc(r.error)}</span>` : q && !items.length ? esc(o.none) : '');
    };
    if (o.delay && q) timer = setTimeout(run, o.delay); else run();
  }
  function choose(it) {
    picked = it; dirty = false;
    input.value = text(it);
    show(false); flag(false);
    o.onPick(it);
  }
  // Leaving the box: an exact name counts as picked; other text stays, marked, but picks nothing.
  function commit() {
    if (settled()) { flag(false); if (!input.value.trim() && picked) { picked = null; o.onPick(null); } return; }
    const t = norm(input.value);
    const hit = (o.exact && o.exact(input.value)) || items.find((it) => norm(text(it)) === t);
    if (hit) { choose(hit); return; }
    if (picked) { picked = null; o.onPick(null); }
    flag(true);
  }

  // Typing over a pick replaces it: the text is selected on focus, and the click that focused
  // the box doesn't put the caret back in the middle of it.
  let selecting = false;
  input.addEventListener('focus', () => { update(!dirty); if (!dirty) { input.select(); selecting = true; } });
  input.addEventListener('mouseup', (e) => { if (selecting) e.preventDefault(); selecting = false; });
  input.addEventListener('input', () => {
    dirty = true;
    const had = picked;
    if (picked && input.value.trim() !== text(picked)) { picked = null; o.onPick(null); } // editing undoes the pick
    if (had !== picked || box.classList.contains('bad')) flag(false);
    update(false);
  });
  input.addEventListener('blur', () => {
    clearTimeout(timer); seq++; box.classList.remove('busy');
    // Closing the list or showing a note moves what's under the pointer, so a click on a button
    // elsewhere (a place chip, Continue) lands first.
    const leave = () => { if (document.activeElement !== input) { show(false); commit(); } };
    if (held) afterRelease(leave); else leave();
  });
  input.addEventListener('keydown', (e) => {
    selecting = false;
    const open = !list.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { update(!dirty); return; }
      if (items.length) { active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; mark(); }
    } else if (e.key === 'Enter' && open) {
      e.preventDefault(); // never submits the form half-picked
      if (items[active]) choose(items[active]);
    } else if (e.key === 'Escape' && (open || box.classList.contains('busy'))) {
      e.preventDefault(); e.stopPropagation(); // closes the list, not the dialog
      clearTimeout(timer); seq++; box.classList.remove('busy'); // and a search still under way can't reopen it
      show(false);
    } else if (e.key === 'Tab' && open && dirty && items[active]) choose(items[active]);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keeps focus in the box
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    choose(items[+li.dataset.i]);
    if (coarse()) input.blur(); // put the keyboard away
  });
  flag(false);

  return {
    get: () => picked,
    // Sets the value from code (e.g. the country of a picked city), without calling onPick.
    set(it) { picked = it || null; dirty = false; input.value = text(picked); flag(false); },
    // false (and the box marked) while it holds text that wasn't picked from the list.
    check() { if (!settled()) commit(); return settled(); },
  };
}

export function countryPicker(input, { value = null, onPick }) {
  return combo(input, {
    value, onPick, text: (c) => c.name,
    search: (q) => searchCountries(q),
    option: (c) => `<span class="oi cc">${esc(c.code || '')}</span><span><b>${esc(c.name)}</b></span>`,
    exact: findCountry,
    none: 'No country by that name.',
    invalid: 'Pick a country from the list.',
  });
}

// A filming spot as saved for event `ev`: "Uhuru Park" near the event (within 30 km, or in its
// city); "Times Square, New York" anywhere else.
const km = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), b.lat - a.lat) * 111.2;
export function spotName(p, ev) {
  const near = !p.city || norm(p.city) === norm(p.name) || !ev
    || (ev.lat != null && p.lat != null ? km(ev, p) < 30 : norm(p.city) === norm(ev.city));
  return (near ? p.name : `${p.name}, ${p.city}`).slice(0, 80);
}

// kind 'city': where an event happened (results carry a time zone when known).
// kind 'spot': where footage was filmed; near() → { lat, lon } searches around the event first,
// and local() → [{ name }] lists the event's places so far, offered first.
export function placePicker(input, { kind = 'spot', near = null, local = null, value = null, label = (p) => p.name, onPick }) {
  const seen = new Map();
  const typed = (q, mine) => ({ name: q, typed: true, group: mine.length ? 'Other place' : '' });
  return combo(input, {
    value, onPick, text: label, delay: 280,
    async search(q) {
      const n = norm(q);
      const mine = n && local ? local().filter((p) => norm(p.name).includes(n)).slice(0, 4).map((p) => ({ name: p.name, local: true, group: 'Already on this event' })) : [];
      if (q.length < 2) return mine;
      if (config.places === false) return [...mine, typed(q, mine)];
      const qs = new URLSearchParams({ q, k: kind });
      const c = near && near();
      if (c && c.lat != null && c.lon != null) { qs.set('lat', c.lat.toFixed(2)); qs.set('lon', c.lon.toFixed(2)); }
      let found = seen.get(qs.toString());
      if (!found) {
        try { found = (await api(`/api/places?${qs}`, { retry: false, timeout: 12000 })).places; } catch (e) {
          return { items: [...mine, typed(q, mine)], error: `${e.status === 503 ? 'Place search isn’t available right now.' : e.message} You can use the name as typed.` };
        }
        seen.set(qs.toString(), found);
      }
      const more = found.filter((p) => !mine.some((m) => norm(m.name) === norm(label(p))));
      return [...mine, ...more.map((p) => (mine.length ? { ...p, group: 'Search results' } : p))];
    },
    option: (p) => (p.typed
      ? `<span class="oi">${ic('edit', 16)}</span><span><b>Use “${esc(p.name)}”</b><small>As typed</small></span>`
      : `<span class="oi">${ic(p.local ? 'check' : 'pin', 16)}</span><span><b>${esc(p.name)}</b>${p.detail ? `<small>${esc(p.detail)}</small>` : ''}</span>`),
    note: (p) => (p.detail ? `${ic('pin', 14)}<span>${esc(p.detail)}</span>` : ''),
    none: 'No places found. Try another spelling, or a street or landmark nearby.',
    invalid: 'Pick a place from the list.',
  });
}
