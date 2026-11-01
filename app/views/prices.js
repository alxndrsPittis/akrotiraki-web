// Prices (owners): seasonal rates, cleaning fees, discount rules and extras (getPricing / savePrices /
// saveCleaningFees / saveDiscounts / saveExtras, API.md "Owner pricing actions"). Edits live in module drafts, so a
// background refresh never wipes them; each card saves on its own and is reloaded from the reply.
import { state, isOwner } from '../state.js';
import { h, icon, toast, confirmDialog, openDialog } from '../ui.js';
import { fmtDate, isISODate, money, num, todayISO, plural, capitalize, addDays, round2, EXTRA_CATEGORIES, EXTRA_KINDS, EXTRA_LANGS } from '../lib.js';
import * as actions from '../actions.js';

const KINDS = {
  long_stay: 'Long stay',
  early_booking: 'Early booking',
  last_minute: 'Last minute',
  period: 'Period',
  gap: 'Gap filler', // fields max_gap_nights, touching
};
/** One line under each kind. */
const KIND_HELP = {
  long_stay: 'For stays of at least the minimum number of nights.',
  early_booking: 'For stays booked at least this many days before arrival.',
  last_minute: 'For arrivals within this many days of the booking.',
  period: 'For the nights between From and To.',
  gap: 'For stays that fill a gap of up to this many nights between confirmed bookings (optionally: that touch a booking on one side).',
};

let data = null;        // last getPricing payload
let loading = null;     // in-flight promise
let loadError = '';
let fetchedAt = 0;
let keySeq = 0;
const key = () => `k${++keySeq}`;

// Drafts
let rates = [];         // {_k, target:'type:maisonette'|'unit:u1', from, to, price_per_night, min_nights, notes}
let rules = [];         // {_k, id, name, kind, percent, min_nights, days_before, max_gap_nights, touching, from, to, unit_type, unit_id, active, notes}
                        // kind is kept as sent, also when this app does not know it (it is saved back unchanged)
let fees = { maisonette: '', studio: '', per_unit: {} };
let extras = [];        // {_k, id, locked, name_en…name_de, category, kind, price, options, unit_type, unit_id, max_qty, active, sort, notes}
const dirty = { rates: false, fees: false, rules: false, extras: false };
const errors = { rates: null, fees: null, rules: null, extras: null }; // {row, field, message}
const CARDS = ['rates', 'fees', 'rules', 'extras'];
let yearFilter = null;  // 'all' | '2027'
let rootEl = null;

const str = (v) => (v == null ? '' : String(v));
const cur = () => data?.currency || state.settings?.currency || 'EUR';
const units = () => (data?.units?.length ? data.units : state.units);

function fromPayload(p) {
  data = p;
  rates = (p.prices || []).map((r) => ({
    _k: key(),
    target: r.unit_id ? `unit:${r.unit_id}` : `type:${String(r.unit_type || '').toLowerCase()}`,
    from: str(r.from), to: str(r.to), price_per_night: str(r.price_per_night),
    min_nights: Number(r.min_nights) ? String(r.min_nights) : '', notes: str(r.notes),
  }));
  rules = (p.discounts || []).map((d) => ({
    _k: key(), id: str(d.id), name: str(d.name), kind: str(d.kind).trim().toLowerCase() || 'long_stay', percent: str(d.percent),
    min_nights: str(d.min_nights), days_before: str(d.days_before),
    max_gap_nights: Number(d.max_gap_nights) ? str(d.max_gap_nights) : '', touching: d.touching === true || /^true$/i.test(str(d.touching)),
    from: str(d.from), to: str(d.to),
    unit_type: str(d.unit_type).toLowerCase(), unit_id: str(d.unit_id),
    active: d.active === true || /^true$/i.test(str(d.active)), notes: str(d.notes),
  }));
  const cf = p.cleaning_fees || {};
  fees = { maisonette: str(cf.maisonette ?? ''), studio: str(cf.studio ?? ''),
    per_unit: Object.fromEntries(Object.entries(cf.per_unit || {}).map(([k, v]) => [k, str(v)])) };
  extras = (p.extras || []).map((x) => ({
    _k: key(), id: str(x.id), locked: !!str(x.id),
    ...Object.fromEntries(EXTRA_LANGS.map((l) => [`name_${l}`, str(x[`name_${l}`])])),
    category: EXTRA_CATEGORIES[str(x.category).toLowerCase()] ? str(x.category).toLowerCase() : 'paid',
    kind: EXTRA_KINDS[str(x.kind).toLowerCase()] ? str(x.kind).toLowerCase() : 'per_stay',
    price: str(x.price), options: str(x.options), unit_type: str(x.unit_type).toLowerCase(), unit_id: str(x.unit_id),
    max_qty: str(x.max_qty), active: x.active === true || /^true$/i.test(str(x.active)), sort: str(x.sort), notes: str(x.notes),
  }));
  for (const c of CARDS) { dirty[c] = false; errors[c] = null; }
}

function load(force = false) {
  if (loading) return loading;
  if (!force && data && Date.now() - fetchedAt < 60000) return Promise.resolve();
  loading = actions.getPricing().then((p) => {
    // Unsaved drafts win over a background reload.
    if (!CARDS.some((c) => dirty[c])) fromPayload(p); else data = p;
    fetchedAt = Date.now();
    loadError = '';
  }).catch((e) => {
    loadError = e.code === 'network' ? 'Offline: prices can only be edited online.' : e.code === 'forbidden' ? 'forbidden' : (e.message || 'Could not load prices.');
  }).finally(() => {
    loading = null;
    if (rootEl?.isConnected && rootEl.dataset.view === 'prices') build(rootEl);
  });
  return loading;
}

export function renderPrices(root) {
  rootEl = root;
  // Re-render requests from state changes must not rebuild the editors (focus, half-typed values).
  if (root.querySelector(':scope > .prices.ready') && root.dataset.pricesUser === String(state.user?.email) && isOwner()) return;
  build(root);
  if (isOwner() && state.loaded && !state.offline) load();
}

