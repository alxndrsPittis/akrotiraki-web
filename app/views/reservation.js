// Reservation form: bottom sheet on phones, dialog on wide screens.
import { state, activeUnits, unitById, isOwner, currency, depositPercent, extrasList, extraById } from '../state.js';
import { h, icon, openDialog, confirmDialog, toast } from '../ui.js';
import { addDays, diffDays, todayISO, isISODate, conflictsFor, fmtRange, fmtDateTime, money, num, plural, round2,
  depositOf, isEmail, ruleLabel, extraAmount, extraLabel, SOURCES, STATUSES, LANGS } from '../lib.js';
import * as actions from '../actions.js';

let seq = 0;

export function conflictList(list) {
  return h('ul', { class: 'conflicts' }, list.map((c) => h('li', null,
    h('strong', null, c.guest_name || 'Unnamed'), ' · ', fmtRange(c.check_in, c.check_out),
    ' · ', unitById(c.unit_id)?.name || c.unit_id,
    h('span', { class: `badge ${c.status}` }, STATUSES[c.status] || c.status))));
}

/**
 * Price lines for a stay: accommodation + cleaning − discount + extras = total (what the guest pays), deposit on that total.
 * price is net of the discount and includes extras_total (API.md), so accommodation = price + discount − cleaning − extras.
 * Empty when there is no price. full: always show the accommodation line (the form), not only when there is something to split.
 * The discount line names its rule when the stay has a discount_label: "Discount (Long stay 7+ nights, 10%)".
 */
export function priceBreakdown(r, { deposit = true, full = false } = {}) {
  const cur = currency();
  const price = Number(r.price) || 0;
  if (!(price > 0)) return null;
  const disc = Math.max(0, Number(r.discount) || 0);
  const ex = Math.min(Math.max(0, Number(r.extras_total) || 0), price + disc);
  const fee = Math.min(Math.max(0, Number(r.cleaning_fee) || 0), price + disc - ex);
  const pct = depositPercent();
  const row = (k, v, cls = '') => [h('dt', { class: cls }, k), h('dd', { class: `num ${cls}` }, v)];
  return h('dl', { class: 'breakdown' },
    full || fee > 0 || disc > 0 || ex > 0 ? row('Accommodation', money(round2(price + disc - fee - ex), cur)) : null,
    fee > 0 ? row('Cleaning fee', money(fee, cur)) : null,
    disc > 0 ? row(r.discount_label ? `Discount (${r.discount_label})` : 'Discount', h('span', { 'aria-label': `minus ${money(disc, cur)}` }, `−${money(disc, cur)}`), 'disc') : null,
    ex > 0 ? row('Extras', money(ex, cur)) : null,
    row('Total', money(price, cur), 'total'),
    deposit ? row(`Deposit ${pct}%`, money(depositOf(price, pct), cur), 'dep') : null);
}

/** A reservation's extras with names: [{id, name, category, kind, option, qty, unit_price, amount}] (name_en; the id when the extra is gone). */
export function describeExtras(r) {
  return (r.extras || []).map((l) => {
    const x = extraById(l.id);
    return { ...l, name: x ? x.name : l.id, category: x ? x.category : 'paid', kind: x ? x.kind : '' };
  });
}
/** Quote-category extras still without an amount ("price to set"); approving needs them priced. */
export const unpricedExtras = (r) => describeExtras(r).filter((x) => x.category === 'quote' && !(Number(x.amount) > 0));

/** Extras of a stay as three short lists: priced lines with amounts, on request ("price to set") and requests. */
export function extrasSummary(r) {
  const list = describeExtras(r);
  if (!list.length) return null;
  const cur = currency();
  const n = diffDays(r.check_in, r.check_out);
  const priced = list.filter((x) => x.category === 'paid' || (x.category === 'quote' && Number(x.amount) > 0));
  const onReq = list.filter((x) => x.category === 'quote' && !(Number(x.amount) > 0));
  const reqs = list.filter((x) => x.category === 'request');
  return h('div', { class: 'ex-sum' },
    priced.length ? h('ul', { class: 'ex-sum-list' }, priced.map((x) => h('li', null,
      h('span', null, extraLabel(x.name, x, x.kind, n, r.guests, x.category === 'paid')), h('span', { class: 'num' }, money(x.amount, cur))))) : null,
    onReq.length ? h('ul', { class: 'ex-sum-list' }, onReq.map((x) => h('li', { class: 'ex-tbd' },
      h('span', null, extraLabel(x.name, x, x.kind, n, r.guests, false)), h('span', { class: 'tag-tbd' }, 'price to set')))) : null,
    reqs.length ? h('p', { class: 'ex-sum-req' }, h('span', { class: 'muted' }, 'Requests: '),
      reqs.map((x) => extraLabel(x.name, x, x.kind, n, r.guests, false)).join(', ')) : null);
}

const KIND_UNIT = { per_stay: '', per_night: ' / night', per_person_night: ' / person / night' };
/** "€10 / person / night", "from €18", "free request", "price to set". */
function unitPriceText(x, cur) {
  if (x.category === 'request') return 'Free';
  if (x.category === 'quote') return 'Price to set';
  const ps = x.options.map((o) => (o.price == null ? x.price : o.price));
  const lo = ps.length ? Math.min(...ps) : x.price, hi = ps.length ? Math.max(...ps) : x.price;
  return `${lo !== hi ? 'from ' : ''}${money(lo, cur)}${KIND_UNIT[x.kind] ?? ''}`;
}

/**
 * Extras editor for the reservation form. initial: the stay's stored lines. ctx(): {unit_id, nights, guests}.
 * onChange(): any selection / qty / option / amount change. Stored paid lines keep their unit_price (agreed when booked)
 * unless the option changes; new lines take the current Extras price. Quote lines take the amount typed by the owner.
 */
