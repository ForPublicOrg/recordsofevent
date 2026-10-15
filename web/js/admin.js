// Moderator area: sign-in, review queue, events, reports, hidden, recently published, log, record search.
import { $, $$, ic, esc, api, toast, copy, dur, bytes, fmtTime, localMin, fromLocal, fmtDate, tzName, LABEL, ago, config, setModerator } from './util.js';
import { combo, comboHtml, placePicker, spotName, countryPicker, countryByCode, findCountry, zoneFor } from './combo.js';

const TABS = [
  ['clips', 'Review queue', 'film'], ['events', 'Events', 'calendar'], ['reports', 'Reports', 'flag'],
  ['hidden', 'Hidden', 'eyeoff'], ['recent', 'Recently published', 'globe'], ['log', 'Log', 'list'],
];
const EMPTY = {
  clips: ['Queue is clear', 'New uploads appear here for review.'],
  events: ['No events to look at', 'New and recently changed events appear here.'],
  reports: ['No open reports', 'Reports from viewers appear here.'],
  hidden: ['Nothing hidden', 'Hidden videos appear here.'],
  recent: ['Nothing published yet', 'Approved videos appear here.'],
  log: ['No activity yet', 'Every moderator action is recorded here.'],
};
const REASONS = {
  me: 'Shows me, I want it removed', injury: 'Shows someone injured or at risk', 'wrong-event': 'Not from this event',
  'wrong-time': 'Wrong date or time', private: 'Private place or private details', copyright: 'Copyright claim',
  illegal: 'Illegal content', other: 'Something else',
};
const TS = { metadata: 'Time from camera metadata', file: 'Time from file date', manual: 'Time entered by uploader', moderator: 'Time corrected by a moderator' };
const TS_PICK = { metadata: 'Camera metadata', file: 'File date (approximate)', manual: 'Entered by the uploader', moderator: 'Corrected by a moderator' };
const REASONED = ['hidden', 'rejected', 'removed', 'withdrawn']; // statuses whose reason is shown publicly
const CHANGED = { event: 'event', place: 'place', filmed: 'filming time', timeSource: 'time source', duration: 'length', width: 'width', height: 'height', note: 'note', reason: 'public reason' };
const CLIP_ST = { pending: 'Waiting for review', published: 'Public', hidden: 'Hidden', rejected: 'Rejected', removed: 'File deleted', withdrawn: 'Removed by uploader' };
const EV_ST = { pending: 'Waiting for review', published: 'Public', hidden: 'Hidden' };
const QUICK = [
  'Not footage of this event', 'Duplicate of an existing record', 'Edited or not original footage', 'Puts an identifiable person at risk',
  'Filmed in a private place without consent', 'Copyright notice from the rights holder', 'Illegal content', 'Spam or unrelated',
];
const ASK = {
  reject: ['Reject this upload?', 'The file is deleted. The reason is shown publicly on the record.', 'Reject and delete file', 'adm-danger'],
  hide: ['Hide this video?', 'It stops being public until someone unhides it. The reason is shown publicly.', 'Hide video', 'btn-primary'],
  delete: ['Delete this file for good?', 'The file cannot be recovered. The record stays online with this reason.', 'Delete file', 'adm-danger'],
};
const NEXT = { approve: 'published', unhide: 'published', hide: 'hidden', reject: 'rejected', delete: 'removed' };
const BUCKET = { pending: 'clips', hidden: 'hidden' };
const DONE = { approve: 'Approved, now public', unhide: 'Public again', hide: 'Hidden', reject: 'Rejected, file deleted', delete: 'File deleted', update: 'Saved' };

let S = null, keyFn = null, TZS = null;
const bound = new WeakSet();
const pickers = new WeakMap(); // event edit form → its [city, country] pickers
const clipForms = new WeakMap(); // clip edit form → its state (see bindClipForm)
const CLIPS = new Map(); // clip id → its data as last drawn

export async function renderAdmin(root) {
  const s = S = { root, tab: 'clips', counts: {}, items: [], who: '', seq: 0 };
  if (!bound.has(root)) { bound.add(root); root.addEventListener('click', onClick); root.addEventListener('submit', onSubmit); }
  if (keyFn) document.removeEventListener('keydown', keyFn);
  keyFn = onKey; document.addEventListener('keydown', keyFn);
  root.innerHTML = '<div class="adm wrap"><div class="empty">Loading…</div></div>';
  try { s.who = (await api('/api/admin/me')).name; setModerator(true); } catch (e) {
    if (e.status === 401) setModerator(false);
    if (S !== s) return;
    if (e.status === 401) return login();
    root.innerHTML = `<div class="adm wrap"><div class="empty"><b>Can't open moderation</b><p>${esc(e.message)}</p><button class="btn btn-ghost" type="button" data-act="restart">Try again</button></div></div>`;
    return;
  }
  if (S !== s) return;
  shell(); load('clips');
}

/* ---------- views ---------- */
function login(msg = '') {
  S.root.innerHTML = `<div class="adm wrap adm-login-wrap"><form class="card adm-login" data-form="login">
    <span class="adm-login-ico">${ic('shield', 26)}</span>
    <h1>Moderator sign in</h1>
    <p>Uploads wait here until a person has checked them.</p>
    <div class="field"><label for="adm-pw">Password</label><input id="adm-pw" name="password" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="adm-who">Your name, for the moderation log</label><input id="adm-who" name="who" maxlength="40" autocomplete="nickname" required></div>
    <p class="adm-err" role="alert">${esc(msg)}</p>
    <button class="btn btn-primary btn-lg" type="submit">${ic('lock', 18)}Sign in</button>
  </form></div>`;
  $('#adm-pw', S.root)?.focus();
}