function build(root) {
  try { buildView(root); } catch (e) {
    // Called from load()/saves outside the shell's renderView guard: show the error rather than a blank screen.
    console.error('Prices could not render', e);
    root.replaceChildren(h('div', { class: 'prices' }, h('p', { class: 'empty bad', role: 'alert' }, `Could not render: ${e?.message || e}`)));
  }
}
function buildView(root) {
  root.replaceChildren();
  root.dataset.pricesUser = String(state.user?.email);
  const wrap = h('div', { class: 'prices' });
  root.append(wrap);
  if (!state.loaded) { wrap.append(h('p', { class: 'empty' }, 'Loading…')); return; }
  if (!isOwner() || loadError === 'forbidden') {
    wrap.append(h('p', { class: 'info-note' }, 'Prices are managed by the owners.'),
      h('p', { class: 'hint' }, 'Quotes in the reservation form still use the current price list and discount rules.'));
    return;
  }
  if (!data) {
    wrap.append(h('p', { class: loadError ? 'empty bad' : 'empty' }, loadError || (state.offline ? 'Offline: prices can only be edited online.' : 'Loading prices…')),
      loadError ? h('p', { class: 'center' }, h('button', { class: 'btn', type: 'button', onclick: () => { loadError = ''; build(root); load(true); } }, icon('refresh'), 'Try again')) : null);
    return;
  }
  wrap.classList.add('ready');
  wrap.append(ratesCard(), feesCard(), rulesCard(), extrasCard());
}

const rebuild = () => rootEl && build(rootEl);

// ---------- shared bits ----------
function cellInput(row, field, props, card) {
  const err = errors[card];
  const bad = err && err.row === row.__i && err.field === field;
  const el = h('input', { ...props, value: str(row[field]), 'data-field': field, 'aria-invalid': bad ? 'true' : null });
  el.addEventListener('input', () => { row[field] = el.value; markDirty(card); });
  return el;
}
function cellSelect(row, field, options, props, card, onchange) {
  const err = errors[card];
  const bad = err && err.row === row.__i && err.field === field;
  const el = h('select', { ...props, value: str(row[field]), 'data-field': field, 'aria-invalid': bad ? 'true' : null },
    options.map(([v, l]) => h('option', { value: v }, l)));
  el.addEventListener('change', () => { row[field] = el.value; markDirty(card); onchange?.(); });
  return el;
}
function markDirty(card) {
  if (!dirty[card]) {
    dirty[card] = true;
    const st = rootEl?.querySelector(`[data-status="${card}"]`);
    if (st) { st.textContent = 'Unsaved changes'; st.classList.add('unsaved'); }
  }
}
const statusLine = (card) => h('span', { class: `save-status${dirty[card] ? ' unsaved' : ''}`, 'data-status': card, 'aria-live': 'polite' },
  dirty[card] ? 'Unsaved changes' : '');
const errorLine = (card) => (errors[card] ? h('p', { class: 'form-error', role: 'alert' }, errors[card].message) : null);
const fieldLabel = (text) => h('span', { class: 'cell-label' }, text);