function extrasEditor(initial, ctx, onChange, uid) {
  const cur = currency();
  const stored = new Map(initial.map((l) => [l.id, l]));
  const sel = new Map(initial.map((l) => {
    const x = extraById(l.id);
    const isQuote = x?.category === 'quote';
    return [l.id, { qty: l.qty, option: l.option || '', amountText: isQuote && Number(l.amount) > 0 ? String(l.amount) : '' }];
  }));
  const refreshers = [];
  const total = h('span', { class: 'ex-total num' });
  const count = h('span', { class: 'ex-count' });
  const list = h('div', { class: 'ex-groups' });
  const box = h('details', { class: 'extras-box', open: sel.size > 0 },
    h('summary', null, h('span', { class: 'ex-title' }, 'Extras'), count),
    list,
    h('p', { class: 'ex-foot' }, h('span', null, 'Extras total'), total));

  /** Lines for the current selection: {id, name, category, kind, qty, option, unit_price, amount, amountSet, needsGuests}. */
  function lines() {
    const { nights, guests } = ctx();
    const out = [];
    for (const [id, s] of sel) {
      const x = extraById(id);
      const st = stored.get(id);
      if (!x) { // extra removed from the tab: keep the stored line as it is
        out.push({ id, name: id, category: 'paid', kind: '', qty: s.qty, option: s.option, unit_price: st?.unit_price || 0, amount: st?.amount || 0, amountSet: true });
        continue;
      }
      const l = { id, name: x.name, category: x.category, kind: x.kind, qty: s.qty, option: x.options.length ? s.option : '', unit_price: 0, amount: 0, amountSet: false };
      if (x.category === 'paid') {
        const opt = x.options.find((o) => o.label.toLowerCase() === l.option.toLowerCase());
        const listPrice = opt && opt.price != null ? opt.price : x.price;
        l.unit_price = st && (st.option || '') === l.option ? st.unit_price : listPrice;
        l.needsGuests = x.kind === 'per_person_night' && !(guests >= 1);
        l.missingOption = x.options.length > 0 && !opt;
        l.amount = l.needsGuests || l.missingOption ? 0 : extraAmount(x.kind, l.unit_price, l.qty, nights, guests);
        l.amountSet = true;
      } else if (x.category === 'quote' && s.amountText.trim() !== '') {
        l.amount = round2(num(s.amountText));
        l.unit_price = round2(l.amount / l.qty);
        l.amountSet = true;
        l.badAmount = !/^\s*\d+([.,]\d{1,2})?\s*$/.test(s.amountText);
      }
      out.push(l);
    }
    return out;
  }
  const totalOf = (ls) => round2(ls.reduce((a, l) => a + (Number(l.amount) || 0), 0));

  function refresh() {
    const ls = lines();
    const t = totalOf(ls);
    total.textContent = money(t, cur);
    count.textContent = ls.length ? `${plural(ls.length, 'chosen', 'chosen')}${t > 0 ? ` · ${money(t, cur)}` : ''}${ls.some((l) => l.category === 'quote' && !l.amountSet) ? ' · price to set' : ''}` : 'none';
    for (const f of refreshers) f(ls);
  }

  function rowFor(x, note) {
    const on = () => sel.has(x.id);
    const key = `${uid}-x-${x.id}`;
    const cb = h('input', { type: 'checkbox', id: key, checked: on() });
    const maxQ = Math.max(x.max_qty, sel.get(x.id)?.qty || 1);
    const qtyOut = h('output', { class: 'qty-val', 'aria-live': 'polite' });
    const minus = h('button', { type: 'button', class: 'btn sm icon-btn qty-btn', 'aria-label': `Fewer: ${x.name}` }, '−');
    const plus = h('button', { type: 'button', class: 'btn sm icon-btn qty-btn', 'aria-label': `More: ${x.name}` }, '+');
    const stepper = maxQ > 1 ? h('span', { class: 'qty', role: 'group', 'aria-label': `Quantity of ${x.name}` }, minus, qtyOut, plus) : null;
    const optSel = x.options.length ? h('select', { class: 'ex-opt', 'aria-label': `Option for ${x.name}` },
      h('option', { value: '' }, 'Choose…'),
      x.options.map((o) => h('option', { value: o.label }, `${o.label} · ${money(o.price == null ? x.price : o.price, cur)}`))) : null;
    const amt = x.category === 'quote' ? h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'ex-amt-in',
      placeholder: 'Price to set', 'aria-label': `Amount for ${x.name} (${cur})`, value: sel.get(x.id)?.amountText || '' }) : null;
    const amtOut = h('span', { class: 'ex-amt num' });
    const ctrl = h('div', { class: 'ex-ctrl' }, stepper, optSel, amt, amtOut);
    const row = h('div', { class: `ex-line cat-${x.category}` },
      h('label', { class: 'ex-check', for: key }, cb,
        h('span', { class: 'ex-name' }, x.name, note ? h('small', { class: 'muted' }, ` (${note})`) : null),
        h('span', { class: 'ex-unit' }, unitPriceText(x, cur))),
      ctrl);
    const sync = (ls) => {
      const s = sel.get(x.id);
      const l = ls.find((y) => y.id === x.id);
      row.classList.toggle('on', !!s);
      ctrl.hidden = !s;
      cb.checked = !!s;
      if (!s || !l) return;
      qtyOut.textContent = String(s.qty);
      minus.disabled = s.qty <= 1;
      plus.disabled = s.qty >= maxQ;
      if (optSel && optSel.value !== s.option) optSel.value = s.option;
      if (optSel) optSel.setAttribute('aria-invalid', l.missingOption ? 'true' : 'false');
      if (amt) amt.setAttribute('aria-invalid', l.badAmount ? 'true' : 'false');
      amtOut.classList.remove('tbd', 'bad');
      if (x.category === 'request') amtOut.textContent = '';
      else if (x.category === 'quote' && !l.amountSet) { amtOut.textContent = ''; }
      else if (l.missingOption) { amtOut.textContent = 'choose'; amtOut.classList.add('bad'); }
      else if (l.needsGuests) { amtOut.textContent = 'enter guests'; amtOut.classList.add('bad'); }
      else amtOut.textContent = money(l.amount, cur);
    };
    refreshers.push(sync);
    cb.addEventListener('change', () => {
      if (cb.checked) sel.set(x.id, { qty: 1, option: x.options.length === 1 ? x.options[0].label : '', amountText: '' });
      else sel.delete(x.id);
      refresh(); onChange();
      if (cb.checked) (optSel || amt)?.focus();
    });
    const step = (d) => { const s = sel.get(x.id); s.qty = Math.min(maxQ, Math.max(1, s.qty + d)); refresh(); onChange(); };
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    optSel?.addEventListener('change', () => { sel.get(x.id).option = optSel.value; refresh(); onChange(); });
    amt?.addEventListener('input', () => { sel.get(x.id).amountText = amt.value; refresh(); onChange(); });
    return row;
  }

  /** (Re)build the list for the current unit: active extras that fit it, plus anything already chosen. */
  function build() {
    refreshers.length = 0;
    const u = unitById(ctx().unit_id);
    const fits = (x) => (!x.unit_type || x.unit_type === String(u?.type || '').toLowerCase()) && (!x.unit_id || x.unit_id.toLowerCase() === String(u?.id || '').toLowerCase());
    const all = extrasList().slice().sort((a, b) => a.sort - b.sort || a.index - b.index);
    const shown = all.filter((x) => (x.active && fits(x)) || sel.has(x.id));
    const groups = [['paid', 'Paid'], ['request', 'Requests'], ['quote', 'On request (price agreed later)']];
    const missing = [...sel.keys()].filter((id) => !extraById(id));
    list.replaceChildren(...[
      ...groups.map(([cat, title]) => {
        const xs = shown.filter((x) => x.category === cat);
        if (!xs.length) return null;
        return h('fieldset', { class: 'ex-group' }, h('legend', null, title),
          xs.map((x) => rowFor(x, !x.active ? 'inactive' : !fits(x) ? 'other apartment' : '')));
      }),
      missing.length ? h('p', { class: 'hint' }, `No longer in the Extras list: ${missing.join(', ')} (kept as booked).`) : null,
      !all.length ? h('p', { class: 'hint' }, 'No extras defined yet (Prices → Extras).') : null].filter(Boolean));
    refresh();
  }
  build();
  return { el: box, lines, total: () => totalOf(lines()), build, refresh, open: () => { box.open = true; },
    /** Open the box and return the extra's first control (amount, option, else its checkbox) for focusing. */
    focus: (id) => {
      box.open = true;
      const line = list.querySelector(`#${CSS.escape(`${uid}-x-${id}`)}`)?.closest('.ex-line');
      const el = line?.querySelector('.ex-amt-in') || line?.querySelector('select') || line?.querySelector('input');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
      return el;
    } };
}