function shell() {
  S.root.innerHTML = `<div class="adm wrap">
    <header class="adm-head">
      <div class="adm-title"><h1>Moderation</h1><p>Signed in as <b>${esc(S.who)}</b></p></div>
      <form class="adm-find" data-form="find" role="search">${ic('search', 18)}<input name="q" class="mono" placeholder="ROE-… or SHA-256" aria-label="Find record by number or SHA-256" autocomplete="off" spellcheck="false"><button class="btn btn-ghost btn-sm" type="submit">Find</button></form>
      <button class="btn btn-ghost btn-sm" type="button" data-act="logout">${ic('logout', 16)}Sign out</button>
    </header>
    <section class="adm-found" data-host hidden aria-label="Search results"></section>
    <div class="adm-tabs"><div class="tabs" role="tablist">${TABS.map(([k, t, i]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="false">${ic(i, 16)}${t}<span class="adm-n" data-n="${k}" hidden></span></button>`).join('')}</div></div>
    <p class="adm-keys" data-keys><kbd>J</kbd><kbd>K</kbd> move <kbd>A</kbd> approve <kbd>R</kbd> reject <kbd>S</kbd> sensitive</p>
    <div class="adm-body" data-body></div>
  </div>`;
}

async function load(tab, quiet) {
  S.tab = tab;
  const seq = ++S.seq;
  $$('[data-tab]', S.root).forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  const keys = $('[data-keys]', S.root); if (keys) keys.hidden = tab !== 'clips';
  const body = $('[data-body]', S.root);
  if (!body) return;
  if (!quiet) body.innerHTML = '<div class="empty">Loading…</div>';
  let d;
  try { d = await api('/api/admin/queue?tab=' + tab); } catch (e) {
    if (seq !== S.seq) return;
    if (e.status === 401) return login('Your session has ended. Please sign in again.');
    body.innerHTML = `<div class="empty"><b>Couldn't load</b><p>${esc(e.message)}</p><button class="btn btn-ghost" type="button" data-act="retry">Try again</button></div>`;
    return;
  }
  if (seq !== S.seq || !body.isConnected) return;
  S.counts = d.counts || {}; S.items = d.items || [];
  paintCounts();
  body.innerHTML = S.items.length ? list(tab, S.items) : empty(tab);
}

const empty = (tab) => `<div class="empty adm-empty">${ic(tab === 'clips' ? 'check' : 'archive', 30)}<b>${EMPTY[tab][0]}</b>${EMPTY[tab][1]}</div>`;
function list(tab, items) {
  if (tab === 'log') return logTable(items);
  const row = tab === 'events' ? eventRow : tab === 'reports' ? reportRow : clipCard;
  return `<div class="adm-list">${items.map(row).join('')}</div>`;
}
function paintCounts() {
  $$('[data-n]', S.root).forEach((el) => { const n = S.counts[el.dataset.n] || 0; el.textContent = n; el.hidden = !n; });
}

/* ---------- clips ---------- */
function clipCard(c) {
  CLIPS.set(c.id, c);
  const tz = c.event?.tz || 'UTC', lm = localMin(c.t, tz);
  const day = new Date(Math.floor(lm) * 60000).toISOString().slice(0, 10);
  const ev = c.event || {};
  const byMod = (k) => (c.edited?.includes(k) ? '<small>Corrected by a moderator</small>' : '');
  return `<article class="adm-clip" tabindex="-1" data-id="${c.id}" data-status="${esc(c.status)}" data-label="${esc(c.label)}" data-sens="${c.sensitive ? 1 : 0}" aria-label="${esc(c.record || 'Upload ' + c.id)}">
    <div class="adm-media">${c.video
    ? `<video controls preload="metadata" playsinline src="${esc(c.video)}"${c.poster ? ` poster="${esc(c.poster)}"` : ''}></video>`
    : `<div class="adm-novideo">${ic('eyeoff', 28)}<span>No file</span></div>`}</div>
    <div class="adm-info">
      <div class="adm-line">
        <b class="mono adm-rec">${esc(c.record || '#' + c.id)}</b>
        <span class="adm-st ${esc(c.status)}">${CLIP_ST[c.status] || esc(c.status)}</span>
        ${c.reports ? `<span class="adm-st warn">${ic('flag', 13)}${c.reports} open report${c.reports === 1 ? '' : 's'}</span>` : ''}
      </div>
      <a class="adm-evlink" href="/e/${esc(ev.slug)}"><i class="adm-dot" style="background:${esc(ev.color || 'var(--dim)')}"></i>${esc(ev.title)}</a>
      <dl class="adm-kv">
        <dt>Filmed</dt><dd>${fmtDate(day)}, ${fmtTime(lm, true)} ${esc(tzName(tz, c.t))}<small>${TS[c.ts] || esc(c.ts)}</small></dd>
        <dt>File</dt><dd>${dur(c.d)} · ${bytes(c.z)} · ${c.w && c.h ? `${c.w}×${c.h}` : 'size unknown'}<small>${esc(c.mime || '')}</small></dd>
        <dt>Place</dt><dd>${c.place ? esc(c.place) : '<span class="adm-dim">Not given</span>'}${byMod('place')}</dd>
        <dt>Removed</dt><dd>${c.stripped?.length ? c.stripped.map((x) => `<span class="adm-tag">${esc(x)}</span>`).join('') : '<span class="adm-dim">Nothing</span>'}</dd>
        <dt>Uploaded</dt><dd>${ago(c.created)}</dd>
        ${c.sha ? `<dt>SHA-256</dt><dd><button type="button" class="adm-hash mono" data-copy="${esc(c.sha)}" title="Copy fingerprint">${esc(c.sha.slice(0, 20))}…${ic('copy', 13)}</button></dd>` : ''}
      </dl>
      ${c.note ? `<blockquote class="adm-quote">${ic('quote', 16)}<span>${esc(c.note)}${c.edited?.includes('note') ? '<small>Edited by a moderator</small>' : ''}</span></blockquote>` : ''}
      ${c.reason ? `<p class="adm-public">${ic('info', 15)}<span>Public note: ${esc(c.reason)}</span></p>` : ''}
      ${controls(c)}
      <div class="adm-panel" data-panel hidden></div>
      <div data-editslot></div>
    </div>
  </article>`;
}