function handleSaveError(card, e) {
  const count = card === 'rates' ? rates.length : card === 'rules' ? rules.length : extras.length;
  if (e.code === 'bad_request' && e.data && (Number.isInteger(e.data.row) || e.data.field)) {
    errors[card] = { row: Number.isInteger(e.data.row) ? e.data.row : -1, field: e.data.field || '', message: e.message || 'Check the highlighted field.' };
    if (card === 'rates' && errors.rates.row >= 0 && errors.rates.row < count) {
      const r = rates[errors.rates.row];
      if (r && yearFilter !== 'all' && !inYear(r, yearFilter)) yearFilter = 'all';
    }
    rebuild();
    const target = rootEl?.querySelector(`[data-card="${card}"] [aria-invalid="true"]`) || rootEl?.querySelector(`[data-card="${card}"] .form-error`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (target?.focus) target.focus({ preventScroll: true });
    toast(errors[card].message, 'error');
  } else {
    errors[card] = { row: -1, field: '', message: e.code === 'network' ? 'Offline: not saved. Try again when connected.' : (e.message || 'Could not save.') };
    rebuild();
    if (e.code !== 'unauthorized') actions.report(e);
  }
}

async function runSave(card, btn, fn, okMsg) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const p = await fn();
    // Keep the other cards' unsaved drafts; reload this card from the reply.
    const drafts = { rates, rules, fees, extras };
    const keepDirty = { ...dirty };
    fromPayload(p);
    fetchedAt = Date.now();
    for (const k of CARDS) {
      if (k === card || !keepDirty[k]) continue;
      if (k === 'rates') rates = drafts.rates; else if (k === 'rules') rules = drafts.rules; else if (k === 'fees') fees = drafts.fees; else extras = drafts.extras;
      dirty[k] = true;
    }
    rebuild();
    toast(okMsg(p));
  } catch (e) {
    handleSaveError(card, e);
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

// ---------- Card 1: seasonal rates ----------
const yearOf = (d) => (isISODate(d) ? d.slice(0, 4) : '');
const inYear = (r, y) => y === 'all' || yearOf(r.from) === y || yearOf(r.to) === y;
function shiftYear(d) {
  if (!isISODate(d)) return d;
  const y = +d.slice(0, 4) + 1;
  let md = d.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (md === '02-29' && !leap) md = '02-28';
  return `${y}-${md}`;
}
function targetOptions() {
  const types = [...new Set(['maisonette', 'studio', ...units().map((u) => String(u.type || '').toLowerCase()).filter(Boolean)])];
  return [
    ...types.map((t) => [`type:${t}`, `${capitalize(t)}s`]),
    ...units().map((u) => [`unit:${u.id}`, u.name || u.id]),
  ];
}
function defaultYear() {
  const t = todayISO();
  const se = /^\d{2}-\d{2}$/.test(state.settings?.season_end || '') ? state.settings.season_end : '10-31';
  return String(t.slice(5) <= se ? +t.slice(0, 4) : +t.slice(0, 4) + 1);
}

function ratesCard() {
  const years = [...new Set(rates.flatMap((r) => [yearOf(r.from), yearOf(r.to)]).filter(Boolean))].sort();
  if (yearFilter == null) yearFilter = years.includes(defaultYear()) ? defaultYear() : 'all';
  if (yearFilter !== 'all' && !years.includes(yearFilter)) yearFilter = 'all';
  rates.forEach((r, i) => { r.__i = i; });
  const shown = rates.filter((r) => inYear(r, yearFilter));
  const opts = targetOptions();

  const yearSel = h('select', { value: yearFilter, 'aria-label': 'Show year', onchange: (e) => { yearFilter = e.target.value; rebuild(); } },
    h('option', { value: 'all' }, 'All years'), years.map((y) => h('option', { value: y }, y)));
  const copyYear = yearFilter !== 'all' ? yearFilter : years[years.length - 1];
  const copyBtn = copyYear ? h('button', { class: 'btn sm', type: 'button' }, icon('copy'), `Copy ${copyYear} → ${+copyYear + 1}`) : null;
  copyBtn?.addEventListener('click', async () => {
    const src = rates.filter((r) => yearOf(r.from) === copyYear);
    if (!src.length) { toast(`No rows start in ${copyYear}.`, 'error'); return; }
    const next = String(+copyYear + 1);
    const existing = rates.filter((r) => yearOf(r.from) === next).length;
    if (existing && !(await confirmDialog(`${next} already has ${plural(existing, 'row')}. Add ${plural(src.length, 'copied row')} after them anyway? Later rows win where they overlap.`,
      { title: 'Copy year', ok: 'Copy anyway' }))) return;
    rates.push(...src.map((r) => ({ ...r, _k: key(), from: shiftYear(r.from), to: shiftYear(r.to) })));
    yearFilter = next;
    markDirty('rates');
    rebuild();
    toast(`Copied ${plural(src.length, 'row')} to ${next}. Check the dates, then save.`);
  });
  const adjBtn = rates.length ? h('button', { class: 'btn sm', type: 'button' }, icon('calc'), 'Adjust by %') : null;
  adjBtn?.addEventListener('click', () => adjustDialog());
  const sortBtn = h('button', { class: 'btn sm', type: 'button', title: 'Sort by start date; longer ranges first so short special weeks come after them' }, icon('sort'), 'Sort by date');
  sortBtn.addEventListener('click', () => {
    const len = (r) => (isISODate(r.from) && isISODate(r.to) ? r.to.localeCompare(r.from) : 0);
    rates = rates.map((r, i) => [r, i]).sort(([a, i], [b, j]) => (a.from || '9999').localeCompare(b.from || '9999') || (b.to || '').localeCompare(a.to || '') || len(b) - len(a) || i - j).map(([r]) => r);
    markDirty('rates');
    rebuild();
  });
  const addBtn = h('button', { class: 'btn sm', type: 'button' }, icon('plus'), 'Add row');
  addBtn.addEventListener('click', () => {
    const last = shown[shown.length - 1] || rates[rates.length - 1];
    const y = yearFilter !== 'all' ? yearFilter : defaultYear();
    rates.push({ _k: key(), target: last?.target || 'type:maisonette', from: `${y}-05-01`, to: `${y}-05-31`, price_per_night: '', min_nights: '', notes: '' });
    markDirty('rates');
    rebuild();
    rootEl.querySelector('[data-card="rates"] .rate-row:last-of-type [data-field="price_per_night"]')?.focus();
  });

  const rows = shown.map((r) => {
    const n = h('span', { class: 'row-no', 'aria-hidden': 'true' }, String(r.__i + 1));
    const label = `Row ${r.__i + 1}`;
    const dup = h('button', { class: 'btn ghost icon-btn sm', type: 'button', 'aria-label': `Duplicate ${label}`, title: 'Duplicate' }, icon('copy'));
    dup.addEventListener('click', () => { rates.splice(r.__i + 1, 0, { ...r, _k: key() }); markDirty('rates'); rebuild(); });
    const del = h('button', { class: 'btn ghost icon-btn sm danger', type: 'button', 'aria-label': `Delete ${label}`, title: 'Delete' }, icon('trash'));
    del.addEventListener('click', () => { rates.splice(r.__i, 1); markDirty('rates'); errors.rates = null; rebuild(); });
    return h('div', { class: `rate-row${errors.rates?.row === r.__i ? ' has-error' : ''}`, role: 'group', 'aria-label': label },
      n,
      h('label', { class: 'cell c-target' }, fieldLabel('Applies to'), cellSelect(r, 'target', opts, { 'aria-label': `${label}: applies to` }, 'rates')),
      h('label', { class: 'cell c-from' }, fieldLabel('From'), cellInput(r, 'from', { type: 'date', 'aria-label': `${label}: from` }, 'rates')),
      h('label', { class: 'cell c-to' }, fieldLabel('To'), cellInput(r, 'to', { type: 'date', 'aria-label': `${label}: to` }, 'rates')),
      h('label', { class: 'cell c-price' }, fieldLabel(`Per night (${cur()})`), cellInput(r, 'price_per_night', { type: 'text', inputmode: 'decimal', 'aria-label': `${label}: price per night`, autocomplete: 'off' }, 'rates')),
      h('label', { class: 'cell c-min' }, fieldLabel('Min nights'), cellInput(r, 'min_nights', { type: 'text', inputmode: 'numeric', placeholder: '–', 'aria-label': `${label}: minimum nights`, autocomplete: 'off' }, 'rates')),
      h('label', { class: 'cell c-notes' }, fieldLabel('Notes'), cellInput(r, 'notes', { type: 'text', maxlength: 500, 'aria-label': `${label}: notes`, autocomplete: 'off' }, 'rates')),
      h('div', { class: 'cell c-act' }, dup, del));
  });

  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save rates');
  saveBtn.addEventListener('click', () => runSave('rates', saveBtn, () => actions.savePrices(rates.map((r) => {
    const [kind, id] = r.target.split(':');
    const u = kind === 'unit' ? units().find((x) => x.id === id) : null;
    return {
      unit_type: kind === 'type' ? id : String(u?.type || ''), unit_id: kind === 'unit' ? id : '',
      from: r.from, to: r.to, price_per_night: r.price_per_night === '' ? '' : num(r.price_per_night),
      min_nights: r.min_nights === '' ? '' : Number(String(r.min_nights).trim()), notes: r.notes.trim(),
    };
  })), (p) => `Rates saved (${plural((p.prices || []).length, 'row')}).`));

  return h('section', { class: 'card', 'data-card': 'rates', 'aria-labelledby': 'pr-rates' },
    h('div', { class: 'card-head' }, h('h2', { id: 'pr-rates' }, 'Seasonal rates'),
      h('label', { class: 'field compact year-pick' }, h('span', { class: 'sr-only' }, 'Year'), yearSel)),
    h('p', { class: 'hint' }, 'Nightly price per type or per apartment; From and To are both included. A row for one apartment beats a type row; otherwise the lower row wins where rows overlap.'),
    h('div', { class: 'card-tools' }, addBtn, sortBtn, copyBtn, adjBtn),
    shown.length ? h('div', { class: 'rate-table' },
      h('div', { class: 'rate-row rate-headrow', 'aria-hidden': 'true' },
        h('span', { class: 'row-no' }, '#'), h('span', null, 'Applies to'), h('span', null, 'From'), h('span', null, 'To'),
        h('span', { class: 'num' }, `Per night`), h('span', { class: 'num' }, 'Min'), h('span', null, 'Notes'), h('span')),
      rows)
      : h('p', { class: 'empty' }, rates.length ? 'No rows for this year.' : 'No rates yet. Add a row.'),
    yearFilter !== 'all' && rates.length > shown.length ? h('p', { class: 'hint' }, `${plural(rates.length - shown.length, 'row')} in other years not shown.`) : null,
    errorLine('rates'),
    h('div', { class: 'card-foot' },
      h('p', { class: 'hint warn-hint' }, icon('warn', 'ic tiny'), ' Saving replaces the whole Prices tab in the Sheet with these rows.'),
      statusLine('rates'), saveBtn));
}

/** "Adjust all rates by ±%": preview of every changed row, then the drafts are updated (Save rates writes them). */
function adjustDialog() {
  const opts = Object.fromEntries(targetOptions());
  const scoped = yearFilter !== 'all';
  const pct = h('input', { type: 'text', inputmode: 'text', autocomplete: 'off', placeholder: 'e.g. 5 or -10', 'aria-describedby': 'adj-help' });
  const scope = scoped ? h('select', null,
    h('option', { value: 'shown' }, `Rows of ${yearFilter} (${rates.filter((r) => inYear(r, yearFilter)).length})`),
    h('option', { value: 'all' }, `All rows (${rates.length})`)) : null;
  const roundBox = h('input', { type: 'checkbox', class: 'switch sm', role: 'switch', checked: true, id: 'adj-round' });
  const preview = h('div', { class: 'adj-preview', 'aria-live': 'polite' });
  const applyBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Apply');
  const backBtn = h('button', { class: 'btn', type: 'button' }, 'Back');
  const parse = () => {
    const t = pct.value.trim().replace(',', '.').replace(/%$/, '').replace(/^\+/, '');
    const p = t === '' ? NaN : Number(t);
    return isFinite(p) && p !== 0 && p > -100 && p <= 200 ? p : null;
  };
  const newPrice = (v, p) => {
    const x = num(v) * (1 + p / 100);
    return roundBox.checked ? Math.max(1, Math.round(x)) : Math.max(0.01, round2(x));
  };
  const rowsInScope = () => rates.filter((r) => (!scope || scope.value === 'all' || inYear(r, yearFilter)) && num(r.price_per_night) > 0);
  const draw = () => {
    const p = parse();
    preview.replaceChildren();
    applyBtn.disabled = p == null;
    if (p == null) {
      preview.append(h('p', { class: 'hint' }, pct.value.trim() ? 'Enter a percent between −99 and 200, not 0.' : 'Enter a percent to see the new prices.'));
      return;
    }
    const list = rowsInScope();
    applyBtn.textContent = `Apply to ${plural(list.length, 'row')}`;
    preview.append(h('table', { class: 'table compact adj-table' },
      h('thead', null, h('tr', null, h('th', null, 'Applies to'), h('th', null, 'Dates'), h('th', { class: 'num' }, 'Now'), h('th', { class: 'num' }, 'New'))),
      h('tbody', null, list.map((r) => h('tr', null,
        h('td', null, opts[r.target] || r.target),
        h('td', null, isISODate(r.from) && isISODate(r.to) ? `${fmtDate(r.from, { year: true })} – ${fmtDate(r.to, { year: true })}` : '–'),
        h('td', { class: 'num' }, money(num(r.price_per_night), cur())),
        h('td', { class: 'num strong' }, money(newPrice(r.price_per_night, p), cur())))))));
  };
  [pct, scope, roundBox].forEach((el) => el?.addEventListener(el === pct ? 'input' : 'change', draw));
  const dlg = openDialog({
    title: 'Adjust rates',
    body: h('div', { class: 'form' },
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Change (%)'), pct),
        scope ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Rows'), scope) : h('div')),
      h('p', { id: 'adj-help', class: 'hint' }, 'Positive raises the prices, negative lowers them. Rows without a price are left as they are.'),
      h('div', { class: 'switch-row' }, h('label', { for: 'adj-round' }, 'Round to whole euros'), roundBox),
      preview),
    foot: [backBtn, applyBtn],
  });
  backBtn.addEventListener('click', () => dlg.close());
  applyBtn.addEventListener('click', () => {
    const p = parse();
    if (p == null) return;
    const list = rowsInScope();
    for (const r of list) r.price_per_night = String(newPrice(r.price_per_night, p));
    markDirty('rates');
    dlg.close();
    rebuild();
    toast(`${plural(list.length, 'rate')} changed by ${p > 0 ? '+' : ''}${p}%. Check them, then Save rates.`);
  });
  draw();
  pct.focus();
}

// ---------- Card 2: cleaning fees ----------
function feesCard() {
  const err = errors.fees;
  const inp = (val, field, label, onInput, placeholder = '') => {
    const el = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: val, placeholder,
      'data-field': field, 'aria-invalid': err?.field === field ? 'true' : null });
    el.addEventListener('input', () => { onInput(el.value); markDirty('fees'); });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el);
  };
  const typeFee = (t) => (t === 'studio' ? fees.studio : fees.maisonette);
  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save fees');
  saveBtn.addEventListener('click', () => runSave('fees', saveBtn, () => {
    const per_unit = {};
    for (const u of units()) {
      const v = str(fees.per_unit[u.id]).trim();
      per_unit[u.id] = v === '' ? '' : num(v);
    }
    return actions.saveCleaningFees({
      maisonette: fees.maisonette.trim() === '' ? '' : num(fees.maisonette), studio: fees.studio.trim() === '' ? '' : num(fees.studio), per_unit,
    });
  }, () => 'Cleaning fees saved.'));
  return h('section', { class: 'card', 'data-card': 'fees', 'aria-labelledby': 'pr-fees' },
    h('div', { class: 'card-head' }, h('h2', { id: 'pr-fees' }, 'Cleaning fees')),
    h('p', { class: 'hint' }, `Added once per stay to the quote (${cur()}).`),
    h('div', { class: 'row2' },
      inp(fees.maisonette, 'maisonette', 'Maisonette', (v) => { fees.maisonette = v; }),
      inp(fees.studio, 'studio', 'Studio', (v) => { fees.studio = v; })),
    h('h3', { class: 'sub-head' }, 'Per apartment (optional)'),
    h('p', { class: 'hint' }, 'Leave empty to use the type fee.'),
    h('div', { class: 'fee-grid' }, units().map((u) => inp(str(fees.per_unit[u.id] ?? ''), `per_unit.${u.id}`, `${u.name || u.id}`,
      (v) => { fees.per_unit[u.id] = v; }, typeFee(String(u.type).toLowerCase()) ? `${money(num(typeFee(String(u.type).toLowerCase())), cur())} (type)` : 'type fee'))),
    errorLine('fees'),
    h('div', { class: 'card-foot' }, statusLine('fees'), saveBtn));
}

