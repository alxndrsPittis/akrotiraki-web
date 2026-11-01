// Calendar: five views of the reservations.
//  Month    units × days timeline for one month (tap a day to add, a bar to open).
//  3 months the same timeline compressed (names on wide screens only).
//  Season   season_start..season_end from Settings, bars only.
//  Year     January–December, bars only.
//  List     stays grouped by month (whole-house bookings merged into one row).
// The chosen view is remembered on the device (localStorage). Bars in the compressed views show a small label on
// hover (mouse) or on the first tap (touch); a second tap, or the label, opens the reservation.
import { state, activeUnits, unitById, groupMembers, pendingCount } from '../state.js';
import { h, icon } from '../ui.js';
import { todayISO, ymd, addDays, diffDays, daysInMonth, weekday, MONTHS, MON, WD1, fmtRange, fmtDate,
  plural, fromWebsite, SOURCES, STATUSES, byCheckIn } from '../lib.js';
import { openReservation } from './reservation.js';

const VIEWS = { month: 'Month', quarter: '3 months', season: 'Season', year: 'Year', list: 'List' };
const VIEW_KEY = 'ak.cal.view';
const MONTHS_SHOWN = { month: 1, quarter: 3, list: 3 }; // prev/next moves by this many months; season and year by a year
const yearly = (v) => v === 'season' || v === 'year';

let view = readView();
let cur = null;            // {y, m}: first month shown (month, 3 months, list); y alone for season and year
let showCancelled = false;
let sourceFilter = '';     // '' = all sources
let lastKey = null;
let lastPointer = '';
let tip = null;            // {el, id, pinned}

function readView() {
  try { const v = localStorage.getItem(VIEW_KEY); return VIEWS[v] ? v : 'month'; } catch { return 'month'; }
}
function saveView(v) {
  view = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
}