function controls(c) {
  const b = (act, label, cls, icon) => `<button type="button" class="btn btn-sm ${cls}" data-act="${act}">${ic(icon, 16)}${label}</button>`;
  const edit = b('clip-edit', 'Edit details', 'btn-ghost', 'edit');
  if (!['pending', 'published', 'hidden'].includes(c.status)) return `<div class="adm-btns">${edit}</div>`;
  const seg = `<div class="adm-seg" role="radiogroup" aria-label="Label">${Object.keys(LABEL).map((k) => `<button type="button" role="radio" data-setlabel="${k}" aria-checked="${k === c.label}" class="${k === c.label ? 'on' : ''}" title="${esc(LABEL[k][2])}">${ic(LABEL[k][1], 14, 2.4)}<span>${LABEL[k][0]}</span></button>`).join('')}</div>`;
  const sens = `<button type="button" class="adm-sens${c.sensitive ? ' on' : ''}" data-act="sens" aria-pressed="${!!c.sensitive}">${ic('eyeoff', 16)}Sensitive</button>`;
  const btns = c.status === 'pending' ? b('approve', 'Approve', 'btn-primary', 'check') + b('ask-reject', 'Reject', 'adm-danger-ghost', 'x')
    : c.status === 'published' ? b('update', 'Save label', 'btn-ghost', 'check') + b('ask-hide', 'Hide', 'btn-ghost', 'eyeoff') + b('ask-delete', 'Delete file', 'adm-danger-ghost', 'trash')
      : b('unhide', 'Unhide', 'btn-primary', 'eye') + b('ask-delete', 'Delete', 'adm-danger-ghost', 'trash');
  return `<div class="adm-ctl">${seg}${sens}</div><div class="adm-btns">${btns}${edit}</div>`;
}