// ---------- Card 3: discount rules ----------
const unitNameOf = (id) => units().find((u) => u.id === id)?.name || id;
function rulePreview(d) {
  const p = num(d.percent);
  if (!(p > 0 && p <= 100)) return 'Set a percent between 0 and 100.';
  const range = isISODate(d.from) && isISODate(d.to) ? `${fmtDate(d.from, { year: true })} – ${fmtDate(d.to, { year: true })}` : '';
  let s;
  if (d.kind === 'long_stay') s = num(d.min_nights) >= 1 ? `${p}% off for stays of ${num(d.min_nights)}+ nights` : `${p}% off long stays (set the minimum nights)`;
  else if (d.kind === 'early_booking') s = str(d.days_before).trim() !== '' ? `${p}% off when booked at least ${num(d.days_before)} days before arrival` : `${p}% off early bookings (set the days before)`;
  else if (d.kind === 'last_minute') s = str(d.days_before).trim() !== '' ? `${p}% off when booked within ${num(d.days_before)} days of arrival` : `${p}% off last-minute bookings (set the days)`;
  else if (d.kind === 'gap') s = num(d.max_gap_nights) >= 1
    ? `${p}% off for stays that fill a gap of up to ${plural(num(d.max_gap_nights), 'night')} between bookings${d.touching ? ', or touch a booking on one side' : ''}`
    : `${p}% off for stays that fill a gap between bookings (set the max gap)`;
  else if (!KINDS[d.kind]) s = `${p}% off, kind "${d.kind}" (not known to this app; it is saved unchanged)`;
  else s = range ? `${p}% off nights ${range}` : `${p}% off a period (set From and To)`;
  if (range && d.kind !== 'period') s += `, nights ${range} only`;
  if (d.unit_id) s += `, ${unitNameOf(d.unit_id)} only`;
  else if (d.unit_type) s += `, ${d.unit_type}s only`;
  return `${s}.${d.active ? '' : ' Off: not applied to quotes.'}`;
}

