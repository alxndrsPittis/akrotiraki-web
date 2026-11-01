// Totals: monthly table for a year, computed locally; server `totals` preferred when available.
import { state, currency, isOwner } from '../state.js';
import { h, icon } from '../ui.js';
import { computeTotals, activeUnitCount } from '../calc.js';
import { call } from '../api.js';
import { MON, money, fmtDate } from '../lib.js';

let year = null;
const server = new Map(); // year -> { version, data | null, pending }

function monthIndex(m) {
  if (typeof m === 'number') return m - 1;
  const s = String(m);
  if (/^\d{4}-\d{2}/.test(s)) return +s.slice(5, 7) - 1;
  const n = parseInt(s, 10);
  return isFinite(n) ? n - 1 : -1;
}
// Server numbers (also numeric strings); missing or unreadable fields keep the local figure.
const nums = (o) => Object.fromEntries(['nights', 'revenue', 'expenses']
  .filter((k) => o?.[k] !== '' && o?.[k] != null && isFinite(Number(o[k]))).map((k) => [k, Number(o[k])]));

function merge(local, srv) {
  if (!srv || !Array.isArray(srv.months) || !srv.months.length) return { ...local, source: 'local' };
  const months = local.months.map((m) => ({ ...m }));
  for (const sm of srv.months) {
    if (!sm || typeof sm !== 'object') continue;
    const i = monthIndex(sm.month);
    if (i >= 0 && i < 12) Object.assign(months[i], nums(sm));
  }
  return { months, season: { ...local.season, ...nums(srv.season) }, year: { ...local.year, ...nums(srv.year) }, source: 'server' };
}

function fetchServer(y, root) {
  const v = state.version;
  const entry = server.get(y);
  if (entry && (entry.version === v || entry.pending)) return;
  server.set(y, { version: v, data: entry?.data || null, pending: true });
  call('totals', { year: y }).then((data) => {
    server.set(y, { version: v, data, pending: false });
  }).catch(() => {
    server.set(y, { version: v, data: null, pending: false });
  }).finally(() => {
    if (root.isConnected && root.dataset.view === 'totals' && year === y) renderTotals(root);
  });
}

export function renderTotals(root) {
  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }
  const thisYear = new Date().getFullYear();
  year ??= thisYear;
  const years = new Set([thisYear, thisYear + 1, year]);
  state.reservations.forEach((r) => r.check_in && years.add(+r.check_in.slice(0, 4)));
  state.expenses.forEach((e) => e.date && years.add(+e.date.slice(0, 4)));
  const yearList = [...years].filter(Boolean).sort((a, b) => b - a);

  const local = computeTotals({ year, reservations: state.reservations, expenses: state.expenses, units: state.units, settings: state.settings });
  const entry = server.get(year);
  if (!state.offline) fetchServer(year, root);
  const t = merge(local, entry && entry.version === state.version ? entry.data : null);
  const cur = currency();
  const occ = (n, cap) => (cap && n ? `${Math.round((n / cap) * 100)}%` : '–');
  const m0 = (v) => (Math.round(v) ? money(Math.round(v), cur) : '–');
  const net = (r) => {
    const v = (r.revenue || 0) - (r.expenses || 0);
    return h('td', { class: `num${v < 0 ? ' neg' : ''}` }, Math.round(v) ? money(Math.round(v), cur) : '–');
  };
  const rowCells = (r) => [
    h('td', { class: 'num' }, r.nights || '–'),
    h('td', { class: 'num' }, occ(r.nights, r.capacity)),
    h('td', { class: 'num' }, m0(r.revenue)),
    h('td', { class: 'num' }, m0(r.expenses)),
    net(r),
  ];
  const nowMonth = new Date().getMonth();

  root.append(h('div', { class: 'totals-head' },
    h('label', { class: 'field compact' }, h('span', { class: 'field-label' }, 'Year'),
      h('select', { value: String(year), onchange: (e) => { year = +e.target.value; renderTotals(root); } },
        yearList.map((y) => h('option', { value: String(y) }, String(y))))),
    h('div', { class: 'head-links' },
      h('a', { class: 'btn sm ghost', href: '#stats' }, icon('stats'), 'Charts'),
      isOwner() ? h('a', { class: 'btn sm', href: '#prices' }, icon('tag'), 'Prices') : null)));

  const sLabel = ['Season', h('small', null, `${fmtDate(`${year}-${t.season.start}`, { year: false })} – ${fmtDate(`${year}-${t.season.end}`, { year: false })}`)];
  root.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, `Totals for ${year}`),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Month'), h('th', { scope: 'col', class: 'num' }, 'Nights'),
      h('th', { scope: 'col', class: 'num' }, h('abbr', { title: 'Occupancy' }, 'Occ.')),
      h('th', { scope: 'col', class: 'num' }, 'Revenue'), h('th', { scope: 'col', class: 'num' }, 'Expenses'),
      h('th', { scope: 'col', class: 'num' }, 'Net'))),
    h('tbody', null, t.months.map((mo, i) => h('tr', { class: year === thisYear && i === nowMonth ? 'current' : '' },
      h('th', { scope: 'row' }, MON[i]), rowCells(mo)))),
    h('tfoot', null,
      h('tr', { class: 'season' }, h('th', { scope: 'row' }, sLabel), rowCells(t.season)),
      h('tr', { class: 'year' }, h('th', { scope: 'row' }, String(year)), rowCells(t.year))))));

  // Cleaning fees are part of the price, so of revenue; shown as a secondary figure only (local data).
  if (Math.round(local.year.cleaning)) {
    root.append(h('p', { class: 'summary foot-note' }, 'Of which cleaning fees: ',
      h('strong', null, money(Math.round(local.year.cleaning), cur)), ` in ${year}`,
      Math.round(local.season.cleaning) ? [', ', h('strong', null, money(Math.round(local.season.cleaning), cur)), ' in the season'] : null, '.'));
  }
  // Extras (breakfast, transfers…) are part of the price, so of revenue: shown as a secondary figure only (local data).
  if (Math.round(local.year.extras)) {
    root.append(h('p', { class: 'summary foot-note' }, 'Of which extras: ',
      h('strong', null, money(Math.round(local.year.extras), cur)), ` in ${year}`,
      Math.round(local.season.extras) ? [', ', h('strong', null, money(Math.round(local.season.extras), cur)), ' in the season'] : null, '.'));
  }
  // Discounts are already deducted from the price, so from revenue: shown for reference only (local data).
  if (Math.round(local.year.discount)) {
    root.append(h('p', { class: 'summary foot-note' }, 'Discounts given: ',
      h('strong', null, money(Math.round(local.year.discount), cur)), ` in ${year}`,
      Math.round(local.season.discount) ? [', ', h('strong', null, money(Math.round(local.season.discount), cur)), ' in the season'] : null,
      ' (already deducted from revenue).'));
  }

  const units = activeUnitCount(state.units);
  root.append(h('p', { class: 'hint foot-note' },
    `Nights and occupancy count confirmed stays across ${units} active unit${units === 1 ? '' : 's'} (blocked dates excluded). ` +
    'Revenue is the price of confirmed stays by check-in month, cleaning fees and extras included, discounts deducted. ' +
    (t.source === 'server' ? 'Figures from the server.' : 'Computed on this device from loaded data (last ~13 months).')));
}