function setLabel(card, k) {
  card.dataset.label = k;
  $$('[data-setlabel]', card).forEach((b) => { const on = b.dataset.setlabel === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  dirty(card);
}
function toggleSens(card) {
  const on = card.dataset.sens !== '1';
  card.dataset.sens = on ? '1' : '0';
  const b = $('[data-act="sens"]', card); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  dirty(card);
}
const dirty = (card) => { const s = $('[data-act="update"]', card); if (s) s.classList.replace('btn-ghost', 'btn-primary'); };

function ask(card, kind) {
  const p = $('[data-panel]', card);
  if (!p) return;
  const [h, sub, go, cls] = ASK[kind];
  const quick = kind === 'hide' ? ['Hidden while reports are reviewed', ...QUICK] : QUICK;
  p.innerHTML = `<b>${h}</b><p>${sub}</p>
    <div class="adm-quick">${quick.map((r) => `<button type="button" class="chip" data-quick="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <textarea class="adm-in" data-why rows="2" maxlength="300" placeholder="Reason, shown publicly" aria-label="Reason, shown publicly"></textarea>
    <div class="adm-btns"><button type="button" class="btn btn-sm btn-ghost" data-act="cancel">Cancel</button><button type="button" class="btn btn-sm ${cls}" data-act="confirm" data-do="${kind}">${go}</button></div>`;
  p.hidden = false;
  card.classList.add('adm-asking');
  $('[data-why]', p).focus();
}
function closePanel(p) {
  if (!p) return;
  p.hidden = true; p.innerHTML = '';
  const card = p.closest('.adm-clip');
  if (card) { card.classList.remove('adm-asking'); card.focus({ preventScroll: true }); }
}

async function clipAct(card, action, reason) {
  if (!card || card.classList.contains('adm-busy')) return;
  const body = { id: Number(card.dataset.id), action, label: card.dataset.label, sensitive: card.dataset.sens === '1' };
  if (reason) body.reason = reason;
  card.classList.add('adm-busy');
  try { await api('/api/admin/clip', { body }); } catch (e) { card.classList.remove('adm-busy'); return fail(e); }
  card.classList.remove('adm-busy');
  toast(DONE[action]);
  if (action === 'update') { $('[data-act="update"]', card)?.classList.replace('btn-primary', 'btn-ghost'); return; }
  const from = BUCKET[card.dataset.status], to = BUCKET[NEXT[action]];
  if (from && S.counts[from]) S.counts[from]--;
  if (to) S.counts[to] = (S.counts[to] || 0) + 1;
  paintCounts();
  const host = card.closest('[data-host]');
  if (host) {
    find(host, host.dataset.q);
    if (host.matches('.adm-found') && ['clips', 'hidden', 'recent'].includes(S.tab)) load(S.tab, true);
    return;
  }
  drop(card);
}

function drop(el) {
  const listEl = el.parentElement, had = el.contains(document.activeElement);
  const next = el.nextElementSibling || el.previousElementSibling;
  $$('video', el).forEach((v) => v.pause());
  el.style.height = el.offsetHeight + 'px';
  el.classList.add('adm-out');
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.height = '0px'; }));
  setTimeout(() => {
    el.remove();
    if (listEl && !listEl.children.length && listEl.parentElement?.matches('[data-body]')) listEl.parentElement.innerHTML = empty(S.tab);
    else if (had && next?.isConnected) next.focus({ preventScroll: true });
  }, 340);
}

/* ---------- clip details ---------- */
// Times are typed as the wall clock where the event happened, like everywhere else on the site.
const inputTime = (iso, tz) => new Date(Math.round(localMin(iso, tz) * 60) * 1000).toISOString().slice(0, 19);
const tzLabel = (tz, iso) => `${tzName(tz, iso)}, local time`;
// '1:02:03', '2:03' or '123' → seconds; '' → null; anything else → NaN.
function seconds(s) {
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 3 || !parts.every((x) => /^\d+(\.\d+)?$/.test(x))) return NaN;
  return parts.reduce((t, x) => t * 60 + Number(x), 0);
}

function clipForm(c) {
  const p = `ac${c.id}-`, ev = c.event || {}, tz = ev.tz || 'UTC';
  const inp = (n, label, val, extra = '') => `<div class="field"><label for="${p}${n}">${label}</label><input id="${p}${n}" name="${n}" value="${esc(val ?? '')}" ${extra}></div>`;
  const px = 'type="number" min="1" max="16384" step="1" inputmode="numeric" placeholder="Unknown"';
  return `<form class="adm-edit" data-form="clip" novalidate>
    <div class="field"><label for="${p}event">Event</label>${comboHtml(`${p}event`, { icon: 'calendar', chevron: true, value: ev.title, placeholder: 'Search by name, place or date' })}</div>
    <div class="field"><label for="${p}place">Where it was filmed <small>leave empty if unknown</small></label>${comboHtml(`${p}place`, { name: 'place', icon: 'pin', value: c.place, placeholder: 'Search a street, square or landmark' })}</div>
    <div class="row2">
      <div class="field"><label for="${p}captured">Filmed <small data-tzname>${esc(tzLabel(tz, c.t))}</small></label><input id="${p}captured" name="captured" type="datetime-local" step="1" value="${inputTime(c.t, tz)}"></div>
      <div class="field"><label for="${p}ts">Time comes from</label><select id="${p}ts" name="ts">${Object.entries(TS_PICK).map(([k, t]) => `<option value="${k}"${k === c.ts ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    </div>
    <div class="adm-file-grid">
      ${inp('duration', 'Length <small>m:ss</small>', c.d ? dur(c.d) : '', 'inputmode="numeric" placeholder="Unknown" autocomplete="off"')}
      ${inp('width', 'Width <small>px</small>', c.w, px)}${inp('height', 'Height <small>px</small>', c.h, px)}
    </div>
    <div class="field"><label for="${p}note">Uploader’s note <small>shown publicly</small></label><textarea id="${p}note" name="note" rows="2" maxlength="500">${esc(c.note || '')}</textarea></div>
    ${REASONED.includes(c.status) ? `<div class="field"><label for="${p}reason">Public reason <small>shown on the record</small></label><textarea id="${p}reason" name="reason" rows="2" maxlength="300">${esc(c.reason || '')}</textarea></div>` : ''}
    <p class="adm-hint">${ic('lock', 14)}<span>The record number, file size and type, fingerprints and the list of removed details come from the file itself, so they can’t be changed.</span></p>
    <p class="adm-err" role="alert"></p>
    <div class="adm-btns"><button type="button" class="btn btn-sm btn-ghost" data-act="clip-cancel">Cancel</button><button class="btn btn-sm btn-primary" type="submit">${ic('check', 16)}Save details</button></div>
  </form>`;
}

// The event is picked from a search of all events; places are searched near the chosen event,
// its own places first. Moving the clip keeps the moment it was filmed, shown in the new event's time zone.
function bindClipForm(form, c) {
  const p = `ac${c.id}-`, el = form.elements;
  const st = { c, ev: { ...c.event }, places: [], time: el.captured.value, init: { duration: el.duration.value, width: el.width.value, height: el.height.value } };
  const loadPlaces = async (ev) => {
    try { const r = await api(`/api/admin/places?event=${ev.id}`); if (st.ev.id === ev.id) st.places = r.places || []; } catch { /* search still works without them */ }
  };
  const where = (e) => [e.date ? fmtDate(e.date) : '', e.city, e.status && e.status !== 'published' ? EV_ST[e.status] : ''].filter(Boolean).map(esc).join(' · ');
  st.event = combo($(`#${p}event`, form), {
    value: st.ev, text: (e) => e.title, delay: 200,
    async search(q) {
      try { return (await api(`/api/admin/events?q=${encodeURIComponent(q)}`, { retry: false })).events; } catch (e) { return { items: [], error: e.message }; }
    },
    option: (e) => `<span class="oi"><i class="adm-dot" style="background:${esc(e.color || 'var(--dim)')}"></i></span><span><b>${esc(e.title)}</b><small>${where(e)}</small></span>`,
    note: (e) => (where(e) ? `${ic('calendar', 14)}<span>${where(e)}</span>` : ''),
    none: 'No event matches. Try its name, city or date.',
    invalid: 'Pick an event from the list.',
    onPick(e) {
      if (!e || e.id === st.ev.id) return;
      const at = fromLocal(el.captured.value, st.ev.tz || 'UTC');
      const unchanged = el.captured.value === st.time;
      st.ev = e; st.places = [];
      if (at) {
        el.captured.value = inputTime(at.toISOString(), e.tz || 'UTC');
        if (unchanged) st.time = el.captured.value;
        $('[data-tzname]', form).textContent = tzLabel(e.tz || 'UTC', at.toISOString());
      }
      loadPlaces(e);
    },
  });
  st.place = placePicker($(`#${p}place`, form), {
    kind: 'spot', near: () => st.ev, local: () => st.places, label: (pl) => spotName(pl, st.ev),
    value: c.place ? { name: c.place } : null, onPick: () => {},
  });
  el.captured.addEventListener('change', () => { if (el.captured.value !== st.time) el.ts.value = 'moderator'; });
  clipForms.set(form, st);
  loadPlaces(st.ev);
}

async function saveClip(form) {
  const card = form.closest('.adm-clip'), err = $('.adm-err', form), st = clipForms.get(form);
  if (!card || !st) return;
  const el = form.elements, g = (n) => String(el[n]?.value ?? '').trim();
  const bad = (msg, field) => { err.textContent = msg; field?.focus(); };
  if (!st.event.check() || !st.event.get()) return bad('Pick the event from the list.', $('[role="combobox"]', form));
  if (!st.place.check()) return bad('Pick the place from the list, or leave it empty.', el.place);
  const fields = { event: st.ev.id, place: g('place'), ts: g('ts'), note: el.note.value };
  if (g('captured') !== st.time) {
    const at = fromLocal(g('captured'), st.ev.tz || 'UTC');
    if (!at) return bad('Enter the date and time it was filmed.', el.captured);
    fields.captured = at.toISOString();
  }
  if (g('duration') !== st.init.duration) {
    const d = seconds(g('duration'));
    if (Number.isNaN(d) || d === 0) return bad('Write the length as m:ss (or h:mm:ss), or leave it empty.', el.duration);
    fields.duration = d;
  }
  for (const k of ['width', 'height']) {
    if (el[k].validity.badInput) return bad(`The ${k} is a whole number of pixels, or empty.`, el[k]);
    if (g(k) === st.init[k]) continue;
    const n = g(k) ? Number(g(k)) : null;
    if (n !== null && !(Number.isInteger(n) && n > 0 && n <= 16384)) return bad(`The ${k} is a whole number of pixels, or empty.`, el[k]);
    fields[k] = n;
  }
  if (el.reason) {
    if (!g('reason')) return bad('Give a reason, it is shown publicly.', el.reason);
    fields.reason = g('reason');
  }
  err.textContent = '';
  const btn = $('button[type=submit]', form); btn.disabled = true;
  let d;
  try { d = await api('/api/admin/clip', { body: { id: st.c.id, action: 'edit', label: card.dataset.label, sensitive: card.dataset.sens === '1', fields } }); } catch (e) {
    btn.disabled = false;
    return e.status === 401 ? fail(e) : bad(e.message);
  }
  if (!card.isConnected) return;
  $$('video', card).forEach((v) => v.pause());
  const tmp = document.createElement('div'); tmp.innerHTML = clipCard(d.clip);
  const fresh = tmp.firstElementChild;
  card.replaceWith(fresh);
  fresh.focus({ preventScroll: true });
  toast('Details saved');
}

function toggleClipEdit(card) {
  const slot = $('[data-editslot]', card), c = CLIPS.get(Number(card.dataset.id));
  if (!slot || !c) return;
  if (slot.children.length) { slot.innerHTML = ''; return; }
  slot.innerHTML = clipForm(c);
  bindClipForm($('form', slot), c);
  slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------- find ---------- */
async function find(host, q) {
  q = String(q || '').trim();
  if (!q) return;
  host.dataset.q = q; host.hidden = false;
  if (!host.children.length) host.innerHTML = '<div class="empty adm-sm">Searching…</div>';
  let d;
  try { d = await api('/api/admin/find?q=' + encodeURIComponent(q)); } catch (e) { host.hidden = true; host.innerHTML = ''; return fail(e); }
  if (host.dataset.q !== q) return;
  host.innerHTML = `<div class="adm-found-head"><b>${host.matches('.adm-found') ? `Results for <span class="mono">${esc(q)}</span>` : 'Reported video'}</b><button type="button" class="iconbtn adm-x" data-act="close-find" aria-label="Close">${ic('x', 16)}</button></div>`
    + (d.items?.length ? `<div class="adm-list">${d.items.map(clipCard).join('')}</div>`
      : '<div class="empty adm-sm"><b>No match</b>Check the record number, or paste the full 64-character SHA-256.</div>');
}

/* ---------- events ---------- */
function eventRow(ev) {
  const place = [ev.city, ev.country].filter(Boolean).join(', ');
  const b = (act, label, cls, icon) => `<button type="button" class="btn btn-sm ${cls}" data-act="${act}">${ic(icon, 16)}${label}</button>`;
  const acts = (ev.status === 'pending' ? b('ev-approve', 'Approve', 'btn-primary', 'check') + b('ev-hide', 'Hide', 'btn-ghost', 'eyeoff')
    : ev.status === 'hidden' ? b('ev-unhide', 'Unhide', 'btn-primary', 'eye') : b('ev-hide', 'Hide', 'btn-ghost', 'eyeoff'))
    + b('ev-edit', 'Edit', 'btn-ghost', 'edit');
  return `<article class="card adm-evt" data-eid="${ev.id}">
    <div class="adm-evt-top">
      <i class="adm-dot lg" style="background:${esc(ev.color || 'var(--dim)')}"></i>
      <div class="adm-evt-tx">
        <a class="adm-evt-title" href="/e/${esc(ev.slug)}">${esc(ev.title)}</a>
        <p>${ev.date ? fmtDate(ev.date) : ''}${place ? ' · ' + esc(place) : ''}${ev.kind ? ' · ' + esc(ev.kind) : ''}</p>
        <div class="adm-line"><span class="adm-st ${esc(ev.status)}">${EV_ST[ev.status] || esc(ev.status)}</span><span class="adm-dim">${ev.n || 0} public · ${ev.pending || 0} waiting</span>${ev.code ? `<span class="mono adm-code">${esc(ev.code)}</span>` : ''}</div>
      </div>
    </div>
    <div class="adm-btns">${acts}</div>
    <div data-editslot></div>
  </article>`;
}

async function evAct(row, action) {
  const ev = S.items.find((x) => x.id === Number(row.dataset.eid));
  if (!ev || row.classList.contains('adm-busy')) return;
  row.classList.add('adm-busy');
  try { await api('/api/admin/event', { body: { id: ev.id, action } }); } catch (e) { row.classList.remove('adm-busy'); return fail(e); }
  if (!row.isConnected) return;
  if (ev.status === 'pending' && S.counts.events) S.counts.events--;
  ev.status = action === 'hide' ? 'hidden' : 'published';
  paintCounts();
  row.outerHTML = eventRow(ev);
  toast(action === 'hide' ? 'Event hidden' : 'Event is public');
}

const tzList = () => TZS || (TZS = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })());
function editForm(ev) {
  const p = `ae${ev.id}-`, f = ev.figures || {};
  const kinds = [...new Set([...(config.kinds || []), ev.kind].filter(Boolean))];
  const tzs = tzList().includes(ev.tz) ? tzList() : [ev.tz, ...tzList()].filter(Boolean);
  const opt = (v, cur) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`;
  const inp = (n, label, val, extra = '') => `<div class="field"><label for="${p}${n}">${label}</label><input id="${p}${n}" name="${n}" value="${esc(val ?? '')}" ${extra}></div>`;
  return `<form class="adm-edit" data-form="event">
    ${inp('title', 'Title', ev.title, 'maxlength="140" required')}
    <div class="row2">
      <div class="field"><label for="${p}kind">Kind</label><select id="${p}kind" name="kind">${kinds.map((k) => opt(k, ev.kind)).join('')}</select></div>
      <div class="field"><label for="${p}tz">Time zone</label><select id="${p}tz" name="tz">${tzs.map((z) => opt(z, ev.tz)).join('')}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label for="${p}city">City or place</label>${comboHtml(`${p}city`, { name: 'city', icon: 'pin', value: ev.city, placeholder: 'Search a city or place' })}</div>
      <div class="field"><label for="${p}country">Country</label>${comboHtml(`${p}country`, { name: 'country', icon: 'globe', chevron: true, value: findCountry(ev.country)?.name || ev.country, placeholder: 'Search countries' })}</div>
    </div>
    <input type="hidden" name="lat"><input type="hidden" name="lon">
    <div class="field"><label for="${p}summary">Summary</label><textarea id="${p}summary" name="summary" rows="4" maxlength="3000">${esc(ev.summary || '')}</textarea></div>
    ${inp('aliases', 'Other names <small>comma separated</small>', (ev.aliases || []).join(', '))}
    <div class="field"><label for="${p}sources">Sources <small>one per line: Title | https://…</small></label><textarea id="${p}sources" name="sources" rows="3" spellcheck="false">${esc((ev.sources || []).map((s) => (s.title ? s.title + ' | ' : '') + s.url).join('\n'))}</textarea></div>
    <fieldset class="adm-fig"><legend>Figures <small>leave the label empty for none</small></legend>
      <div class="adm-fig-grid">${inp('fl', 'Label', f.label, 'maxlength="80" placeholder="e.g. Crowd estimate"')}${inp('flo', 'Low', f.low, 'maxlength="40"')}${inp('fhi', 'High', f.high, 'maxlength="40"')}</div>
      ${inp('fnote', 'Note', f.note, 'maxlength="200"')}
    </fieldset>
    <p class="adm-err" role="alert"></p>
    <div class="adm-btns"><button type="button" class="btn btn-sm btn-ghost" data-act="ev-cancel">Cancel</button><button class="btn btn-sm btn-primary" type="submit">${ic('check', 16)}Save event</button></div>
  </form>`;
}

// City and country are picked from search results, like on the new-event form. A country saved
// before the list existed shows as it is and is kept unless it's changed.
function bindEditForm(form, ev) {
  const p = `ae${ev.id}-`, tz = form.elements.tz;
  const setTz = (z) => { if (!z) return; if (![...tz.options].some((o) => o.value === z)) tz.add(new Option(z, z), 0); tz.value = z; };
  const country = countryPicker($(`#${p}country`), { value: findCountry(ev.country) || (ev.country ? { name: ev.country } : null), onPick: (c) => { if (c) setTz(zoneFor(null, c, tz.value)); } });
  const city = placePicker($(`#${p}city`), { kind: 'city', value: ev.city ? { name: ev.city } : null, onPick: (pl) => {
    form.elements.lat.value = pl && pl.lat != null ? pl.lat : '';
    form.elements.lon.value = pl && pl.lon != null ? pl.lon : '';
    const c = pl && countryByCode(pl.cc);
    if (c) country.set(c);
    if (pl) setTz(zoneFor(pl, country.get(), tz.value));
  } });
  pickers.set(form, [city, country]);
}

async function saveEvent(form) {
  const row = form.closest('.adm-evt'), err = $('.adm-err', form);
  const ev = S.items.find((x) => x.id === Number(row?.dataset.eid));
  if (!ev) return;
  if (!(pickers.get(form) || []).map((x) => x.check()).every(Boolean)) { err.textContent = 'Pick the city and country from the lists.'; return; }
  const g = (n) => String(new FormData(form).get(n) || '').trim();
  const sources = [];
  const lines = g('sources').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:(.*?)\s*\|\s*)?(https?:\/\/\S+)$/i);
    if (!m) { err.textContent = `Source line ${i + 1}: use “Title | https://…”`; return; }
    sources.push({ title: (m[1] || '').trim(), url: m[2] });
  }
  const fields = {
    title: g('title'), kind: g('kind'), city: g('city'), country: g('country'), lat: g('lat'), lon: g('lon'), tz: g('tz'), summary: g('summary'),
    aliases: g('aliases').split(',').map((a) => a.trim()).filter(Boolean), sources,
    figures: { label: g('fl'), low: g('flo'), high: g('fhi'), note: g('fnote') },
  };
  err.textContent = '';
  const btn = $('button[type=submit]', form); btn.disabled = true;
  try { await api('/api/admin/event', { body: { id: ev.id, action: 'update', fields } }); } catch (e) { btn.disabled = false; return e.status === 401 ? fail(e) : (err.textContent = e.message); }
  Object.assign(ev, fields, { figures: fields.figures.label ? fields.figures : null, title: fields.title || ev.title, city: fields.city || ev.city, lat: fields.lat ? +fields.lat : ev.lat, lon: fields.lon ? +fields.lon : ev.lon });
  row.outerHTML = eventRow(ev);
  toast('Event saved');
}