function rulesCard() {
  rules.forEach((d, i) => { d.__i = i; });
  const typeOpts = [['', 'Any type'], ...[...new Set(units().map((u) => String(u.type || '').toLowerCase()).filter(Boolean))].map((t) => [t, `${capitalize(t)}s`])];
  const unitOpts = [['', 'Any apartment'], ...units().map((u) => [u.id, u.name || u.id])];
  const addBtn = h('button', { class: 'btn sm', type: 'button' }, icon('plus'), 'Add rule');
  addBtn.addEventListener('click', () => {
    rules.push({ _k: key(), id: '', name: '', kind: 'long_stay', percent: '10', min_nights: '7', days_before: '', max_gap_nights: '', touching: false, from: '', to: '', unit_type: '', unit_id: '', active: true, notes: '' });
    markDirty('rules');
    rebuild();
    rootEl.querySelector('[data-card="rules"] .rule:last-of-type [data-field="name"]')?.focus();
  });

  const list = rules.map((d) => {
    const label = d.name ? `Rule ${d.name}` : `Rule ${d.__i + 1}`;
    const preview = h('p', { class: 'rule-preview', 'aria-live': 'polite' }, rulePreview(d));
    const box = h('article', { class: `rule${d.active ? '' : ' off'}${errors.rules?.row === d.__i ? ' has-error' : ''}`, 'aria-label': label });
    const refresh = () => {
      preview.textContent = rulePreview(d);
      box.classList.toggle('off', !d.active);
      box.querySelectorAll('[data-kinds]').forEach((el) => { el.hidden = !el.dataset.kinds.split(' ').includes(d.kind); });
      const fl = box.querySelector('.range-label');
      if (fl) fl.textContent = d.kind === 'period' ? 'Dates (required)' : 'Only for nights between (optional)';
      kindHelp.textContent = KIND_HELP[d.kind] || '';
    };
    const kindHelp = h('p', { class: 'hint kind-help' }, KIND_HELP[d.kind] || '');
    box.addEventListener('input', refresh);
    box.addEventListener('change', refresh);
    const act = h('input', { type: 'checkbox', class: 'switch sm', role: 'switch', checked: d.active, 'aria-label': `${label}: active`, 'data-field': 'active' });
    act.addEventListener('change', () => { d.active = act.checked; markDirty('rules'); });
    const dup = h('button', { class: 'btn ghost icon-btn sm', type: 'button', 'aria-label': `Duplicate ${label}`, title: 'Duplicate' }, icon('copy'));
    dup.addEventListener('click', () => { rules.splice(d.__i + 1, 0, { ...d, _k: key(), id: '', name: d.name ? `${d.name} (copy)` : '' }); markDirty('rules'); rebuild(); });
    const del = h('button', { class: 'btn ghost icon-btn sm danger', type: 'button', 'aria-label': `Delete ${label}`, title: 'Delete' }, icon('trash'));
    del.addEventListener('click', () => { rules.splice(d.__i, 1); markDirty('rules'); errors.rules = null; rebuild(); });
    const f = (lbl, el, cls = '', kinds = null) => h('label', { class: `cell ${cls}`, 'data-kinds': kinds, hidden: kinds && !kinds.split(' ').includes(d.kind) }, fieldLabel(lbl), el);
    box.append(
      h('div', { class: 'rule-head' },
        cellInput(d, 'name', { type: 'text', maxlength: 100, placeholder: 'Rule name', class: 'rule-name', 'aria-label': `${label}: name`, autocomplete: 'off' }, 'rules'),
        h('label', { class: 'toggle' }, act, 'Active'), dup, del),
      preview,
      kindHelp,
      h('div', { class: 'rule-grid' },
        f('Kind', cellSelect(d, 'kind', [...Object.entries(KINDS), ...(KINDS[d.kind] ? [] : [[d.kind, `Other: ${d.kind}`]])], { 'aria-label': `${label}: kind` }, 'rules')),
        f('Percent', cellInput(d, 'percent', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${label}: percent` }, 'rules')),
        f('Min nights', cellInput(d, 'min_nights', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${label}: minimum nights` }, 'rules'), '', 'long_stay'),
        f('Days before arrival', cellInput(d, 'days_before', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${label}: days before arrival` }, 'rules'), '', 'early_booking last_minute'),
        f('Max gap (nights)', cellInput(d, 'max_gap_nights', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${label}: max gap nights` }, 'rules'), '', 'gap'),
        h('label', { class: 'cell toggle-cell', 'data-kinds': 'gap', hidden: d.kind !== 'gap' }, fieldLabel('Touching one side'),
          (() => {
            const t = h('input', { type: 'checkbox', class: 'switch sm', role: 'switch', checked: !!d.touching, 'data-field': 'touching', 'aria-label': `${label}: also when touching a booking on one side` });
            t.addEventListener('change', () => { d.touching = t.checked; markDirty('rules'); });
            return t;
          })()),
        f('Unit type', cellSelect(d, 'unit_type', typeOpts, { 'aria-label': `${label}: unit type` }, 'rules')),
        f('Apartment', cellSelect(d, 'unit_id', unitOpts, { 'aria-label': `${label}: apartment` }, 'rules'))),
      h('fieldset', { class: 'rule-range' },
        h('legend', { class: 'cell-label range-label' }, d.kind === 'period' ? 'Dates (required)' : 'Only for nights between (optional)'),
        h('div', { class: 'row2' },
          cellInput(d, 'from', { type: 'date', 'aria-label': `${label}: from` }, 'rules'),
          cellInput(d, 'to', { type: 'date', 'aria-label': `${label}: to` }, 'rules'))),
      h('label', { class: 'cell' }, fieldLabel('Notes'), cellInput(d, 'notes', { type: 'text', maxlength: 500, autocomplete: 'off', 'aria-label': `${label}: notes` }, 'rules')));
    return box;
  });

  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save rules');
  saveBtn.addEventListener('click', () => saveRules(saveBtn));
  const lmBtn = h('button', { class: 'btn sm', type: 'button' }, icon('tag'), 'Last-minute discount');
  lmBtn.addEventListener('click', () => lastMinuteDialog());

  return h('section', { class: 'card', 'data-card': 'rules', 'aria-labelledby': 'pr-rules' },
    h('div', { class: 'card-head' }, h('h2', { id: 'pr-rules' }, 'Discount rules')),
    h('p', { class: 'hint' }, 'Applied to the accommodation only (never the cleaning fee). When several rules fit a stay, the one giving the biggest discount wins; rules never stack.'),
    h('div', { class: 'card-tools' }, addBtn, lmBtn),
    list.length ? h('div', { class: 'rule-list' }, list) : h('p', { class: 'empty' }, 'No discount rules.'),
    errorLine('rules'),
    h('div', { class: 'card-foot' },
      h('p', { class: 'hint warn-hint' }, icon('warn', 'ic tiny'), ' Saving replaces the whole Discounts tab in the Sheet.'),
      statusLine('rules'), saveBtn));
}

