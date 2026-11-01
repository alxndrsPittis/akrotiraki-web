// Statistics: KPIs and charts for a year, computed on the device from loaded data (same definitions as Totals).
// Charts are inline SVG drawn at the container's pixel width (ResizeObserver), with a hover/focus tooltip and a
// toggleable data table under each one. Colours come from CSS tokens (app.css "Charts").
import { state, currency, pendingCount } from '../state.js';
import { h, icon } from '../ui.js';
import { computeTotals, activeUnitCount } from '../calc.js';
import { MON, MONTHS, money, addDays, diffDays, num, plural, capitalize, fmtDate, SOURCES } from '../lib.js';

let year = null;
let openTables = new Set(); // data tables the user opened (kept across re-renders)

const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

// ---------- data ----------
function compute(Y) {
  const ys = String(Y);
  const t = computeTotals({ year: Y, reservations: state.reservations, expenses: state.expenses, units: state.units, settings: state.settings });
  const units = state.units.filter((u) => u.active === undefined || u.active === '' || u.active === true || /^true$|^1$/i.test(String(u.active)) ||
    state.reservations.some((r) => r.unit_id === u.id && r.status === 'confirmed' && r.check_in < `${Y + 1}` && r.check_out > ys));
  const unitNights = new Map(units.map((u) => [u.id, Array(12).fill(0)]));
  const pendingRev = Array(12).fill(0);
  const src = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, { count: 0, revenue: 0, nights: 0 }]));
  const stay = Array.from({ length: 12 }, () => ({ n: 0, sum: 0 }));
  const lead = Array.from({ length: 12 }, () => ({ n: 0, sum: 0 }));
  const yStart = `${ys}-01-01`, yEnd = `${Y + 1}-01-01`;

  for (const r of state.reservations) {
    if (!r.check_in || !r.check_out) continue;
    const m = +r.check_in.slice(5, 7) - 1;
    const inY = r.check_in.startsWith(ys);
    if (r.status === 'pending' && inY) pendingRev[m] += num(r.price);
    if (r.status !== 'confirmed') continue;
    const nights = diffDays(r.check_in, r.check_out);
    if (inY) {
      const s = src[r.source] || (src[r.source] = { count: 0, revenue: 0, nights: 0 });
      s.count++; s.revenue += num(r.price); s.nights += nights;
      if (r.source !== 'block') {
        stay[m].n++; stay[m].sum += nights;
        const created = String(r.created_at || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(created)) {
          const d = diffDays(created, r.check_in);
          if (d >= 0) { lead[m].n++; lead[m].sum += d; }
        }
      }
    }
    if (r.source === 'block' || !unitNights.has(r.unit_id)) continue;
    const arr = unitNights.get(r.unit_id);
    let d = r.check_in > yStart ? r.check_in : yStart;
    const end = r.check_out < yEnd ? r.check_out : yEnd;
    for (; d < end; d = addDays(d, 1)) arr[+d.slice(5, 7) - 1]++;
  }

  const cats = new Map();
  for (const e of state.expenses) {
    if (!e.date || !e.date.startsWith(ys)) continue;
    const c = (e.category || 'other').toLowerCase();
    cats.set(c, (cats.get(c) || 0) + num(e.amount));
  }

  const plan = { revenue: Array(12).fill(null), nights: Array(12).fill(null), expenses: Array(12).fill(null) };
  for (const p of Array.isArray(state.plan) ? state.plan : []) {
    const mo = String(p?.month || '');
    if (!mo.startsWith(`${ys}-`)) continue;
    const i = +mo.slice(5, 7) - 1;
    if (!(i >= 0 && i < 12)) continue;
    if (p.room_revenue !== '' && p.room_revenue != null && isFinite(Number(p.room_revenue))) plan.revenue[i] = Number(p.room_revenue);
    if (p.unit_nights !== '' && p.unit_nights != null && isFinite(Number(p.unit_nights))) plan.nights[i] = Number(p.unit_nights);
    if (p.expenses !== '' && p.expenses != null && isFinite(Number(p.expenses))) plan.expenses[i] = Number(p.expenses);
  }
  const hasPlan = (k) => plan[k].some((v) => v != null);

  const ss = t.season.start, se = t.season.end;
  const seasonMonth = (i) => {
    const a = `${ys}-${String(i + 1).padStart(2, '0')}-01`, b = `${ys}-${String(i + 1).padStart(2, '0')}-31`;
    return a <= `${ys}-${se}` && b >= `${ys}-${ss}`;
  };

  return { t, units, unitNights, pendingRev, src, stay, lead, cats, plan, hasPlan, seasonMonth };
}