/** mailto: link that opens the owner's own mail app, addressed to the guest. */
export function mailtoFor(r) {
  const subject = `Your request for Akrotiraki, ${fmtRange(r.check_in, r.check_out)}`;
  return `mailto:${encodeURI(r.email)}?subject=${encodeURIComponent(subject)}`;
}

const stayLine = (r) => {
  const u = unitById(r.unit_id);
  const n = diffDays(r.check_in, r.check_out);
  return `${u?.name || r.unit_id} · ${fmtRange(r.check_in, r.check_out)} · ${plural(n, 'night')}${r.guests ? ' · ' + plural(r.guests, 'guest') : ''}`;
};

function overlapBox(list, strong) {
  return h('div', { class: `warn${strong ? ' strong' : ''}` }, h('p', { class: 'warn-title' }, icon('warn'), `Overlaps ${plural(list.length, 'stay')}:`), conflictList(list));
}

/** Ask whether to email the guest. Resolves undefined (no email on file), true/false, or null when dismissed. */
async function askEmail(kind, r, { extra = null, danger = false, okLabel } = {}) {
  const confirm = kind === 'confirm';
  const title = confirm ? 'Approve request' : 'Decline request';
  const ok = okLabel || (confirm ? 'Approve' : 'Decline');
  if (!r.email) {
    const msg = confirm
      ? `Confirm the stay of ${r.guest_name || 'this guest'}? There is no guest email, so nothing is sent.`
      : `Decline ${r.guest_name || 'this request'} (${fmtRange(r.check_in, r.check_out)})? It will be marked cancelled. There is no guest email, so nothing is sent.`;
    return (await confirmDialog(msg, { title, ok, danger: danger || !confirm, extra })) ? undefined : null;
  }
  const msg = confirm
    ? `Confirm this stay and email ${r.email} the price and the deposit details?`
    : `Decline and email ${r.email} a polite note?`;
  const ans = await confirmDialog(msg, { title, ok: `${ok} and email`, danger: danger || !confirm, extra,
    check: { label: 'Send email', checked: true, okUnchecked: ok } });
  return ans ? ans.checked : null;
}