/* ---------- reports ---------- */
function reportRow(r) {
  const target = [
    r.record ? `<a class="mono" href="/r/${esc(r.record)}">${esc(r.record)}</a>${r.clipStatus ? ` <span class="adm-dim">${CLIP_ST[r.clipStatus] || esc(r.clipStatus)}</span>` : ''}` : '',
    r.slug ? `<a href="/e/${esc(r.slug)}">${esc(r.title || r.slug)}</a>` : '',
  ].filter(Boolean).join(' · ');
  return `<article class="card adm-rep" data-rid="${r.id}">
    <div class="adm-line"><b class="mono">${esc(r.ref)}</b><span class="adm-st warn">${ic('flag', 13)}${esc(REASONS[r.reason] || r.reason)}</span><span class="adm-dim">${ago(r.created)}</span></div>
    ${target ? `<p class="adm-rep-target">${target}</p>` : ''}
    ${r.details ? `<blockquote class="adm-quote">${ic('quote', 16)}<span>${esc(r.details)}</span></blockquote>` : ''}
    ${r.contact ? `<p class="adm-contact">${ic('user', 15)}<span>${esc(r.contact)}</span><button type="button" class="adm-linkbtn" data-copy="${esc(r.contact)}">Copy</button></p>` : ''}
    ${r.record ? `<button type="button" class="btn btn-sm btn-ghost" data-act="load-rec" data-q="${esc(r.record)}">${ic('film', 16)}Load video here</button>` : ''}
    <div class="adm-inline" data-host hidden></div>
    <div class="adm-resolve"><input class="adm-in" data-note maxlength="500" placeholder="Note (optional)" aria-label="Note (optional)">
      <div class="adm-btns"><button type="button" class="btn btn-sm btn-primary" data-act="resolve" data-st="resolved">${ic('check', 16)}Resolve</button><button type="button" class="btn btn-sm btn-ghost" data-act="resolve" data-st="dismissed">Dismiss</button></div></div>
  </article>`;
}

