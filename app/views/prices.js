// Prices (owners): seasonal rates, cleaning fees and discount rules (getPricing / savePrices /
// saveCleaningFees / saveDiscounts, API.md "Owner pricing actions"). Edits live in module drafts, so a
// background refresh never wipes them; each card saves on its own and is reloaded from the reply.
import { state, isOwner } from '../state.js';
import { h, icon, toast, confirmDialog } from '../ui.js';
import { fmtDate, isISODate, money, num, todayISO, plural, capitalize } from '../lib.js';
import * as actions from '../actions.js';

const KINDS = {
  long_stay: 'Long stay',
  early_booking: 'Early booking',
  last_minute: 'Last minute',
  period: 'Period',
};

let data = null;        // last getPricing payload
let loading = null;     // in-flight promise
let loadError = '';
let fetchedAt = 0;
let keySeq = 0;
const key = () => `k${++keySeq}`;

// Drafts
let rates = [];         // {_k, target:'type:maisonette'|'unit:u1', from, to, price_per_night, min_nights, notes}
let rules = [];         // {_k, id, name, kind, percent, min_nights, days_before, from, to, unit_type, unit_id, active, notes}
let fees = { maisonette: '', studio: '', per_unit: {} };
const dirty = { rates: false, fees: false, rules: false };
const errors = { rates: null, fees: null, rules: null }; // {row, field, message}
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
    _k: key(), id: str(d.id), name: str(d.name), kind: KINDS[d.kind] ? d.kind : 'long_stay', percent: str(d.percent),
    min_nights: str(d.min_nights), days_before: str(d.days_before), from: str(d.from), to: str(d.to),
    unit_type: str(d.unit_type).toLowerCase(), unit_id: str(d.unit_id),
    active: d.active === true || /^true$/i.test(str(d.active)), notes: str(d.notes),
  }));
  const cf = p.cleaning_fees || {};
  fees = { maisonette: str(cf.maisonette ?? ''), studio: str(cf.studio ?? ''),
    per_unit: Object.fromEntries(Object.entries(cf.per_unit || {}).map(([k, v]) => [k, str(v)])) };
  dirty.rates = dirty.fees = dirty.rules = false;
  errors.rates = errors.fees = errors.rules = null;
}

function load(force = false) {
  if (loading) return loading;
  if (!force && data && Date.now() - fetchedAt < 60000) return Promise.resolve();
  loading = actions.getPricing().then((p) => {
    // Unsaved drafts win over a background reload.
    if (!dirty.rates && !dirty.fees && !dirty.rules) fromPayload(p); else data = p;
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
  wrap.append(ratesCard(), feesCard(), rulesCard());
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

function handleSaveError(card, e, count) {
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
    const keep = { rates: dirty.rates && card !== 'rates' ? rates : null, rules: dirty.rules && card !== 'rules' ? rules : null, fees: dirty.fees && card !== 'fees' ? fees : null };
    const keepDirty = { ...dirty };
    fromPayload(p);
    fetchedAt = Date.now();
    for (const k of ['rates', 'rules', 'fees']) if (keep[k]) { if (k === 'rates') rates = keep[k]; else if (k === 'rules') rules = keep[k]; else fees = keep[k]; dirty[k] = keepDirty[k]; }
    rebuild();
    toast(okMsg(p));
  } catch (e) {
    handleSaveError(card, e, card === 'rates' ? rates.length : rules.length);
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
    h('div', { class: 'card-tools' }, addBtn, sortBtn, copyBtn),
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
    rules.push({ _k: key(), id: '', name: '', kind: 'long_stay', percent: '10', min_nights: '7', days_before: '', from: '', to: '', unit_type: '', unit_id: '', active: true, notes: '' });
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
    };
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
      h('div', { class: 'rule-grid' },
        f('Kind', cellSelect(d, 'kind', Object.entries(KINDS), { 'aria-label': `${label}: kind` }, 'rules')),
        f('Percent', cellInput(d, 'percent', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${label}: percent` }, 'rules')),
        f('Min nights', cellInput(d, 'min_nights', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${label}: minimum nights` }, 'rules'), '', 'long_stay'),
        f('Days before arrival', cellInput(d, 'days_before', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${label}: days before arrival` }, 'rules'), '', 'early_booking last_minute'),
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
  saveBtn.addEventListener('click', () => runSave('rules', saveBtn, () => actions.saveDiscounts(rules.map((d) => {
    const whole = (v) => (str(v).trim() === '' ? '' : Number(str(v).trim()));
    const days = d.kind === 'early_booking' || d.kind === 'last_minute';
    return {
      ...(d.id ? { id: d.id } : {}), name: d.name.trim(), kind: d.kind, percent: str(d.percent).trim() === '' ? '' : num(d.percent),
      min_nights: d.kind === 'long_stay' ? whole(d.min_nights) : '', days_before: days ? whole(d.days_before) : '',
      from: d.from || '', to: d.to || '', unit_type: d.unit_type || '', unit_id: d.unit_id || '', active: !!d.active, notes: d.notes.trim(),
    };
  })), (p) => `Discount rules saved (${plural((p.discounts || []).filter((x) => x.active === true || /^true$/i.test(String(x.active))).length, 'active rule')}).`));

  return h('section', { class: 'card', 'data-card': 'rules', 'aria-labelledby': 'pr-rules' },
    h('div', { class: 'card-head' }, h('h2', { id: 'pr-rules' }, 'Discount rules')),
    h('p', { class: 'hint' }, 'Applied to the accommodation only (never the cleaning fee). When several rules fit a stay, the one giving the biggest discount wins; rules never stack.'),
    h('div', { class: 'card-tools' }, addBtn),
    list.length ? h('div', { class: 'rule-list' }, list) : h('p', { class: 'empty' }, 'No discount rules.'),
    errorLine('rules'),
    h('div', { class: 'card-foot' },
      h('p', { class: 'hint warn-hint' }, icon('warn', 'ic tiny'), ' Saving replaces the whole Discounts tab in the Sheet.'),
      statusLine('rules'), saveBtn));
}