/** Owner approves a pending request: price first (form), then confirm + optional guest email. */
export async function approveRequest(input) {
  const r = state.reservations.find((x) => x.id === input.id) || input;
  if (!isOwner()) { toast('Only owners can approve.', 'error'); return false; }
  const unpriced = unpricedExtras(r);
  if (unpriced.length) {
    const ok = await confirmDialog(`${unpriced.map((x) => x.name).join(', ')} ${unpriced.length === 1 ? 'has' : 'have'} no price yet. ` +
      'Set the amount agreed with the guest (or untick the extra) before approving: the confirmation email lists every extra with its price.',
    { title: 'Extras on request', ok: 'Set price & approve', extra: h('div', { class: 'dlg-extra' }, extrasSummary(r)) });
    if (ok) openReservation(r, { intent: 'approve', focusExtra: unpriced[0].id });
    return false;
  }
  if (!(r.price > 0)) { openReservation(r, { intent: 'approve' }); return false; }
  const conf = conflictsFor({ ...r, status: 'confirmed' }, state.reservations);
  const extra = h('div', { class: 'dlg-extra' },
    h('p', { class: 'hint' }, `${r.guest_name || 'Unnamed'} · ${stayLine(r)}`),
    priceBreakdown(r),
    extrasSummary(r),
    conf.length ? overlapBox(conf, true) : null);
  const notify = await askEmail('confirm', r, { extra, danger: conf.length > 0, okLabel: conf.length ? 'Approve anyway' : 'Approve' });
  if (notify === null) return false;
  try {
    try {
      await actions.setReservationStatus(r.id, 'confirmed', { force: conf.length > 0, notify });
    } catch (e) {
      if (e.code !== 'conflict') throw e;
      const list = e.data?.conflicts || [];
      const ok = await confirmDialog(`It now overlaps ${plural(list.length, 'other stay')}. Approve anyway?`,
        { title: 'Overlapping stay', ok: 'Approve anyway', danger: true, extra: conflictList(list) });
      if (!ok) return false;
      await actions.setReservationStatus(r.id, 'confirmed', { force: true, notify });
    }
  } catch (e) { actions.report(e); return false; }
  toast(notify ? `Confirmed. Emailing ${r.email}.` : `Confirmed ${r.guest_name || 'reservation'}.`);
  return true;
}

/** Decline a pending request (owner or manager): cancelled + optional polite email. */
export async function declineRequest(input) {
  const r = state.reservations.find((x) => x.id === input.id) || input;
  const notify = await askEmail('decline', r, { extra: h('p', { class: 'hint dlg-extra' }, `${r.guest_name || 'Unnamed'} · ${stayLine(r)}`) });
  if (notify === null) return false;
  try {
    await actions.setReservationStatus(r.id, 'cancelled', { notify });
  } catch (e) { actions.report(e); return false; }
  toast(notify ? `Declined. Emailing ${r.email}.` : 'Request declined.');
  return true;
}

/**
 * Reservation form. opts.intent = 'approve': opened from a request without a price;
 * saving continues into the approval dialog.
 */
