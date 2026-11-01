// Calendar: units × days timeline for one month.
import { state, activeUnits, unitById } from '../state.js';
import { h, icon } from '../ui.js';
import { todayISO, ymd, addDays, diffDays, daysInMonth, weekday, MONTHS, WD1, fmtRange, fmtDate,
  plural, fromWebsite, SOURCES, STATUSES, byCheckIn } from '../lib.js';
import { openReservation } from './reservation.js';

let cur = null;
let showCancelled = false;
let lastKey = null;

export function renderCalendar(root) {
  const today = todayISO();
  if (!cur) cur = { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 };
  const prevWrap = root.querySelector('.cal-wrap');
  const keepScroll = prevWrap ? prevWrap.scrollLeft : null;
  const key = `${cur.y}-${cur.m}`;
  const monthChanged = key !== lastKey;
  lastKey = key;

  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }

  const { y, m } = cur;
  const n = daysInMonth(y, m);
  const first = ymd(y, m, 1);
  const end = addDays(first, n); // exclusive
  const isThisMonth = today >= first && today < end;
  const rerender = () => renderCalendar(root);
  const shift = (d) => { const t = new Date(Date.UTC(y, m + d, 1)); cur = { y: t.getUTCFullYear(), m: t.getUTCMonth() }; rerender(); };

  const pending = state.reservations.filter((r) => r.status === 'pending').sort(byCheckIn);

  // Toolbar
  root.append(h('div', { class: 'cal-toolbar' },
    h('div', { class: 'month-nav' },
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left')),
      h('h2', { class: 'month-title', 'aria-live': 'polite' }, `${MONTHS[m]} ${y}`),
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('right')),
      h('button', { class: 'btn', type: 'button', disabled: isThisMonth, onclick: () => { cur = null; lastKey = null; rerender(); } }, 'Today')),
    h('div', { class: 'cal-actions' },
      h('a', { class: `btn chip ${pending.length ? 'pending' : ''}`, href: '#requests' }, `Pending (${pending.length})`),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', class: 'switch sm', role: 'switch', checked: showCancelled,
          onchange: (e) => { showCancelled = e.target.checked; rerender(); } }),
        'Show cancelled'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openReservation(isThisMonth ? {} : { check_in: first, check_out: addDays(first, 1) }) },
        icon('plus'), 'New'))));

  // Grid
  const units = activeUnits();
  const grid = h('div', { class: 'cal-grid' });
  grid.style.gridTemplateColumns = `var(--unit-col) repeat(${n}, minmax(var(--day-min), 1fr))`;
  grid.style.minWidth = `calc(var(--unit-col) + ${n} * var(--day-min))`;
  const rows = ['auto'];

  grid.append(h('div', { class: 'cal-corner', style: 'grid-row:1;grid-column:1' }, h('span', { class: 'sr-only' }, 'Unit')));
  for (let d = 1; d <= n; d++) {
    const date = ymd(y, m, d);
    const wd = weekday(date);
    grid.append(h('div', {
      class: `cal-day-h${wd === 0 || wd === 6 ? ' we' : ''}${date === today ? ' today' : ''}`,
      style: `grid-row:1;grid-column:${d + 1}`, 'aria-hidden': 'true',
    }, h('span', null, WD1[wd]), h('b', null, d)));
  }

  let row = 2;
  for (const u of units) {
    const list = state.reservations
      .filter((r) => r.unit_id === u.id && (showCancelled || r.status !== 'cancelled') && r.check_in < end && r.check_out > first)
      .sort((a, b) => (a.status === 'cancelled') - (b.status === 'cancelled') || a.check_in.localeCompare(b.check_in));
    // Greedy lane assignment so overlapping stays (pending vs confirmed, cancelled) stack instead of hiding each other.
    const lanes = [];
    const placed = list.map((r) => {
      let li = lanes.findIndex((lane) => lane.every((o) => !(r.check_in < o.check_out && o.check_in < r.check_out)));
      if (li < 0) { lanes.push([]); li = lanes.length - 1; }
      lanes[li].push(r);
      return { r, lane: li };
    });
    const L = Math.max(1, lanes.length);
    rows.push(`repeat(${L}, var(--lane))`);
    const span = `grid-row:${row} / span ${L}`;

    grid.append(h('div', { class: 'cal-unit', style: `${span};grid-column:1` },
      h('span', { class: 'dot', style: `background:${u.color || 'var(--sea)'}` }),
      h('span', { class: 'cal-unit-name' }, h('span', null, u.name), h('small', null, u.type))));

    for (let d = 1; d <= n; d++) {
      const date = ymd(y, m, d);
      const wd = weekday(date);
      grid.append(h('button', {
        type: 'button', tabindex: -1,
        class: `cal-cell${wd === 0 || wd === 6 ? ' we' : ''}${date === today ? ' today' : ''}`,
        style: `${span};grid-column:${d + 1}`,
        'aria-label': `New reservation, ${u.name}, ${fmtDate(date, { weekday: true })}`,
        onclick: () => openReservation({ unit_id: u.id, check_in: date, check_out: addDays(date, 1) }),
      }));
    }

    for (const { r, lane } of placed) {
      const s = r.check_in < first ? first : r.check_in;
      const e = r.check_out > end ? end : r.check_out;
      const c0 = diffDays(first, s) + 2;
      const c1 = diffDays(first, e) + 2;
      const src = SOURCES[r.source] || { mark: '??', label: r.source };
      const mail = r.status === 'pending' && !!r.email;
      const label = `${r.guest_name || 'Unnamed'}, ${u.name}, ${fmtRange(r.check_in, r.check_out)}, ${STATUSES[r.status] || r.status}, ${src.label}${mail ? `, ${fromWebsite(r) ? 'website request' : 'has email'}` : ''}`;
      grid.append(h('button', {
        type: 'button',
        class: `cal-bar ${r.status}${r.check_in < first ? ' cl' : ''}${r.check_out > end ? ' cr' : ''}`,
        style: `grid-row:${row + lane};grid-column:${c0} / ${c1}`,
        title: label, 'aria-label': label,
        onclick: () => openReservation(r),
      }, h('abbr', { class: 'src', title: src.label }, src.mark), mail ? icon('mail', 'ic bar-mail') : null, h('span', { class: 'name' }, r.guest_name || 'Unnamed')));
    }
    row += L;
  }
  grid.style.gridTemplateRows = rows.join(' ');

  const wrap = h('div', { class: 'cal-wrap' }, grid);
  root.append(wrap);
  if (!units.length) wrap.after(h('p', { class: 'empty' }, 'No units yet. Add them in the Units tab of the Sheet.'));

  root.append(h('div', { class: 'legend', 'aria-hidden': 'true' },
    h('span', null, h('i', { class: 'sw confirmed' }), 'Confirmed'),
    h('span', null, h('i', { class: 'sw pending' }), 'Pending'),
    h('span', null, icon('mail', 'ic legend-ic'), 'Request with email'),
    showCancelled ? h('span', null, h('i', { class: 'sw cancelled' }), 'Cancelled') : null,
    h('span', { class: 'legend-src' }, Object.values(SOURCES).map((s) => `${s.mark} ${s.label}`).join(' · '))));

  root.append(upcoming(today));

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