/** Season as MM-DD strings from Settings (fallback 1 May – 31 Oct). */
function seasonDays() {
  const ok = (s) => /^\d{2}-\d{2}$/.test(s || '');
  return { start: ok(state.settings?.season_start) ? state.settings.season_start : '05-01',
    end: ok(state.settings?.season_end) ? state.settings.season_end : '10-31' };
}
/** The season that contains today, or the next one once this year's has ended. */
function seasonYearOf(today) {
  return today.slice(5) <= seasonDays().end ? +today.slice(0, 4) : +today.slice(0, 4) + 1;
}
const monthStart = (y, m, d = 0) => { const t = new Date(Date.UTC(y, m + d, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; };

/** Range [first, end) and title of the current view. */
function rangeOf() {
  const { y, m } = cur;
  if (view === 'season') {
    const { start, end } = seasonDays();
    const last = end >= start ? `${y}-${end}` : `${y + 1}-${end}`;
    const first = `${y}-${start}`;
    return { first, end: addDays(last, 1), title: `Season ${y}`, sub: `${fmtDate(first, { year: false })} – ${fmtDate(last, { year: false })}` };
  }
  if (view === 'year') return { first: `${y}-01-01`, end: `${y + 1}-01-01`, title: String(y) };
  const k = MONTHS_SHOWN[view];
  const after = monthStart(y, m, k);
  const lastM = monthStart(y, m, k - 1);
  const title = k === 1 ? `${MONTHS[m]} ${y}`
    : lastM.y === y ? `${MON[m]} – ${MON[lastM.m]} ${y}` : `${MON[m]} ${y} – ${MON[lastM.m]} ${lastM.y}`;
  return { first: ymd(y, m, 1), end: ymd(after.y, after.m, 1), title };
}
/** The cursor that shows today in view v. */
function todayCursor(v, today) {
  return v === 'season' ? { y: seasonYearOf(today), m: 0 } : { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 };
}

const visible = (r) => (showCancelled || r.status !== 'cancelled') && (!sourceFilter || r.source === sourceFilter);

function switchView(k, today) {
  const was = view;
  saveView(k);
  if (yearly(was) === yearly(k)) return; // season ↔ year keep the year; month ↔ 3 months ↔ list keep the first month
  const showsToday = cur.y === todayCursor(was, today).y && (yearly(was) || cur.m === todayCursor(was, today).m);
  if (showsToday) cur = todayCursor(k, today);
  else if (yearly(k)) cur = { y: cur.y, m: 0 };
  else cur = { y: cur.y, m: was === 'season' ? +seasonDays().start.slice(0, 2) - 1 : 0 };
}

export function renderCalendar(root) {
  const today = todayISO();
  if (!cur) cur = todayCursor(view, today);
  hideTip();
  const prevWrap = root.querySelector('.cal-wrap.month');
  const keepScroll = prevWrap ? prevWrap.scrollLeft : null;
  const key = `${view}-${cur.y}-${cur.m}`;
  const rangeChanged = key !== lastKey;
  lastKey = key;

  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }

  const rng = rangeOf();
  const hasToday = view === 'season' ? cur.y === seasonYearOf(today) : today >= rng.first && today < rng.end;
  const rerender = () => renderCalendar(root);
  const shift = (d) => {
    cur = yearly(view) ? { y: cur.y + d, m: cur.m } : monthStart(cur.y, cur.m, d * MONTHS_SHOWN[view]);
    rerender();
  };
  const stepWord = yearly(view) ? 'year' : view === 'month' ? 'month' : 'three months';
  // A whole-house request counts once, as on the Requests tab.
  const pendingN = pendingCount();

  const seg = h('div', { class: 'seg cal-views', role: 'radiogroup', 'aria-label': 'Calendar view' },
    Object.entries(VIEWS).map(([k, label]) => [
      h('input', { type: 'radio', name: 'cal-view', id: `cal-view-${k}`, value: k, checked: k === view,
        onchange: () => { switchView(k, today); rerender(); } }),
      h('label', { for: `cal-view-${k}` }, label),
    ]));

  const srcSel = h('select', { value: sourceFilter, 'aria-label': 'Source', onchange: (e) => { sourceFilter = e.target.value; rerender(); } },
    h('option', { value: '' }, 'All sources'), Object.entries(SOURCES).map(([k, v]) => h('option', { value: k }, v.label)));

  root.append(h('div', { class: 'cal-toolbar' },
    seg,
    h('div', { class: 'month-nav' },
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': `Previous ${stepWord}`, onclick: () => shift(-1) }, icon('left')),
      h('h2', { class: 'month-title', 'aria-live': 'polite' }, rng.title, rng.sub ? h('small', null, rng.sub) : null),
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': `Next ${stepWord}`, onclick: () => shift(1) }, icon('right')),
      h('button', { class: 'btn', type: 'button', disabled: hasToday, onclick: () => { cur = todayCursor(view, today); lastKey = null; rerender(); } }, 'Today')),
    h('div', { class: 'cal-actions' },
      h('a', { class: `btn chip ${pendingN ? 'pending' : ''}`, href: '#requests' }, `Pending (${pendingN})`),
      h('label', { class: 'field compact cal-src' }, h('span', { class: 'sr-only' }, 'Source'), srcSel),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', class: 'switch sm', role: 'switch', checked: showCancelled,
          onchange: (e) => { showCancelled = e.target.checked; rerender(); } }),
        'Show cancelled'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openReservation(hasToday || view !== 'month' ? {} : { check_in: rng.first, check_out: addDays(rng.first, 1) }) },
        icon('plus'), 'New'))));

  if (view === 'list') { root.append(listView(rng, today)); return; }
  if (view === 'month') monthGrid(root, rng, today, hasToday, keepScroll, rangeChanged);
  else compactGrid(root, rng, today, view);
  root.append(legend(view), upcoming(today));
}

/** Greedy lane assignment so overlapping stays (pending vs confirmed, cancelled) stack instead of hiding each other. */
function lanesFor(unitId, first, end) {
  const list = state.reservations
    .filter((r) => r.unit_id === unitId && visible(r) && r.check_in < end && r.check_out > first)
    .sort((a, b) => (a.status === 'cancelled') - (b.status === 'cancelled') || a.check_in.localeCompare(b.check_in));
  const lanes = [];
  const placed = list.map((r) => {
    let li = lanes.findIndex((lane) => lane.every((o) => !(r.check_in < o.check_out && o.check_in < r.check_out)));
    if (li < 0) { lanes.push([]); li = lanes.length - 1; }
    lanes[li].push(r);
    return { r, lane: li };
  });
  return { placed, count: Math.max(1, lanes.length) };
}