export function openReservation(input = {}, opts = {}) {
  const approving = opts.intent === 'approve';
  const uid = `r${++seq}`;
  const existing = input.id ? state.reservations.find((r) => r.id === input.id) || input : null;
  const owner = isOwner();
  const units = activeUnits();
  const t = todayISO();
  const r = {
    unit_id: units[0]?.id || '', check_in: t, check_out: addDays(t, 1), guest_name: '', guests: 2,
    source: 'direct', status: owner ? 'confirmed' : 'pending', price: '', paid: '', checked: false, notes: '',
    email: '', phone: '', lang: 'en', cleaning_fee: '', discount: '',
    ...(existing || input),
  };
  if (!existing && r.check_out <= r.check_in) r.check_out = addDays(r.check_in, 1);

  const field = (label, control, extra) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, extra);

  // Unit: segmented control (radio group)
  const unitSeg = h('fieldset', { class: 'field' },
    h('legend', { class: 'field-label' }, 'Unit'),
    h('div', { class: 'seg' }, units.map((u) => [
      h('input', { type: 'radio', name: `${uid}-unit`, id: `${uid}-u-${u.id}`, value: u.id, checked: u.id === r.unit_id }),
      h('label', { for: `${uid}-u-${u.id}` }, h('span', { class: 'dot', style: `background:${u.color || 'var(--sea)'}` }), h('span', { class: 'u-long' }, u.name), h('span', { class: 'u-short' }, u.id)),
    ])));

  const ci = h('input', { type: 'date', required: true, value: r.check_in, id: `${uid}-ci` });
  const co = h('input', { type: 'date', required: true, value: r.check_out, id: `${uid}-co` });
  const nightsOut = h('p', { class: 'hint', 'aria-live': 'polite' });
  const name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'words', value: r.guest_name, maxlength: 120 });
  const guests = h('input', { type: 'number', min: 0, max: 20, step: 1, inputmode: 'numeric', value: r.guests ?? '' });
  const capHint = h('span', { class: 'hint' });
  const source = h('select', { value: r.source }, Object.entries(SOURCES).map(([k, v]) => h('option', { value: k }, v.label)));
  const status = h('select', { value: r.status }, Object.entries(STATUSES).map(([k, v]) =>
    h('option', { value: k, disabled: k === 'confirmed' && !owner && existing?.status !== 'confirmed' }, v)));
  const price = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', pattern: '[0-9]*[.,]?[0-9]*', value: r.price === 0 && !existing ? '' : r.price });
  const paid = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', pattern: '[0-9]*[.,]?[0-9]*', value: r.paid === 0 && !existing ? '' : r.paid });
  const cleaning = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', pattern: '[0-9]*[.,]?[0-9]*', value: r.cleaning_fee ? r.cleaning_fee : '' });
  const discount = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', pattern: '[0-9]*[.,]?[0-9]*', placeholder: '0', value: Number(r.discount) > 0 ? r.discount : '' });
  const priceNote = h('span', { class: 'hint' });
  const discHint = h('span', { class: 'hint' });
  const email = h('input', { type: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'email', maxlength: 254, value: r.email || '' });
  const phone = h('input', { type: 'tel', autocomplete: 'off', maxlength: 40, value: r.phone || '' });
  const lang = h('select', { value: LANGS[r.lang] ? r.lang : 'en' }, Object.entries(LANGS).map(([k, v]) => h('option', { value: k }, v)));
  const recalcBtn = h('button', { class: 'btn sm', type: 'button' }, icon('calc'), 'Recalculate price');
  const quoteInfo = h('div', { class: 'quote', 'aria-live': 'polite' }); // price-list messages
  const breakOut = h('div', { class: 'price-break' }); // breakdown of the form values (not live: it changes on every keystroke)
  const balance = h('p', { class: 'hint' });
  const checked = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: !!r.checked, id: `${uid}-chk` });
  const notes = h('textarea', { rows: 3, value: r.notes || '' });
  const warn = h('div', { class: 'warn', hidden: true, 'aria-live': 'polite' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const exSlot = h('div');

  const form = h('form', { class: 'form', novalidate: true },
    unitSeg,
    h('div', { class: 'row2' }, field('Check-in', ci), field('Check-out', co)),
    nightsOut,
    warn,
    approving ? h('p', { class: 'info-note' }, unpricedExtras(r).length
      ? 'Set the price of the extras on request before approving: the confirmation email lists every extra with its price.'
      : 'Set the price before approving: the confirmation email shows it with the deposit.') : null,
    field('Guest name', name),
    h('div', { class: 'row2' }, field('Guests', guests, capHint), field('Source', source)),
    field('Email', email, h('span', { class: 'hint' }, 'Optional. Requests from the website have one.')),
    h('div', { class: 'row2' }, field('Phone', phone), field('Language', lang)),
    field('Status', status, !owner ? h('span', { class: 'hint' }, 'Only owners can confirm.') : null),
    exSlot,
    h('div', { class: 'row3 price-fields' }, field(`Price, total (${currency()})`, price, priceNote),
      field('of which cleaning', cleaning), field('Discount', discount, discHint)),
    h('div', { class: 'quote-row' }, quoteInfo, recalcBtn),
    breakOut,
    h('div', { class: 'row2' }, field('Paid', paid), h('div')),
    balance,
    h('div', { class: 'switch-row' },
      h('label', { for: `${uid}-chk` }, 'Verified on Airbnb/Booking/Vrbo',
        h('span', { class: 'hint block' }, 'Ticked after checking the platform calendar.')),
      checked),
    field('Notes', notes),
    existing?.created_at ? h('p', { class: 'meta' },
      `Created ${fmtDateTime(existing.created_at)}${existing.created_by ? ' by ' + existing.created_by : ''}` +
      (existing.updated_at && existing.updated_at !== existing.created_at ? ` · updated ${fmtDateTime(existing.updated_at)}` : '')) : null,
    err,
  );

  const saveLabel = approving ? 'Save and approve' : 'Save';
  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, saveLabel);
  const closeBtn = h('button', { class: 'btn', type: 'button' }, 'Close');
  const cancelBtn = existing && existing.status !== 'cancelled'
    ? h('button', { class: 'btn danger push-left', type: 'button' }, existing.status === 'pending' ? 'Decline request' : 'Cancel reservation') : null;

  const dlg = openDialog({
    title: approving ? `Price for ${existing?.guest_name || 'this request'}` : existing ? (existing.guest_name || 'Reservation') : 'New reservation',
    body: form,
    foot: [cancelBtn, closeBtn, saveBtn],
  });

  // Extras: context read from the form; any change re-runs update(), which keeps the price in step.
  const exCtx = () => {
    const u = form.querySelector(`input[name="${uid}-unit"]:checked`)?.value || r.unit_id;
    const n = isISODate(ci.value) && isISODate(co.value) && co.value > ci.value ? diffDays(ci.value, co.value) : 0;
    return { unit_id: u, nights: n, guests: Math.max(0, Math.round(num(guests.value))) };
  };
  const ex = extrasEditor(existing ? existing.extras || [] : [], exCtx, () => update(), uid);
  exSlot.replaceWith(ex.el);

  const read = () => ({
    ...(existing || {}),
    unit_id: form.querySelector(`input[name="${uid}-unit"]:checked`)?.value || '',
    check_in: ci.value, check_out: co.value,
    guest_name: name.value.trim(),
    guests: Math.max(0, Math.round(num(guests.value))),
    source: source.value, status: status.value,
    price: num(price.value), paid: num(paid.value), cleaning_fee: num(cleaning.value), discount: effDisc(), discount_label: discLabel(),
    email: email.value.trim(), phone: phone.value.trim(), lang: lang.value,
    checked: checked.checked, notes: notes.value.trim(),
    extras: ex.lines(), extras_total: ex.total(),
  });

  let serverConflicts = null;
  let notifyAnswer; // guest-email choice for this save; reset whenever the form changes
  function renderWarn(list, fromServer) {
    warn.replaceChildren();
    if (!list.length) { warn.hidden = true; return; }
    const cur = read();
    warn.hidden = false;
    warn.classList.toggle('strong', cur.status === 'confirmed');
    warn.append(
      h('p', { class: 'warn-title' }, icon('warn'),
        fromServer ? 'Confirmed stays cannot overlap. This conflicts with:' : `Overlaps ${plural(list.length, 'stay')}:`),
      conflictList(list),
    );
    if (fromServer) {
      if (owner) {
        const force = h('button', { class: 'btn danger-solid', type: 'button' }, 'Confirm anyway');
        force.addEventListener('click', () => save(true));
        warn.append(h('div', { class: 'warn-actions' }, force));
      } else {
        warn.append(h('p', { class: 'hint' }, 'Save it as pending, or ask an owner to confirm.'));
      }
    } else if (cur.status === 'confirmed') {
      warn.append(h('p', { class: 'hint' }, 'Saving as confirmed will need an owner to override.'));
    }
  }

  function update() {
    syncExtras();
    const cur = read();
    if (isISODate(cur.check_in) && isISODate(cur.check_out) && cur.check_out > cur.check_in) {
      const n = diffDays(cur.check_in, cur.check_out);
      nightsOut.textContent = plural(n, 'night');
      nightsOut.classList.remove('bad');
    } else {
      nightsOut.textContent = 'Check-out must be after check-in.';
      nightsOut.classList.add('bad');
    }
    const u = unitById(cur.unit_id);
    capHint.textContent = u?.capacity ? `Sleeps ${u.capacity}` : '';
    capHint.classList.toggle('bad', !!u?.capacity && cur.guests > u.capacity);
    const due = round2(cur.price - cur.paid);
    const pct = depositPercent();
    const dep = cur.source === 'direct' && cur.price > 0 && cur.paid < depositOf(cur.price, pct)
      ? `Deposit ${pct}%: ${money(depositOf(cur.price, pct), currency())} · ` : '';
    balance.textContent = cur.price > 0 ? dep + (due > 0 ? `Balance due ${money(due, currency())}` : 'Paid in full') : '';
    renderPriceInfo(cur);
    serverConflicts = null;
    notifyAnswer = undefined;
    renderWarn(conflictsFor(cur, state.reservations), false);
  }

  let lastNights = Math.max(1, diffDays(r.check_in, r.check_out) || 1);
  ci.addEventListener('change', () => {
    if (isISODate(ci.value) && (!isISODate(co.value) || co.value <= ci.value)) co.value = addDays(ci.value, lastNights);
    co.min = isISODate(ci.value) ? addDays(ci.value, 1) : '';
  });
  co.addEventListener('change', () => {
    if (isISODate(ci.value) && isISODate(co.value) && co.value > ci.value) lastNights = diffDays(ci.value, co.value);
  });
  if (isISODate(r.check_in)) co.min = addDays(r.check_in, 1);

  // ---- Price list quote and discount ----
  // New reservations (and requests being priced for approval) quote automatically until the user types a price.
  // price is what the guest pays (accommodation + cleaning − discount). Until it is typed by hand it follows
  // gross − discount, where gross is the loaded quote total or, for a saved stay, its saved price + discount.
  const autoQuote = !existing || (approving && !(existing.price > 0));
  let priceTouched = !autoQuote;
  let quoted = false;
  let lastQuote = null; // complete quote for the current unit and dates
  // gross = accommodation + cleaning (no discount, no extras); price = gross − discount + extras total.
  let gross = existing && existing.price > 0 ? round2(existing.price + (Number(existing.discount) || 0) - (Number(existing.extras_total) || 0)) : null;
  let priceMode = gross != null ? 'base' : null; // 'quote' | 'base' | 'manual' | null
  let qSeq = 0, qTimer = 0;
  const cur$ = () => currency();
  // Discount: typed by the owner (0 included) wins; an empty field means "the quote's rule" while a quote prices
  // the stay (rule_discount, label "<name>, <percent>%"), else none.
  const discTyped = () => discount.value.trim() !== '';
  const ruleActive = () => !discTyped() && priceMode === 'quote' && !!lastQuote && Number(lastQuote.rule_discount) > 0;
  const effDisc = () => (discTyped() ? num(discount.value) : ruleActive() ? Number(lastQuote.rule_discount) : 0);
  const discLabel = () => {
    if (ruleActive()) return ruleLabel(lastQuote);
    if (discTyped() && existing?.discount_label && num(discount.value) === Number(existing.discount)) return existing.discount_label;
    return '';
  };
  /** Price-list accommodation + cleaning (the quote total is net of the rule discount and includes the extras). */
  const qGross = (q) => round2((Number(q.total) || 0) + (Number(q.rule_discount) || 0) - (Number(q.extras_total) || 0));
  const setPrice = (v) => { price.value = v > 0 ? String(round2(v)) : ''; };
  const autoPrice = () => setPrice(gross - Math.max(0, effDisc()) + ex.total());

  // Extras changes: the price follows (list or saved base: gross − discount + extras; typed by hand: by the difference),
  // and a price from the list is re-quoted with the extras and guests.
  let lastEx = ex.total();
  let lastExKey = '';
  const quoteLines = () => ex.lines().filter((l) => !l.missingOption && !l.needsGuests && !l.badAmount);
  const exKey = () => {
    const ls = quoteLines();
    return JSON.stringify([ls.map((l) => [l.id, l.qty, l.option, l.amountSet ? l.amount : null]), ls.some((l) => l.kind === 'per_person_night') ? exCtx().guests : 0]);
  };
  lastExKey = exKey();
  function syncExtras() {
    const t = ex.total();
    if (t !== lastEx) {
      const d = round2(t - lastEx);
      lastEx = t;
      if ((priceMode === 'quote' || priceMode === 'base') && gross != null) autoPrice();
      else if (num(price.value) > 0) setPrice(num(price.value) + d);
    }
    const k = exKey();
    if (k !== lastExKey) {
      lastExKey = k;
      if (priceMode === 'quote' || (autoQuote && !priceTouched)) { clearTimeout(qTimer); qTimer = setTimeout(() => runQuote(false), 400); }
    }
  }

  price.addEventListener('input', () => { priceTouched = true; priceMode = 'manual'; gross = null; });
  cleaning.addEventListener('input', () => { priceTouched = true; });
  discount.addEventListener('input', () => {
    if (lastQuote) {
      // A quote is loaded: the price becomes the price-list total less the discount again.
      priceMode = 'quote';
      gross = qGross(lastQuote);
      autoPrice();
      cleaning.value = lastQuote.cleaning_fee ? String(lastQuote.cleaning_fee) : '';
      priceTouched = false;
      quoted = true;
    } else if (priceMode === 'base' && gross != null) {
      autoPrice();
    }
  });

  function renderQuote(q) {
    const c = q.currency || cur$();
    const rates = (q.nightly || []).map((x) => Number(x.price)).filter((p) => p > 0);
    const lo = Math.min(...rates), hi = Math.max(...rates);
    const per = rates.length ? ` at ${lo === hi ? money(lo, c) : `${money(lo, c)}–${money(hi, c)}`}/night` : '';
    const missing = (q.nightly || []).filter((x) => x.price == null).length;
    quoteInfo.replaceChildren(...[
      q.incomplete
        ? h('p', { class: 'bad' }, `No rate in the price list for ${plural(missing, 'night')} of ${q.nights}. Enter the price by hand, or add the rates to the Prices tab.`)
        : h('p', null, `Price list: ${plural(q.nights, 'night')}${per}, `, h('strong', null, money(q.total, c)),
          q.cleaning_fee && Number(q.extras_total) > 0 ? ' with cleaning and extras' : q.cleaning_fee ? ' with cleaning' : Number(q.extras_total) > 0 ? ' with extras' : '',
          Number(q.rule_discount) > 0 ? ` and ${q.rule_name || 'a discount rule'} (−${money(q.rule_discount, c)})` : ''),
      q.below_min ? h('p', { class: 'bad' }, `Shorter than the minimum stay of ${plural(Number(q.min_nights) || 0, 'night')} for these dates.`) : null,
    ].filter(Boolean));
  }

  /** Breakdown of the form values, price source note and discount check. Called from update(). */
  function renderPriceInfo(cur) {
    const c = cur$();
    const d = Math.max(0, cur.discount);
    const fromList = priceMode === 'quote' && lastQuote;
    priceNote.textContent = !(cur.price > 0) ? ''
      : fromList ? (d > 0 ? `Price list ${money(qGross(lastQuote), c)} − discount${cur.extras_total > 0 ? ' + extras' : ''}` : cur.extras_total > 0 ? 'Price list + extras' : 'From the price list')
        : priceMode === 'base' && (d > 0 || cur.extras_total > 0) && gross != null ? `${money(gross, c)}${d > 0 ? ' − discount' : ''}${cur.extras_total > 0 ? ' + extras' : ''}`
          : priceMode === 'manual' ? (d > 0 ? 'Entered by hand, after discount' : 'Entered by hand') : '';
    priceNote.classList.toggle('auto', !!fromList);
    let dErr = '';
    if (cur.discount < 0) dErr = 'Cannot be negative.';
    else if (lastQuote && d > qGross(lastQuote)) dErr = `More than the price-list total ${money(qGross(lastQuote), c)}.`;
    const rule = lastQuote && Number(lastQuote.rule_discount) > 0 ? ruleLabel(lastQuote) : '';
    discount.placeholder = ruleActive() ? String(lastQuote.rule_discount) : '0';
    discHint.textContent = dErr || (ruleActive() ? `${rule}. Type an amount to override, 0 for none.`
      : rule && discTyped() && priceMode === 'quote' ? `Replaces ${rule}. Clear to use it.`
        : cur.discount_label || '');
    discHint.classList.toggle('bad', !!dErr);
    discount.setAttribute('aria-invalid', dErr ? 'true' : 'false');
    const b = priceBreakdown(cur, { deposit: false, full: true });
    breakOut.replaceChildren(...(b ? [b] : []));
  }

  async function runQuote(manual) {
    const cur = read();
    if (!cur.unit_id || !isISODate(cur.check_in) || !isISODate(cur.check_out) || cur.check_out <= cur.check_in) {
      if (manual) { quoteInfo.replaceChildren(h('p', { class: 'bad' }, 'Choose the unit and valid dates first.')); update(); }
      return;
    }
    const my = ++qSeq;
    recalcBtn.disabled = true;
    quoteInfo.replaceChildren(h('p', { class: 'hint' }, 'Getting the price…'));
    try {
      lastExKey = exKey();
      const q = await actions.quoteFor(cur.unit_id, cur.check_in, cur.check_out, { extras: quoteLines(), guests: cur.guests });
      if (my !== qSeq || !dlg.isConnected) return;
      // An incomplete quote only covers the priced nights: never use its total.
      lastQuote = q.incomplete ? null : q;
      if (!q.incomplete && (manual || !priceTouched)) {
        priceMode = 'quote';
        gross = qGross(q);
        autoPrice();
        cleaning.value = q.cleaning_fee ? String(q.cleaning_fee) : '';
        priceTouched = false;
        quoted = true;
      }
      renderQuote(q);
      update();
    } catch (e) {
      if (my !== qSeq) return;
      quoteInfo.replaceChildren(h('p', { class: manual ? 'bad' : 'hint' },
        e.code === 'network' ? 'Offline: no price list quote.' : manual ? (e.message || 'Could not get a quote.') : 'No automatic price. Enter it, or press Recalculate.'));
      update();
    } finally {
      if (my === qSeq) recalcBtn.disabled = false;
    }
  }
  /** Unit or dates changed: the loaded quote no longer applies (and a reply still on its way is dropped). */
  function invalidateQuote() {
    qSeq++;
    lastQuote = null;
    if (priceMode === 'quote') priceMode = 'base';
    quoteInfo.replaceChildren();
    recalcBtn.disabled = false;
  }
  function scheduleQuote() {
    if (!autoQuote || priceTouched) return;
    if (source.value === 'family' || source.value === 'block') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => runQuote(false), 300);
  }
  recalcBtn.addEventListener('click', () => runQuote(true));
  form.addEventListener('change', (e) => {
    const dates = e.target === ci || e.target === co || e.target.name === `${uid}-unit`;
    if (e.target.name === `${uid}-unit`) ex.build();
    if (dates) invalidateQuote();
    if (dates || e.target === source) scheduleQuote();
  });

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  update();
  scheduleQuote();
  if (opts.focusExtra) setTimeout(() => ex.focus(opts.focusExtra), 50);

  function fail(msg, el) {
    err.textContent = msg;
    err.hidden = false;
    el?.focus();
  }

  async function save(force) {
    err.hidden = true;
    const cur = read();
    if (!cur.unit_id) return fail('Choose a unit.', form.querySelector('input[type=radio]'));
    if (!isISODate(cur.check_in)) return fail('Enter a check-in date.', ci);
    if (!isISODate(cur.check_out) || cur.check_out <= cur.check_in) return fail('Check-out must be after check-in.', co);
    if (!cur.guest_name) {
      if (cur.source === 'block') cur.guest_name = 'Blocked';
      else return fail('Enter the guest name.', name);
    }
    if (cur.paid > cur.price && cur.price > 0) return fail('Paid is more than the price.', paid);
    if (cur.discount < 0) return fail('The discount cannot be negative.', discount);
    if (lastQuote && cur.discount > qGross(lastQuote)) return fail(`The discount is more than the price-list total (${money(qGross(lastQuote), currency())}).`, discount);
    for (const l of cur.extras) {
      if (l.missingOption) return fail(`Choose the option for ${l.name}.`, ex.focus(l.id));
      if (l.needsGuests) return fail(`Enter the number of guests (needed for ${l.name}).`, guests);
      if (l.badAmount) return fail(`Enter the amount for ${l.name} as a number, or leave it empty.`, ex.focus(l.id));
    }
    const tbd = cur.extras.filter((l) => l.category === 'quote' && !(l.amount > 0));
    if (approving && tbd.length) return fail(`Set the price of ${tbd.map((l) => l.name).join(', ')} (or untick ${tbd.length === 1 ? 'it' : 'them'}) before approving.`, ex.focus(tbd[0].id));
    if (cur.cleaning_fee > cur.price + cur.discount - cur.extras_total && cur.price > 0) return fail('The cleaning fee is more than the price before discount and extras.', cleaning);
    if (cur.email && !isEmail(cur.email)) return fail('Enter a valid email address, or leave it empty.', email);
    if (approving && !(cur.price > 0)) return fail('Enter the price, or press Recalculate price.', price);
    // New stay priced by the list (quote loaded and price untouched, or a direct booking with no price and no quote):
    // the server prices it and, unless a discount was typed, applies the best discount rule itself.
    const autoprice = !existing && ((priceMode === 'quote' && !!lastQuote && !priceTouched)
      || (!quoted && cur.source === 'direct' && price.value.trim() === ''));
    if (cur.discount > 0 && !(cur.price > 0) && !lastQuote && !autoprice) return fail('Enter the price, or clear the discount.', price);
    // A pending request with an email that is confirmed or declined here also emails the guest: ask first.
    const emailKind = existing?.status === 'pending' && cur.email
      ? (cur.status === 'confirmed' ? 'confirm' : cur.status === 'cancelled' ? 'decline' : null) : null;
    // Extras: priced by the server when autopricing; otherwise sent as lines (unit_price, amount) only when changed.
    const exKeyOf = (ls) => JSON.stringify(ls.map((l) => [l.id, l.qty, l.option || '', round2(l.unit_price), round2(l.amount)]));
    const sendExtras = autoprice ? (cur.extras.length ? cur.extras : undefined)
      : exKeyOf(cur.extras) !== exKeyOf(existing?.extras || []) ? cur.extras : undefined;
    if (emailKind && notifyAnswer === undefined) {
      const ans = await askEmail(emailKind, cur, { okLabel: 'Save',
        extra: emailKind === 'confirm' && !(cur.price > 0) ? h('p', { class: 'hint' }, 'No price is set: the email will say the amount follows.') : null });
      if (ans === null) return;
      notifyAnswer = ans;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const d = await actions.saveReservation(cur, force, { notify: emailKind ? notifyAnswer : undefined, autoprice, discountSet: discTyped(), extras: sendExtras });
      const n = d.conflicts.length;
      if (!(approving && d.reservation.status === 'pending')) toast(n && d.reservation.status !== 'cancelled'
        ? `Saved. Overlaps ${plural(n, 'other stay')}.`
        : emailKind && notifyAnswer ? `Saved. Emailing ${cur.email}.`
          : existing ? 'Reservation updated.'
            : autoprice && Number(d.reservation.price) > 0 ? `Reservation added at ${money(d.reservation.price, currency())} (price list${d.reservation.discount_label ? `, ${d.reservation.discount_label}` : Number(d.reservation.discount) > 0 ? ` less ${money(d.reservation.discount, currency())}` : ''}).`
              : autoprice && d.quote?.incomplete ? 'Reservation added. The price list misses some nights: set the price.' : 'Reservation added.', n ? 'warn' : 'info');
      dlg.close();
      if (approving && d.reservation.status === 'pending') approveRequest(d.reservation);
    } catch (e) {
      if (e.code === 'conflict') {
        serverConflicts = e.data?.conflicts || [];
        renderWarn(serverConflicts, true);
        warn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (e.code === 'forbidden') {
        fail(e.message || 'Only owners can confirm reservations.');
      } else {
        actions.report(e);
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = saveLabel;
    }
  }

  saveBtn.addEventListener('click', () => save(false));
  closeBtn.addEventListener('click', () => dlg.close());
  cancelBtn?.addEventListener('click', async () => {
    if (existing.status === 'pending') {
      if (await declineRequest(existing)) dlg.close();
      return;
    }
    const ok = await confirmDialog(`Cancel the stay of ${existing.guest_name || 'this guest'} (${fmtRange(existing.check_in, existing.check_out)})? It will be hidden from the calendar.`,
      { ok: 'Cancel reservation', cancel: 'Keep', danger: true, title: 'Cancel reservation' });
    if (!ok) return;
    try {
      await actions.setReservationStatus(existing.id, 'cancelled');
      toast('Reservation cancelled.');
      dlg.close();
    } catch (e) { actions.report(e); }
  });
  return dlg;
}