async function resolve(rep, status) {
  if (rep.classList.contains('adm-busy')) return;
  rep.classList.add('adm-busy');
  try { await api('/api/admin/report', { body: { id: Number(rep.dataset.rid), status, resolution: $('[data-note]', rep).value.trim() } }); } catch (e) { rep.classList.remove('adm-busy'); return fail(e); }
  if (S.counts.reports) S.counts.reports--;
  paintCounts();
  toast(status === 'resolved' ? 'Report resolved' : 'Report dismissed');
  drop(rep);
}

/* ---------- log ---------- */
function logTable(rows) {
  const detail = (d) => { if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } } return d && typeof d === 'object' ? d : {}; };
  const tone = (a) => (/approve|unhide|resolved|login/.test(a) ? 'ok' : /reject|delete|withdraw/.test(a) ? 'bad' : /hide|dismiss/.test(a) ? 'warn' : '');
  const target = (r) => (/^ROE-/i.test(r.target) ? `<a href="/r/${esc(r.target)}">${esc(r.target)}</a>` : r.action.startsWith('event:') ? `<a href="/e/${esc(r.target)}">${esc(r.target)}</a>` : esc(r.target));
  return `<div class="adm-tablewrap"><table class="adm-log"><thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th></tr></thead><tbody>${rows.map((r) => {
    const d = detail(r.detail);
    const changed = d.changed && typeof d.changed === 'object' ? Object.keys(d.changed).map((k) => CHANGED[k] || k) : [];
    return `<tr><td title="${esc(new Date(r.at).toLocaleString())}">${ago(r.at)}</td><td>${esc(r.actor)}</td><td><span class="adm-act ${tone(r.action)}">${esc(r.action)}</span>${d.reason ? `<small>${esc(d.reason)}</small>` : ''}${changed.length ? `<small>Changed ${esc(changed.join(', '))}</small>` : ''}</td><td class="mono">${target(r)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/* ---------- events (DOM) ---------- */
function fail(e) {
  if (e.status === 401) return login('Your session has ended. Please sign in again.');
  toast(e.message, 'alert');
}

async function onSubmit(e) {
  const f = e.target.closest('form[data-form]');
  if (!S || !f || !f.closest('.adm')) return;
  e.preventDefault();
  const kind = f.dataset.form;
  if (kind === 'find') {
    const q = f.elements.q.value.trim(), host = $('.adm-found', S.root);
    if (q && host) { host.innerHTML = ''; find(host, q); }
  } else if (kind === 'event') saveEvent(f);
  else if (kind === 'clip') saveClip(f);
  else if (kind === 'login') {
    const fd = new FormData(f), btn = $('button[type=submit]', f), err = $('.adm-err', f);
    btn.disabled = true; err.textContent = '';
    try {
      S.who = (await api('/api/admin/login', { body: { password: fd.get('password'), name: String(fd.get('who') || '').trim() } })).name;
      setModerator(true);
      shell(); load('clips');
    } catch (x) { err.textContent = x.message; btn.disabled = false; f.elements.password.select(); }
  }
}

function onClick(e) {
  if (!S || !e.target.closest('.adm')) return;
  const t = e.target.closest('[data-tab],[data-act],[data-setlabel],[data-quick],[data-copy]');
  if (!t) return;
  const card = t.closest('.adm-clip');
  if (t.dataset.tab) return load(t.dataset.tab);
  if (t.dataset.setlabel) return setLabel(card, t.dataset.setlabel);
  if (t.dataset.copy) return copy(t.dataset.copy);
  if (t.dataset.quick) {
    const p = t.closest('[data-panel]');
    $('[data-why]', p).value = t.dataset.quick;
    $$('[data-quick]', p).forEach((b) => b.classList.toggle('on', b === t));
    return;
  }
  const act = t.dataset.act;
  switch (act) {
    case 'restart': renderAdmin(S.root); break;
    case 'retry': load(S.tab); break;
    case 'logout': t.disabled = true; api('/api/admin/logout', { method: 'POST' }).catch(() => {}).then(() => { setModerator(false); login(); }); break;
    case 'sens': toggleSens(card); break;
    case 'clip-edit': toggleClipEdit(card); break;
    case 'clip-cancel': t.closest('[data-editslot]').innerHTML = ''; card?.focus({ preventScroll: true }); break;
    case 'approve': case 'unhide': case 'update': clipAct(card, act); break;
    case 'ask-reject': case 'ask-hide': case 'ask-delete': ask(card, act.slice(4)); break;
    case 'cancel': closePanel(t.closest('[data-panel]')); break;
    case 'confirm': {
      const why = $('[data-why]', t.closest('[data-panel]'));
      if (!why.value.trim()) { toast('Give a reason, it is shown publicly', 'alert'); why.focus(); return; }
      clipAct(card, t.dataset.do, why.value.trim());
      break;
    }
    case 'close-find': { const h = t.closest('[data-host]'); $$('video', h).forEach((v) => v.pause()); h.hidden = true; h.innerHTML = ''; delete h.dataset.q; break; }
    case 'load-rec': { const h = $('[data-host]', t.closest('.adm-rep')); h.innerHTML = ''; find(h, t.dataset.q); break; }
    case 'ev-approve': case 'ev-hide': case 'ev-unhide': evAct(t.closest('.adm-evt'), act.slice(3)); break;
    case 'ev-edit': {
      const row = t.closest('.adm-evt'), slot = $('[data-editslot]', row);
      if (slot.children.length) { slot.innerHTML = ''; break; }
      const ev = S.items.find((x) => x.id === Number(row.dataset.eid));
      if (ev) { slot.innerHTML = editForm(ev); bindEditForm($('form', slot), ev); $('input', slot)?.focus(); }
      break;
    }
    case 'ev-cancel': t.closest('[data-editslot]').innerHTML = ''; break;
    case 'resolve': resolve(t.closest('.adm-rep'), t.dataset.st); break;
    default:
  }
}

function onKey(e) {
  if (!S || !S.root.querySelector('.adm')) { document.removeEventListener('keydown', onKey); if (keyFn === onKey) keyFn = null; return; }
  const active = document.activeElement;
  if (e.key === 'Escape') { const p = active?.closest?.('.adm-clip')?.querySelector('[data-panel]:not([hidden])'); if (p) { e.preventDefault(); closePanel(p); } return; }
  if (S.tab !== 'clips' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (!'jkars'.includes(k) || k.length !== 1) return;
  const cards = $$('[data-body] .adm-clip', S.root);
  if (!cards.length) return;
  const cur = active?.closest?.('.adm-clip'), i = cards.indexOf(cur);
  e.preventDefault();
  if (k === 'j' || k === 'k' || i < 0) {
    const n = cards[i < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, i + (k === 'j' ? 1 : -1)))];
    n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (k === 'a' && cur.dataset.status === 'pending') clipAct(cur, 'approve');
  else if (k === 'r' && cur.dataset.status === 'pending') ask(cur, 'reject');
  else if (k === 's') toggleSens(cur);
}