function barLabel(r, u) {
  const src = SOURCES[r.source] || { label: r.source };
  const mail = r.status === 'pending' && !!r.email;
  return `${r.guest_name || 'Unnamed'}, ${u?.name || r.unit_id}, ${fmtRange(r.check_in, r.check_out)}, ${STATUSES[r.status] || r.status}, ${src.label}` +
    `${r.group_id ? ', part of a whole-house booking' : ''}${mail ? `, ${fromWebsite(r) ? 'website request' : 'has email'}` : ''}`;
}

function unitCell(u, span) {
  return h('div', { class: 'cal-unit', style: `${span};grid-column:1` },
    h('span', { class: 'dot', style: `background:${u.color || 'var(--sea)'}` }),
    h('span', { class: 'cal-unit-name' }, h('span', null, u.name), h('small', null, u.type)));
}

// ---------- Month: the day-by-day timeline ----------
function monthGrid(root, rng, today, isThisMonth, keepScroll, monthChanged) {
  const { first, end } = rng;
  const n = diffDays(first, end);
  const units = activeUnits();
  const grid = h('div', { class: 'cal-grid' });
  grid.style.gridTemplateColumns = `var(--unit-col) repeat(${n}, minmax(var(--day-min), 1fr))`;
  grid.style.minWidth = `calc(var(--unit-col) + ${n} * var(--day-min))`;
  const rows = ['auto'];

  grid.append(h('div', { class: 'cal-corner', style: 'grid-row:1;grid-column:1' }, h('span', { class: 'sr-only' }, 'Unit')));
  for (let d = 0; d < n; d++) {
    const date = addDays(first, d);
    const wd = weekday(date);
    grid.append(h('div', {
      class: `cal-day-h${wd === 0 || wd === 6 ? ' we' : ''}${date === today ? ' today' : ''}`,
      style: `grid-row:1;grid-column:${d + 2}`, 'aria-hidden': 'true',
    }, h('span', null, WD1[wd]), h('b', null, +date.slice(8))));
  }

  let row = 2;
  for (const u of units) {
    const { placed, count: L } = lanesFor(u.id, first, end);
    rows.push(`repeat(${L}, var(--lane))`);
    const span = `grid-row:${row} / span ${L}`;
    grid.append(unitCell(u, span));

    for (let d = 0; d < n; d++) {
      const date = addDays(first, d);
      const wd = weekday(date);
      grid.append(h('button', {
        type: 'button', tabindex: -1,
        class: `cal-cell${wd === 0 || wd === 6 ? ' we' : ''}${date === today ? ' today' : ''}`,
        style: `${span};grid-column:${d + 2}`,
        'aria-label': `New reservation, ${u.name}, ${fmtDate(date, { weekday: true })}`,
        onclick: () => openReservation({ unit_id: u.id, check_in: date, check_out: addDays(date, 1) }),
      }));
    }

    for (const { r, lane } of placed) {
      const s = r.check_in < first ? first : r.check_in;
      const e = r.check_out > end ? end : r.check_out;
      const src = SOURCES[r.source] || { mark: '??', label: r.source };
      const mail = r.status === 'pending' && !!r.email;
      const label = barLabel(r, u);
      grid.append(h('button', {
        type: 'button',
        class: `cal-bar ${r.status}${r.check_in < first ? ' cl' : ''}${r.check_out > end ? ' cr' : ''}`,
        style: `grid-row:${row + lane};grid-column:${diffDays(first, s) + 2} / ${diffDays(first, e) + 2}`,
        title: label, 'aria-label': label,
        onclick: () => openReservation(r),
      }, h('abbr', { class: 'src', title: src.label }, src.mark),
      r.group_id ? icon('link', 'ic bar-link') : null,
      mail ? icon('mail', 'ic bar-mail') : null, h('span', { class: 'name' }, r.guest_name || 'Unnamed')));
    }
    row += L;
  }
  grid.style.gridTemplateRows = rows.join(' ');

  const wrap = h('div', { class: 'cal-wrap month' }, grid);
  root.append(wrap);
  if (!units.length) wrap.after(h('p', { class: 'empty' }, 'No units yet. Add them in the Units tab of the Sheet.'));

  if (keepScroll != null && !monthChanged) wrap.scrollLeft = keepScroll;
  else if (isThisMonth) {
    requestAnimationFrame(() => {
      const cell = grid.querySelector('.cal-day-h.today');
      const unitCol = grid.querySelector('.cal-corner');
      if (cell && unitCol && wrap.scrollWidth > wrap.clientWidth) {
        wrap.scrollLeft = Math.max(0, cell.offsetLeft - unitCol.offsetWidth - cell.offsetWidth * 2);
      }
    });
  }
}