function saveRules(btn) {
  return runSave('rules', btn, () => actions.saveDiscounts(rules.map((d) => {
    const whole = (v) => (str(v).trim() === '' ? '' : Number(str(v).trim()));
    const days = d.kind === 'early_booking' || d.kind === 'last_minute';
    return {
      ...(d.id ? { id: d.id } : {}), name: d.name.trim(), kind: d.kind, percent: str(d.percent).trim() === '' ? '' : num(d.percent),
      min_nights: d.kind === 'long_stay' ? whole(d.min_nights) : '', days_before: days ? whole(d.days_before) : '',
      max_gap_nights: d.kind === 'gap' ? whole(d.max_gap_nights) : '', touching: d.kind === 'gap' ? !!d.touching : false,
      from: d.from || '', to: d.to || '', unit_type: d.unit_type || '', unit_id: d.unit_id || '', active: !!d.active, notes: d.notes.trim(),
    };
  })), (p) => `Discount rules saved (${plural((p.discounts || []).filter((x) => x.active === true || /^true$/i.test(String(x.active))).length, 'active rule')}).`);
}

/** Quick action: X% for arrivals within N days, until a date. Updates the first last-minute rule (or adds one),
 *  turns it on and saves. "Until" is the rule's To (From = today): only nights up to that date are discounted. */