// ---------- shared chart scaffolding ----------
function niceMax(v, steps = 4) {
  if (!(v > 0)) return { max: steps, step: 1 };
  const raw = v / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return { max: step * Math.ceil(v / step - 1e-9), step };
}
const compact = (v, cur) => {
  if (Math.abs(v) >= 10000) return `${cur === 'EUR' ? '€' : ''}${Math.round(v / 1000)}K`;
  if (Math.abs(v) >= 1000 && cur) return `${cur === 'EUR' ? '€' : ''}${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K`;
  return cur ? money(v, cur) : String(Math.round(v * 10) / 10);
};
/** Rounded-top bar (4px data end, square at the baseline). */
function barPath(x, y, w, hgt, r = 4) {
  if (hgt <= 0) return '';
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

/** A chart frame: draws `draw(svg, width)` at the container width and redraws on resize. */
function frame({ label, height, draw, tipFor, bandsOf }) {
  const tip = h('div', { class: 'chart-tip', hidden: true, role: 'presentation' });
  const box = h('div', { class: 'chart', style: `height:${height}px` });
  const wrap = h('div', { class: 'chart-wrap' }, box, tip);
  let geom = null;
  let hl = null;
  const render = () => {
    const w = Math.floor(box.clientWidth);
    if (!w) return;
    const svg = sv('svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': label, focusable: 'false' }, sv('title', {}, label));
    geom = draw(svg, w) || null;
    hl = sv('rect', { class: 'hl', x: 0, y: 0, width: 0, height: 0, rx: 4, visibility: 'hidden' });
    svg.prepend(hl);
    box.replaceChildren(svg);
  };
  let lastW = 0;
  const ro = new ResizeObserver(() => { if (!box.isConnected) { ro.disconnect(); return; } const w = Math.floor(box.clientWidth); if (w && w !== lastW) { lastW = w; render(); } });
  ro.observe(box);
  // Hover: highlight the band under the pointer and show its values.
  const show = (i) => {
    if (!geom || i == null || i < 0) { hide(); return; }
    const b = bandsOf(geom, i);
    if (!b) { hide(); return; }
    hl.setAttribute('x', b.x); hl.setAttribute('y', b.y); hl.setAttribute('width', b.w); hl.setAttribute('height', b.h);
    hl.setAttribute('visibility', 'visible');
    const lines = tipFor(i);
    tip.replaceChildren(...lines.map((l, k) => (k === 0 ? h('strong', null, l) : h('span', null, l))));
    tip.hidden = false;
    const bw = box.clientWidth;
    const tw = tip.offsetWidth;
    let left = b.x + b.w / 2 - tw / 2;
    left = Math.max(0, Math.min(bw - tw, left));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, b.tipY ?? b.y) }px`;
  };
  const hide = () => { tip.hidden = true; hl?.setAttribute('visibility', 'hidden'); };
  box.addEventListener('pointermove', (e) => {
    if (!geom) return;
    const r = box.getBoundingClientRect();
    show(geom.hit(e.clientX - r.left, e.clientY - r.top));
  });
  box.addEventListener('pointerleave', hide);
  return wrap;
}

/** Monthly chart: stacked bars (+ optional dashed/solid lines), shared month bands. */
function monthChart({ label, height = 220, stacks = [], lines = [], axis = (v) => String(v), topLabel = null, shade = null, tip }) {
  const draw = (svg, w) => {
    const narrow = w < 440;
    const m = { l: 44, r: 8, t: topLabel ? 20 : 10, b: 24 };
    const iw = w - m.l - m.r, ih = height - m.t - m.b;
    const bw = iw / 12;
    const totals = Array.from({ length: 12 }, (_, i) => stacks.reduce((s, st) => s + (st.values[i] || 0), 0));
    const lmax = Math.max(0, ...lines.flatMap((l) => l.values.filter((v) => v != null)));
    const { max, step } = niceMax(Math.max(...totals, lmax));
    const y = (v) => m.t + ih - (v / max) * ih;
    if (shade) {
      for (let i = 0; i < 12; i++) if (shade(i)) svg.append(sv('rect', { class: 'season', x: m.l + i * bw, y: m.t, width: bw, height: ih }));
    }
    for (let v = 0; v <= max + 1e-9; v += step) {
      svg.append(sv('line', { class: 'grid', x1: m.l, x2: w - m.r, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 }));
      svg.append(sv('text', { class: 'axis', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, axis(v)));
    }
    const barW = Math.min(24, bw * 0.64);
    for (let i = 0; i < 12; i++) {
      const x = m.l + i * bw + (bw - barW) / 2;
      let acc = 0;
      const segs = stacks.map((st) => ({ st, v: st.values[i] || 0 })).filter((s) => s.v > 0);
      segs.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + s.v);
        acc += s.v;
        const top = k === segs.length - 1;
        const hgt = Math.max(0, y0 - y1 - (top ? 0 : 2)); // 2px surface gap between stacked segments
        const yTop = top ? y1 : y1 + 2;
        svg.append(sv('path', { d: top ? barPath(x, yTop, barW, hgt) : `M${x},${yTop}h${barW}v${hgt}h${-barW}Z`, fill: `var(${s.st.color})`, class: s.st.cls || null }));
      });
      if (topLabel) {
        const t = topLabel(i);
        // Narrow bands: drop the % sign (the panel says the labels are %), smaller type, so neighbours never touch.
        if (t) svg.append(sv('text', { class: `val${narrow ? ' small' : ''}`, x: m.l + i * bw + bw / 2, y: y(totals[i]) - 5, 'text-anchor': 'middle' }, narrow ? t.replace('%', '') : t));
      }
      svg.append(sv('text', { class: 'axis', x: m.l + i * bw + bw / 2, y: height - 7, 'text-anchor': 'middle' }, narrow ? MON[i][0] : MON[i]));
    }
    svg.append(sv('line', { class: 'base', x1: m.l, x2: w - m.r, y1: m.t + ih + 0.5, y2: m.t + ih + 0.5 }));
    for (const l of lines) {
      const pts = l.values.map((v, i) => (v == null ? null : [m.l + i * bw + bw / 2, y(v)]));
      let d = '';
      let pen = false;
      pts.forEach((p) => { if (!p) { pen = false; return; } d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; pen = true; });
      if (d) svg.append(sv('path', { d, class: l.dash ? 'line dash' : 'line', stroke: `var(${l.color})` }));
      if (l.dots) pts.forEach((p) => p && svg.append(sv('circle', { class: 'dot', cx: p[0], cy: p[1], r: 4, fill: `var(${l.color})` })));
    }
    return {
      hit: (px) => { const i = Math.floor((px - m.l) / bw); return i >= 0 && i < 12 ? i : null; },
      band: (i) => ({ x: m.l + i * bw + 1, y: m.t, w: bw - 2, h: ih, tipY: m.t }),
    };
  };
  return frame({ label, height, draw, tipFor: tip, bandsOf: (g, i) => g.band(i) });
}

/** Horizontal bars, one series; value text at the bar end. */
function hbarChart({ label, rows, color = '--sea', valueText, tip }) {
  const rowH = 30;
  const height = Math.max(1, rows.length) * rowH + 8;
  const draw = (svg, w) => {
    const labW = Math.min(120, Math.max(84, w * 0.28));
    const valW = Math.min(150, w * 0.34);
    const iw = Math.max(20, w - labW - valW - 8);
    const max = Math.max(1, ...rows.map((r) => r.value));
    rows.forEach((r, i) => {
      const yy = 4 + i * rowH;
      const bl = r.value > 0 ? Math.max(3, (r.value / max) * iw) : 0;
      svg.append(sv('text', { class: 'axis lab', x: labW - 8, y: yy + rowH / 2 + 4, 'text-anchor': 'end' }, r.label));
      if (bl) {
        const bh = 16, by = yy + (rowH - bh) / 2;
        const rr = Math.min(4, bl / 2);
        svg.append(sv('path', { d: `M${labW},${by}H${labW + bl - rr}Q${labW + bl},${by} ${labW + bl},${by + rr}V${by + bh - rr}Q${labW + bl},${by + bh} ${labW + bl - rr},${by + bh}H${labW}Z`, fill: `var(${r.color || color})` }));
      }
      svg.append(sv('text', { class: 'val', x: labW + bl + 6, y: yy + rowH / 2 + 4 }, valueText(r)));
    });
    svg.append(sv('line', { class: 'base', x1: labW + 0.5, x2: labW + 0.5, y1: 2, y2: height - 2 }));
    return {
      hit: (px, py) => { const i = Math.floor((py - 4) / rowH); return i >= 0 && i < rows.length ? i : null; },
      band: (i) => ({ x: 0, y: 4 + i * rowH, w, h: rowH, tipY: 4 + (i + 1) * rowH }),
    };
  };
  return frame({ label, height, draw, tipFor: tip, bandsOf: (g, i) => g.band(i) });
}

function legend(items) {
  return h('div', { class: 'chart-legend' }, items.map((it) => h('span', null,
    h('i', { class: `key ${it.kind || 'box'}`, style: it.kind === 'dash' || it.kind === 'line' ? `border-color:var(${it.color})` : `background:var(${it.color})` }), it.label)));
}
function dataTable(id, caption, head, rows, foot) {
  const det = h('details', { class: 'chart-table', open: openTables.has(id) });
  det.addEventListener('toggle', () => { if (det.open) openTables.add(id); else openTables.delete(id); });
  det.append(h('summary', null, 'Data table'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('caption', { class: 'sr-only' }, caption),
      h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : null }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i ? h('td', { class: 'num' }, c) : h('th', { scope: 'row' }, c)))))),
      foot ? h('tfoot', null, h('tr', null, foot.map((c, i) => (i ? h('td', { class: 'num' }, c) : h('th', { scope: 'row' }, c))))) : null)));
  return det;
}
function panel(id, title, sub, ...body) {
  return h('section', { class: 'panel', 'aria-labelledby': `st-${id}` },
    h('div', { class: 'panel-head' }, h('h2', { id: `st-${id}` }, title), sub ? h('p', { class: 'hint' }, sub) : null),
    body);
}

// ---------- view ----------
export function renderStats(root) {
  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }
  const thisYear = new Date().getFullYear();
  year ??= thisYear;
  const cur = currency();
  const S = compute(year);
  const { t } = S;
  const m0 = (v) => money(Math.round(v), cur);
  const pct = (n, cap) => (cap ? Math.round((n / cap) * 100) : 0);
  const pending = pendingCount();

  // Header: year + sheet link
  const sheet = state.settings?.sheet_url;
  root.append(h('div', { class: 'totals-head stats-head' },
    h('label', { class: 'field compact' }, h('span', { class: 'field-label' }, 'Year'),
      h('select', { value: String(year), onchange: (e) => { year = +e.target.value; renderStats(root); } },
        [thisYear, thisYear - 1].map((y) => h('option', { value: String(y) }, String(y))))),
    /^https:\/\//.test(String(sheet || '')) ? h('a', { class: 'btn sm ghost sheet-link', href: sheet, target: '_blank', rel: 'noopener' }, icon('link'), 'Open the analysis in Google Sheets') : null));

  // KPI row
  const net = t.year.revenue - t.year.expenses;
  const planRev = S.hasPlan('revenue') ? S.plan.revenue.reduce((s, v) => s + (v || 0), 0) : null;
  const kpi = (label, value, sub, cls = '') => h('div', { class: `kpi ${cls}` }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), sub ? h('span', { class: 'kpi-sub' }, sub) : null);
  root.append(h('div', { class: 'kpis', role: 'list' },
    [kpi('Nights', String(t.year.nights), `${t.season.nights} in season`),
      kpi('Occupancy', `${pct(t.season.nights, t.season.capacity)}%`, `season · ${pct(t.year.nights, t.year.capacity)}% year`),
      kpi('Revenue', m0(t.year.revenue), planRev ? `plan ${m0(planRev)}` : 'confirmed'),
      kpi('Expenses', m0(t.year.expenses), `${plural(state.expenses.filter((e) => e.date?.startsWith(String(year))).length, 'entry', 'entries')}`),
      kpi('Net result', m0(net), 'revenue − expenses', net < 0 ? 'neg' : 'pos'),
      kpi('Pending requests', String(pending), pending ? h('a', { href: '#requests' }, 'Open requests') : 'none waiting')]
      .map((k) => { k.setAttribute('role', 'listitem'); return k; })));

  const grid = h('div', { class: 'stats-grid' });
  root.append(grid);

  // 1. Occupancy per month per apartment
  const unitColor = (i) => (i < 4 ? `--u${i + 1}` : '--muted');
  const stacks = S.units.map((u, i) => ({ label: u.name || u.id, color: unitColor(i), values: S.unitNights.get(u.id) }));
  const monthNights = (i) => stacks.reduce((s, st) => s + st.values[i], 0);
  const cap = (i) => t.months[i].capacity;
  const occLines = S.hasPlan('nights') ? [{ label: 'Plan', color: '--ink', dash: true, values: S.plan.nights }] : [];
  grid.append(panel('occ', 'Occupancy', `Confirmed nights per apartment; labels: occupancy % of ${activeUnitCount(state.units)} apartments' nights. Shaded: season.`,
    monthChart({
      label: `Nights per month per apartment in ${year}, with occupancy percentage`,
      stacks, lines: occLines,
      topLabel: (i) => (monthNights(i) ? `${pct(monthNights(i), cap(i))}%` : null),
      shade: S.seasonMonth,
      tip: (i) => [`${MONTHS[i]} · ${pct(monthNights(i), cap(i))}%`, ...stacks.map((s) => `${s.label}: ${plural(s.values[i], 'night')}`),
        ...(S.plan.nights[i] != null ? [`Plan: ${plural(S.plan.nights[i], 'night')}`] : [])],
    }),
    legend([...stacks.map((s) => ({ label: s.label, color: s.color })), { label: 'Season', color: '--season-key' },
      ...(occLines.length ? [{ label: 'Plan', color: '--ink', kind: 'dash' }] : [])]),
    dataTable('occ', `Occupancy ${year}`, ['Month', ...stacks.map((s) => s.label), 'Total', 'Occ.', ...(occLines.length ? ['Plan'] : [])],
      MON.map((mn, i) => [mn, ...stacks.map((s) => s.values[i] || '–'), monthNights(i) || '–', monthNights(i) ? `${pct(monthNights(i), cap(i))}%` : '–',
        ...(occLines.length ? [S.plan.nights[i] ?? '–'] : [])]),
      [String(year), ...stacks.map((s) => s.values.reduce((a, b) => a + b, 0)), t.year.nights, `${pct(t.year.nights, t.year.capacity)}%`,
        ...(occLines.length ? [S.plan.nights.reduce((a, b) => a + (b || 0), 0)] : [])])));

  // 2. Revenue per month vs plan
  const rev = t.months.map((mo) => mo.revenue);
  const revLines = S.hasPlan('revenue') ? [{ label: 'Plan', color: '--ink', dash: true, values: S.plan.revenue }] : [];
  const anyPending = S.pendingRev.some((v) => v > 0);
  grid.append(panel('rev', 'Revenue', 'Price of confirmed stays (net of discounts) by check-in month' + (revLines.length ? ', against the plan.' : '.'),
    monthChart({
      label: `Revenue per month in ${year}${revLines.length ? ' against the plan' : ''}`,
      stacks: [{ label: 'Confirmed', color: '--sea', values: rev }, { label: 'Pending', color: '--sand', values: S.pendingRev }],
      lines: revLines,
      axis: (v) => compact(v, cur),
      tip: (i) => [MONTHS[i], `Confirmed: ${m0(rev[i])}`, ...(S.pendingRev[i] ? [`Pending: ${m0(S.pendingRev[i])}`] : []),
        ...(S.plan.revenue[i] != null ? [`Plan: ${m0(S.plan.revenue[i])}`] : [])],
    }),
    legend([{ label: 'Confirmed', color: '--sea' }, ...(anyPending ? [{ label: 'Pending requests', color: '--sand' }] : []),
      ...(revLines.length ? [{ label: 'Plan', color: '--ink', kind: 'dash' }] : [])]),
    dataTable('rev', `Revenue ${year}`, ['Month', 'Confirmed', 'Pending', ...(revLines.length ? ['Plan', 'vs plan'] : [])],
      MON.map((mn, i) => [mn, rev[i] ? m0(rev[i]) : '–', S.pendingRev[i] ? m0(S.pendingRev[i]) : '–',
        ...(revLines.length ? [S.plan.revenue[i] != null ? m0(S.plan.revenue[i]) : '–',
          S.plan.revenue[i] ? `${Math.round((rev[i] / S.plan.revenue[i]) * 100)}%` : '–'] : [])]),
      [String(year), m0(t.year.revenue), m0(S.pendingRev.reduce((a, b) => a + b, 0)),
        ...(revLines.length ? [m0(planRev), planRev ? `${Math.round((t.year.revenue / planRev) * 100)}%` : '–'] : [])])));

  // 3. Bookings by source
  const srcRows = Object.entries(S.src).map(([k, v]) => ({ key: k, label: SOURCES[k]?.label || capitalize(k), value: v.count, ...v }));
  grid.append(panel('src', 'Bookings by source', `Confirmed stays arriving in ${year}.`,
    hbarChart({
      label: `Confirmed bookings by source in ${year}`,
      rows: srcRows,
      valueText: (r) => (r.count ? `${r.count} · ${r.revenue ? m0(r.revenue) : plural(r.nights, 'night')}` : '0'),
      tip: (i) => { const r = srcRows[i]; return [r.label, plural(r.count, 'stay'), plural(r.nights, 'night'), `Revenue ${m0(r.revenue)}`]; },
    }),
    dataTable('src', `Bookings by source ${year}`, ['Source', 'Stays', 'Nights', 'Revenue'],
      srcRows.map((r) => [r.label, r.count, r.nights, r.revenue ? m0(r.revenue) : '–']),
      ['Total', srcRows.reduce((s, r) => s + r.count, 0), srcRows.reduce((s, r) => s + r.nights, 0), m0(srcRows.reduce((s, r) => s + r.revenue, 0))])));

  // 4. Average stay and lead time
  const avg = (a) => a.map((x) => (x.n ? Math.round((x.sum / x.n) * 10) / 10 : null));
  const stayAvg = avg(S.stay), leadAvg = avg(S.lead);
  const tot = (a) => { const n = a.reduce((s, x) => s + x.n, 0); return n ? Math.round((a.reduce((s, x) => s + x.sum, 0) / n) * 10) / 10 : null; };
  grid.append(panel('stay', 'Length of stay and lead time', 'By check-in month, confirmed stays (blocks excluded). Lead time: days from booking to arrival.',
    h('h3', { class: 'mini-head' }, 'Average stay', h('span', { class: 'hint' }, tot(S.stay) != null ? ` · ${tot(S.stay)} nights over the year` : '')),
    monthChart({
      label: `Average nights per stay by month in ${year}`, height: 150,
      lines: [{ label: 'Average stay', color: '--sea', values: stayAvg, dots: true }],
      tip: (i) => [MONTHS[i], stayAvg[i] != null ? `${stayAvg[i]} nights average` : 'No stays', S.stay[i].n ? plural(S.stay[i].n, 'stay') : ''].filter(Boolean),
    }),
    h('h3', { class: 'mini-head' }, 'Average lead time', h('span', { class: 'hint' }, tot(S.lead) != null ? ` · ${tot(S.lead)} days over the year` : '')),
    monthChart({
      label: `Average days between booking and arrival by month in ${year}`, height: 150,
      lines: [{ label: 'Lead time', color: '--sea', values: leadAvg, dots: true }],
      tip: (i) => [MONTHS[i], leadAvg[i] != null ? `${leadAvg[i]} days average` : 'No data'],
    }),
    dataTable('stay', `Average stay and lead time ${year}`, ['Month', 'Stays', 'Avg nights', 'Avg lead (days)'],
      MON.map((mn, i) => [mn, S.stay[i].n || '–', stayAvg[i] ?? '–', leadAvg[i] ?? '–']),
      [String(year), S.stay.reduce((s, x) => s + x.n, 0), tot(S.stay) ?? '–', tot(S.lead) ?? '–'])));

  // 5. Expenses by category
  const catRows = [...S.cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ label: capitalize(c), value: v }));
  const planExp = S.hasPlan('expenses') ? S.plan.expenses.reduce((s, v) => s + (v || 0), 0) : null;
  grid.append(panel('exp', 'Expenses by category', `${m0(t.year.expenses)} in ${year}${planExp ? `, plan ${m0(planExp)}` : ''}; net result ${m0(net)}.`,
    catRows.length ? hbarChart({
      label: `Expenses by category in ${year}`,
      rows: catRows, color: '--chart-muted',
      valueText: (r) => m0(r.value),
      tip: (i) => [catRows[i].label, m0(catRows[i].value), `${Math.round((catRows[i].value / (t.year.expenses || 1)) * 100)}% of expenses`],
    }) : h('p', { class: 'empty' }, `No expenses in ${year}.`),
    catRows.length ? dataTable('exp', `Expenses by category ${year}`, ['Category', 'Amount', 'Share'],
      catRows.map((r) => [r.label, m0(r.value), `${Math.round((r.value / (t.year.expenses || 1)) * 100)}%`]),
      ['Total', m0(t.year.expenses), '100%']) : null));

  root.append(h('p', { class: 'hint foot-note' },
    'Computed on this device from loaded data (the last ~13 months), with the same definitions as Totals. ' +
    (S.hasPlan('revenue') || S.hasPlan('nights') ? 'Plan: the business plan from the Sheet. ' : '') +
    `Updated ${state.updatedAt ? fmtDate(state.updatedAt.slice(0, 10)) : '–'}.`));
}