// ---------- 3 months / Season / Year: compressed to the width, no day cells ----------
function compactGrid(root, rng, today, mode) {
  const { first, end } = rng;
  const n = diffDays(first, end);
  const units = activeUnits();
  const grid = h('div', { class: `cal-grid compact ${mode}` });
  grid.style.gridTemplateColumns = `var(--unit-col) repeat(${n}, minmax(0, 1fr))`;
  const rows = mode === 'quarter' ? ['auto', 'auto'] : ['auto'];
  const head = rows.length;

  grid.append(h('div', { class: 'cal-corner', style: `grid-row:1 / span ${head};grid-column:1` }, h('span', { class: 'sr-only' }, 'Unit')));
  // Month labels (and day ticks for 3 months); a separator line at each month start.
  const seps = [];
  for (let d = first; d < end;) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1;
    const nm = monthStart(y, m, 1);
    const next = ymd(nm.y, nm.m, 1);
    const stop = next < end ? next : end;
    const c0 = diffDays(first, d) + 2;
    grid.append(h('div', { class: 'cal-mh', style: `grid-row:1;grid-column:${c0} / ${diffDays(first, stop) + 2}`, 'aria-hidden': 'true' },
      mode === 'quarter' ? `${MONTHS[m]}${m === 0 || d === first ? ' ' + y : ''}` : [h('span', { class: 'm-long' }, MON[m]), h('span', { class: 'm-short' }, MONTHS[m][0])]));
    if (mode === 'quarter') {
      for (const day of [1, 8, 15, 22, 29]) {
        const date = ymd(y, m, day);
        if (day > daysInMonth(y, m) || date < d || date >= stop) continue;
        grid.append(h('div', { class: `cal-tick t${day}`, style: `grid-row:2;grid-column:${diffDays(first, date) + 2}`, 'aria-hidden': 'true' }, day));
      }
    }
    if (d > first) seps.push(c0);
    d = stop;
  }

  grid.append(h('div', { class: 'cal-hline', style: `grid-row:${head};grid-column:2 / -1`, 'aria-hidden': 'true' }));
  let row = head + 1;
  for (const u of units) {
    const { placed, count: L } = lanesFor(u.id, first, end);
    rows.push(`repeat(${L}, var(--lane))`);
    const span = `grid-row:${row} / span ${L}`;
    grid.append(unitCell(u, span), h('div', { class: 'cal-urow', style: `${span};grid-column:2 / -1` }));
    for (const { r, lane } of placed) {
      const s = r.check_in < first ? first : r.check_in;
      const e = r.check_out > end ? end : r.check_out;
      const src = SOURCES[r.source] || { mark: '??', label: r.source };
      const bar = h('button', {
        type: 'button',
        class: `cal-bar mini ${r.status}${r.check_in < first ? ' cl' : ''}${r.check_out > end ? ' cr' : ''}`,
        style: `grid-row:${row + lane};grid-column:${diffDays(first, s) + 2} / ${diffDays(first, e) + 2}`,
        'aria-label': barLabel(r, u),
      }, mode === 'quarter' ? [h('abbr', { class: 'src' }, src.mark), r.group_id ? icon('link', 'ic bar-link') : null,
        h('span', { class: 'name' }, r.guest_name || 'Unnamed')] : null);
      bar.addEventListener('pointerdown', (ev) => { lastPointer = ev.pointerType; });
      bar.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') showTip(bar, r, u, false); });
      bar.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && tip && !tip.pinned) hideTip(); });
      bar.addEventListener('click', () => {
        const touch = lastPointer === 'touch' || lastPointer === 'pen';
        lastPointer = '';
        if (touch && tip?.id !== r.id) { showTip(bar, r, u, true); return; }
        hideTip();
        openReservation(r);
      });
      grid.append(bar);
    }
    row += L;
  }
  for (const c of seps) grid.append(h('div', { class: 'cal-msep', style: `grid-row:1 / ${row};grid-column:${c}`, 'aria-hidden': 'true' }));
  if (today >= first && today < end) {
    grid.append(h('div', { class: 'cal-now', style: `grid-row:1 / ${row};grid-column:${diffDays(first, today) + 2}`, 'aria-hidden': 'true' }));
  }
  grid.style.gridTemplateRows = rows.join(' ');
  const wrap = h('div', { class: `cal-wrap ${mode}` }, grid);
  wrap.addEventListener('scroll', hideTip, { passive: true });
  root.append(wrap);
  if (!units.length) wrap.after(h('p', { class: 'empty' }, 'No units yet. Add them in the Units tab of the Sheet.'));
}