function lastMinuteDialog() {
  const t = todayISO();
  const ex = rules.find((d) => d.kind === 'last_minute');
  const pct = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: ex ? ex.percent : '15' });
  const days = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', value: ex?.days_before || '7' });
  const until = h('input', { type: 'date', min: t, value: ex && isISODate(ex.to) && ex.to >= t ? ex.to : addDays(t, 30) });
  const out = h('p', { class: 'rule-preview', 'aria-live': 'polite' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const okBtn = h('button', { class: 'btn primary', type: 'button' }, ex ? (ex.active ? 'Save' : 'Turn on and save') : 'Add and save');
  const backBtn = h('button', { class: 'btn', type: 'button' }, 'Back');
  const read = () => ({ p: num(pct.value), n: str(days.value).trim(), u: until.value });
  const check = ({ p, n, u }) => (!(p > 0 && p <= 100) ? 'Percent must be more than 0 and at most 100.'
    : !/^\d+$/.test(n) ? 'Days must be a whole number.' : !isISODate(u) || u < t ? 'Until must be today or later.' : '');
  const draw = () => {
    const v = read();
    const msg = check(v);
    out.textContent = msg || `${v.p}% off the accommodation for arrivals within ${plural(Number(v.n), 'day')}, for nights up to ${fmtDate(v.u, { year: true })}.`;
    out.classList.toggle('bad', !!msg);
  };
  [pct, days, until].forEach((el) => el.addEventListener('input', draw));
  const dirtyOther = dirty.rules;
  const dlg = openDialog({
    title: 'Last-minute discount',
    body: h('div', { class: 'form' },
      h('div', { class: 'row3' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Percent'), pct),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Days before arrival'), days),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Until'), until)),
      out,
      h('p', { class: 'hint' }, ex ? `Updates the rule "${ex.name || 'Last minute'}".` : 'Adds a rule named "Last minute".',
        ' Applied to the accommodation only; when several rules fit a stay, the biggest discount wins.'),
      dirtyOther ? h('p', { class: 'hint warn-hint' }, icon('warn', 'ic tiny'), ' Your other unsaved rule changes are saved too.') : null,
      err),
    foot: [backBtn, okBtn],
  });
  backBtn.addEventListener('click', () => dlg.close());
  okBtn.addEventListener('click', async () => {
    const v = read();
    const msg = check(v);
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    let d = rules.find((x) => x.kind === 'last_minute');
    if (!d) {
      d = { _k: key(), id: '', name: 'Last minute', kind: 'last_minute', percent: '', min_nights: '', days_before: '', max_gap_nights: '', touching: false,
        from: '', to: '', unit_type: '', unit_id: '', active: true, notes: '' };
      rules.push(d);
    }
    Object.assign(d, { percent: String(v.p), days_before: v.n, from: t, to: v.u, active: true });
    markDirty('rules');
    await saveRules(okBtn);
    if (!dirty.rules) dlg.close(); else { err.textContent = errors.rules?.message || 'Not saved.'; err.hidden = false; }
  });
  draw();
  pct.focus();
}

// ---------- Card 4: extras ----------
const LANG_LABEL = { en: 'EN', el: 'EL', fr: 'FR', es: 'ES', de: 'DE' };
/** Options text → {list:[{label, price}], error} with the backend's strict rules (saveExtras). */
function parseOptionsStrict(text) {
  const list = [];
  for (const part of str(text).split(';')) {
    if (!part.trim()) continue;
    const eq = part.lastIndexOf('=');
    const label = (eq >= 0 ? part.slice(0, eq) : part).trim();
    const raw = eq >= 0 ? part.slice(eq + 1).trim() : '';
    if (!label) return { list, error: 'Every option needs a label.' };
    const p = raw === '' ? null : Number(raw.replace(',', '.'));
    if (p != null && !(isFinite(p) && p >= 0 && p <= 100000)) return { list, error: `Option "${label}" has an invalid price.` };
    if (list.some((o) => o.label.toLowerCase() === label.toLowerCase())) return { list, error: `Duplicate option: ${label}.` };
    list.push({ label, price: p });
  }
  return { list, error: '' };
}
function optionsPreview(x) {
  if (!str(x.options).trim()) return '';
  if (x.category !== 'paid') return 'Only paid extras can have options.';
  const { list, error } = parseOptionsStrict(x.options);
  if (error) return error;
  const base = str(x.price).trim() === '' ? null : num(x.price);
  return `Guest chooses one: ${list.map((o) => `${o.label} ${o.price != null ? money(o.price, cur()) : base != null ? `${money(base, cur())} (price)` : '(price)'}`).join(' · ')}`;
}
const KIND_TEXT = { per_stay: 'per stay', per_night: 'per night', per_person_night: 'per person per night' };
function extraPreview(x) {
  let s;
  if (x.category === 'request') s = 'Free request (no price)';
  else if (x.category === 'quote') s = 'On request: listed without a price, you set the amount per stay';
  else if (str(x.price).trim() === '' || !(num(x.price) >= 0)) s = 'Paid: set a price';
  else s = `${money(num(x.price), cur())} ${KIND_TEXT[x.kind] || ''}${str(x.options).trim() ? ', or the option price' : ''}`;
  const mq = Number(str(x.max_qty).trim() || 1);
  if (mq > 1) s += `, up to ${mq}`;
  if (x.unit_id) s += `, ${unitNameOf(x.unit_id)} only`;
  else if (x.unit_type) s += `, ${x.unit_type}s only`;
  return `${s}.${x.active ? '' : ' Off: hidden from guests.'}`;
}

function extrasCard() {
  extras.forEach((x, i) => { x.__i = i; });
  const typeOpts = [['', 'Any type'], ...[...new Set(units().map((u) => String(u.type || '').toLowerCase()).filter(Boolean))].map((t) => [t, `${capitalize(t)}s`])];
  const unitOpts = [['', 'Any apartment'], ...units().map((u) => [u.id, u.name || u.id])];
  const used = new Set(state.reservations.flatMap((r) => (r.extras || []).map((l) => l.id)));
  const addBtn = h('button', { class: 'btn sm', type: 'button' }, icon('plus'), 'Add extra');
  addBtn.addEventListener('click', () => {
    const maxSort = extras.reduce((m, x) => Math.max(m, num(x.sort)), 0);
    extras.push({ _k: key(), id: '', locked: false, name_en: '', name_el: '', name_fr: '', name_es: '', name_de: '', category: 'paid', kind: 'per_stay',
      price: '', options: '', unit_type: '', unit_id: '', max_qty: '1', active: true, sort: String(maxSort + 10), notes: '' });
    markDirty('extras');
    rebuild();
    rootEl.querySelector('[data-card="extras"] .extra-item:last-of-type [data-field="name_en"]')?.focus();
  });

  const list = extras.map((x) => {
    const label = x.name_en ? `Extra ${x.name_en}` : `Extra ${x.__i + 1}`;
    const err = errors.extras?.row === x.__i ? errors.extras : null;
    const preview = h('p', { class: 'rule-preview', 'aria-live': 'polite' }, extraPreview(x));
    const optPrev = h('p', { class: 'hint opt-preview' });
    const box = h('article', { class: `rule extra-item cat-${x.category}${x.active ? '' : ' off'}${err ? ' has-error' : ''}`, 'aria-label': label });
    const refresh = () => {
      preview.textContent = extraPreview(x);
      box.querySelector('.ex-head-name').textContent = x.name_en || x.id || 'New extra';
      const op = optionsPreview(x);
      optPrev.textContent = op;
      optPrev.classList.toggle('bad', !!op && !op.startsWith('Guest'));
      box.classList.toggle('off', !x.active);
      box.querySelectorAll('[data-cats]').forEach((el) => { el.hidden = !el.dataset.cats.split(' ').includes(x.category); });
      const pl = box.querySelector('.price-label');
      if (pl) pl.textContent = x.category === 'paid' ? `Price (${cur()})` : `Price (${cur()}, ignored)`;
    };
    box.addEventListener('input', refresh);
    box.addEventListener('change', refresh);
    const act = h('input', { type: 'checkbox', class: 'switch sm', role: 'switch', checked: x.active, 'aria-label': `${label}: active`, 'data-field': 'active' });
    act.addEventListener('change', () => { x.active = act.checked; markDirty('extras'); });
    const dup = h('button', { class: 'btn ghost icon-btn sm', type: 'button', 'aria-label': `Duplicate ${label}`, title: 'Duplicate' }, icon('copy'));
    dup.addEventListener('click', () => {
      extras.splice(x.__i + 1, 0, { ...x, _k: key(), id: '', locked: false, name_en: x.name_en ? `${x.name_en} (copy)` : '', sort: str(num(x.sort) + 1) });
      markDirty('extras'); rebuild();
    });
    const del = h('button', { class: 'btn ghost icon-btn sm danger', type: 'button', 'aria-label': `Delete ${label}`, title: 'Delete' }, icon('trash'));
    del.addEventListener('click', async () => {
      if (x.locked && used.has(x.id) && !(await confirmDialog(`Reservations on this device use "${x.id}". They keep their booked lines, but the app and emails will show the id instead of the name. Delete anyway? Setting it inactive hides it from guests instead.`,
        { title: 'Extra in use', ok: 'Delete', danger: true }))) return;
      extras.splice(x.__i, 1); markDirty('extras'); errors.extras = null; rebuild();
    });
    const f = (lbl, el, cls = '', cats = null) => h('label', { class: `cell ${cls}`, 'data-cats': cats, hidden: cats && !cats.split(' ').includes(x.category) }, typeof lbl === 'string' ? fieldLabel(lbl) : lbl, el);
    const idCell = x.locked
      ? h('div', { class: 'cell' }, fieldLabel('Id'), h('code', { class: 'ex-id', title: 'Ids are referenced by reservations and cannot be changed.' }, x.id))
      : f('Id (optional)', cellInput(x, 'id', { type: 'text', maxlength: 40, placeholder: 'auto', pattern: '[A-Za-z0-9_-]*', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `${label}: id` }, 'extras'));
    const names = h('fieldset', { class: 'names' },
      h('legend', { class: 'cell-label' }, 'Names (EN required; others fall back to English)'),
      h('div', { class: 'names-grid' }, EXTRA_LANGS.map((l) => h('label', { class: `name-in${l === 'en' ? ' en' : ''}` },
        h('span', { class: 'lang' }, LANG_LABEL[l]),
        cellInput(x, `name_${l}`, { type: 'text', maxlength: 100, autocomplete: 'off', required: l === 'en', lang: l, 'aria-label': `${label}: name (${LANG_LABEL[l]})` }, 'extras')))));
    box.append(
      h('div', { class: 'rule-head' },
        h('span', { class: `cat-tag ${x.category}` }, EXTRA_CATEGORIES[x.category]),
        h('strong', { class: 'ex-head-name' }, x.name_en || (x.id ? x.id : 'New extra')),
        h('label', { class: 'toggle' }, act, 'Active'), dup, del),
      preview,
      names,
      h('div', { class: 'rule-grid ex-grid' },
        f('Category', cellSelect(x, 'category', Object.entries(EXTRA_CATEGORIES), { 'aria-label': `${label}: category` }, 'extras', () => {
          box.querySelector('.cat-tag').className = `cat-tag ${x.category}`; box.querySelector('.cat-tag').textContent = EXTRA_CATEGORIES[x.category];
        })),
        f('Kind', cellSelect(x, 'kind', Object.entries(EXTRA_KINDS), { 'aria-label': `${label}: kind` }, 'extras'), '', 'paid'),
        f(h('span', { class: 'cell-label price-label' }, x.category === 'paid' ? `Price (${cur()})` : `Price (${cur()}, ignored)`),
          cellInput(x, 'price', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: x.category === 'paid' ? '' : '–', 'aria-label': `${label}: price` }, 'extras'), '', 'paid'),
        f('Max qty', cellInput(x, 'max_qty', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '1', 'aria-label': `${label}: maximum quantity` }, 'extras')),
        f('Unit type', cellSelect(x, 'unit_type', typeOpts, { 'aria-label': `${label}: unit type` }, 'extras')),
        f('Apartment', cellSelect(x, 'unit_id', unitOpts, { 'aria-label': `${label}: apartment` }, 'extras')),
        f('Sort', cellInput(x, 'sort', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': `${label}: sort` }, 'extras')),
        idCell),
      h('label', { class: 'cell', 'data-cats': 'paid', hidden: x.category !== 'paid' }, fieldLabel('Options (label=price;label=price, optional)'),
        cellInput(x, 'options', { type: 'text', maxlength: 1000, autocomplete: 'off', placeholder: 'Sifnos white=18;Sifnos red=18', 'aria-label': `${label}: options` }, 'extras'), optPrev),
      h('label', { class: 'cell' }, fieldLabel('Notes (never shown to guests)'), cellInput(x, 'notes', { type: 'text', maxlength: 500, autocomplete: 'off', 'aria-label': `${label}: notes` }, 'extras')));
    refresh();
    return box;
  });

  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save extras');
  saveBtn.addEventListener('click', () => runSave('extras', saveBtn, () => actions.saveExtras(extras.map((x) => {
    const n = (v) => (str(v).trim() === '' ? '' : num(v));
    return {
      ...(x.id.trim() ? { id: x.id.trim() } : {}),
      ...Object.fromEntries(EXTRA_LANGS.map((l) => [`name_${l}`, str(x[`name_${l}`]).trim()])),
      category: x.category, kind: x.kind, price: n(x.price), options: x.category === 'paid' ? str(x.options).trim() : '',
      unit_type: x.unit_type || '', unit_id: x.unit_id || '', max_qty: str(x.max_qty).trim() === '' ? '' : Number(str(x.max_qty).trim()),
      active: !!x.active, sort: n(x.sort), notes: str(x.notes).trim(),
    };
  })), (p) => `Extras saved (${plural((p.extras || []).filter((x) => x.active === true || /^true$/i.test(String(x.active))).length, 'active extra')}).`));

  const counts = Object.keys(EXTRA_CATEGORIES).map((c) => [c, extras.filter((x) => x.category === c).length]).filter(([, n]) => n);
  return h('section', { class: 'card', 'data-card': 'extras', 'aria-labelledby': 'pr-extras' },
    h('div', { class: 'card-head' }, h('h2', { id: 'pr-extras' }, 'Extras'),
      counts.length ? h('span', { class: 'hint' }, counts.map(([c, n]) => `${n} ${EXTRA_CATEGORIES[c].toLowerCase()}`).join(' · ')) : null),
    h('p', { class: 'hint' }, 'Offered on the website and in the reservation form. Paid extras are priced from here; requests are free wishes; extras on request are listed without a price and you set the amount on the reservation. Discount rules never apply to extras.'),
    h('div', { class: 'card-tools' }, addBtn),
    list.length ? h('div', { class: 'rule-list extra-list' }, list) : h('p', { class: 'empty' }, 'No extras yet.'),
    errorLine('extras'),
    h('div', { class: 'card-foot' },
      h('p', { class: 'hint warn-hint' }, icon('warn', 'ic tiny'), ' Saving replaces the whole Extras tab in the Sheet. Do not reuse an id for a different extra.'),
      statusLine('extras'), saveBtn));
}