// Small label for bars in the compressed views. Mouse: shown while hovering. Touch: the first tap shows it, the label
// or a second tap on the bar opens the reservation.
function showTip(bar, r, u, pinned) {
  hideTip();
  const src = SOURCES[r.source] || { mark: '??', label: r.source };
  const el = h('button', { type: 'button', class: `cal-tip${pinned ? ' pinned' : ''}`, tabindex: pinned ? 0 : -1 },
    h('strong', null, r.guest_name || 'Unnamed', r.group_id ? icon('link', 'ic tiny') : null),
    h('span', null, `${fmtRange(r.check_in, r.check_out)} · ${plural(diffDays(r.check_in, r.check_out), 'night')} · ${u?.name || r.unit_id}`),
    h('span', null, `${STATUSES[r.status] || r.status} · ${src.label}${r.group_id ? ' · whole house' : ''}`),
    pinned ? h('span', { class: 'cal-tip-open' }, 'Open') : null);
  el.addEventListener('click', () => { hideTip(); openReservation(r); });
  document.body.append(el);
  const b = bar.getBoundingClientRect();
  const w = el.offsetWidth, ht = el.offsetHeight;
  el.style.left = `${Math.min(Math.max(8, b.left + b.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
  el.style.top = `${b.top - ht - 6 > 8 ? b.top - ht - 6 : b.bottom + 6}px`;
  tip = { el, id: r.id, pinned };
}
function hideTip() {
  if (tip) { tip.el.remove(); tip = null; }
}
document.addEventListener('pointerdown', (e) => {
  if (tip && !tip.el.contains(e.target) && !e.target.closest?.('.cal-bar.mini')) hideTip();
}, true);
window.addEventListener('hashchange', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

function legend(mode) {
  const bars = mode === 'season' || mode === 'year';
  return h('div', { class: 'legend', 'aria-hidden': 'true' },
    h('span', null, h('i', { class: 'sw confirmed' }), 'Confirmed'),
    h('span', null, h('i', { class: 'sw pending' }), 'Pending'),
    showCancelled ? h('span', null, h('i', { class: 'sw cancelled' }), 'Cancelled') : null,
    mode === 'month' ? h('span', null, icon('mail', 'ic legend-ic'), 'Request with email') : null,
    bars ? null : h('span', null, icon('link', 'ic legend-ic'), 'Whole house'),
    bars ? h('span', null, 'Hover or tap a bar for details.') : null,
    bars ? null : h('span', { class: 'legend-src' }, Object.values(SOURCES).map((s) => `${s.mark} ${s.label}`).join(' · ')));
}

// ---------- List ----------
function listView(rng, today) {
  // The period that contains today starts at today ("upcoming"); stays already under way are included.
  const start = today >= rng.first && today < rng.end ? today : rng.first;
  const items = [];
  const groups = new Map();
  for (const r of state.reservations) {
    if (!visible(r) || !(r.check_in < rng.end && r.check_out > start)) continue;
    if (r.group_id && groups.has(r.group_id)) { groups.get(r.group_id).members.push(r); continue; }
    const it = { r, members: [r] };
    if (r.group_id) groups.set(r.group_id, it);
    items.push(it);
  }
  for (const it of groups.values()) {
    const ordered = groupMembers(it.r).filter((x) => it.members.includes(x));
    if (ordered.length) { it.members = ordered; it.r = ordered[0]; }
  }
  items.sort((a, b) => byCheckIn(a.r, b.r));

  const box = h('div', { class: 'cal-list' });
  if (!items.length) {
    box.append(h('p', { class: 'empty' }, start === today ? 'No stays from today to the end of this period.' : 'No stays in this period.'));
    return box;
  }
  const byMonth = new Map();
  for (const it of items) {
    const k = (it.r.check_in < start ? start : it.r.check_in).slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(it);
  }
  for (const [k, list] of byMonth) {
    const hid = `cal-list-${k}`;
    box.append(h('section', { 'aria-labelledby': hid },
      h('h3', { id: hid, class: 'section-title' }, `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`, h('span', { class: 'count' }, ` · ${plural(list.length, 'stay')}`)),
      h('ul', { class: 'list' }, list.map((it) => listRow(it, today)))));
  }
  return box;
}

function listRow({ r, members }, today) {
  const u = unitById(r.unit_id);
  const src = SOURCES[r.source] || { mark: '??', label: r.source };
  const group = !!r.group_id;
  const where = group ? `Whole house · ${plural(members.length, 'apartment')}` : u?.name || r.unit_id;
  const guests = members.reduce((s, x) => s + (Number(x.guests) || 0), 0);
  const statuses = [...new Set(members.map((x) => x.status))];
  const status = statuses.length === 1 ? statuses[0] : '';
  const statusText = status ? STATUSES[status] || status : 'Mixed';
  const ongoing = r.check_in < today && r.check_out > today;
  return h('li', null, h('button', { type: 'button', class: 'list-row stay-row', onclick: () => openReservation(r),
    'aria-label': `${r.guest_name || 'Unnamed'}, ${where}, ${fmtRange(r.check_in, r.check_out)}, ${statusText}, ${src.label}` },
  h('span', { class: 'when' }, h('span', { class: 'range' }, fmtRange(r.check_in, r.check_out)),
    h('small', null, ongoing ? 'staying now' : plural(diffDays(r.check_in, r.check_out), 'night'))),
  h('span', { class: 'what' },
    h('span', { class: 'line1' },
      group ? icon('link', 'ic tiny') : h('span', { class: 'dot', style: `background:${u?.color || 'var(--sea)'}` }),
      h('span', { class: 'nm' }, r.guest_name || 'Unnamed')),
    h('span', { class: 'line2' }, `${where}${guests ? ' · ' + plural(guests, 'guest') : ''} · ${src.label}`)),
  h('span', { class: 'stay-tags' },
    h('span', { class: `badge ${status}` }, statusText),
    h('abbr', { class: 'src plain', title: src.label }, src.mark))));
}

// ---------- Next two weeks (under the timelines) ----------
function upcoming(today) {
  const horizon = addDays(today, 14);
  const items = [];
  for (const r of state.reservations) {
    if (r.status === 'cancelled' || r.source === 'block') continue;
    if (r.check_in >= today && r.check_in <= horizon) items.push({ date: r.check_in, kind: 'Arrives', r });
    if (r.check_out >= today && r.check_out <= horizon) items.push({ date: r.check_out, kind: 'Leaves', r });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'Leaves' ? -1 : 1));
  const sec = h('section', { class: 'upcoming', 'aria-labelledby': 'upc-h' }, h('h3', { id: 'upc-h', class: 'section-title' }, 'Next two weeks'));
  if (!items.length) { sec.append(h('p', { class: 'empty' }, 'No arrivals or departures.')); return sec; }
  sec.append(h('ul', { class: 'list' }, items.slice(0, 12).map(({ date, kind, r }) => {
    const u = unitById(r.unit_id);
    return h('li', null, h('button', { type: 'button', class: 'list-row', onclick: () => openReservation(r) },
      h('span', { class: 'when' }, date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : fmtDate(date, { weekday: true })),
      h('span', { class: 'what' },
        h('span', { class: 'line1' }, h('span', { class: 'dot', style: `background:${u?.color || 'var(--sea)'}` }), `${kind}: ${r.guest_name || 'Unnamed'}`),
        h('span', { class: 'line2' }, `${u?.name || r.unit_id} · ${fmtRange(r.check_in, r.check_out)}${r.guests ? ' · ' + plural(r.guests, 'guest') : ''}`)),
      r.status === 'pending' ? h('span', { class: 'badge pending' }, r.email ? icon('mail', 'ic tiny') : null, 'Pending') : null));
  })));
  return sec;
}
