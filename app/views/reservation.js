// Reservation form: bottom sheet on phones, dialog on wide screens.
import { state, activeUnits, unitById, isOwner, currency, depositPercent } from '../state.js';
import { h, icon, openDialog, confirmDialog, toast } from '../ui.js';
import { addDays, diffDays, todayISO, isISODate, conflictsFor, fmtRange, fmtDateTime, money, num, plural, round2,
  depositOf, isEmail, SOURCES, STATUSES, LANGS } from '../lib.js';
import * as actions from '../actions.js';

let seq = 0;

export function conflictList(list) {
  return h('ul', { class: 'conflicts' }, list.map((c) => h('li', null,
    h('strong', null, c.guest_name || 'Unnamed'), ' · ', fmtRange(c.check_in, c.check_out),
    ' · ', unitById(c.unit_id)?.name || c.unit_id,
    h('span', { class: `badge ${c.status}` }, STATUSES[c.status] || c.status))));
}

/**
 * Price lines for a stay: accommodation + cleaning − discount = total (what the guest pays), deposit on that total.
 * price is net of the discount (API.md), so accommodation = price + discount − cleaning. Empty when there is no price.
 * full: always show the accommodation line (the form), not only when there is something to split.
 */
export function priceBreakdown(r, { deposit = true, full = false } = {}) {
  const cur = currency();
  const price = Number(r.price) || 0;
  if (!(price > 0)) return null;
  const disc = Math.max(0, Number(r.discount) || 0);
  const fee = Math.min(Math.max(0, Number(r.cleaning_fee) || 0), price + disc);
  const pct = depositPercent();
  const row = (k, v, cls = '') => [h('dt', { class: cls }, k), h('dd', { class: `num ${cls}` }, v)];
  return h('dl', { class: 'breakdown' },
    full || fee > 0 || disc > 0 ? row('Accommodation', money(round2(price + disc - fee), cur)) : null,
    fee > 0 ? row('Cleaning fee', money(fee, cur)) : null,
    disc > 0 ? row('Discount', h('span', { 'aria-label': `minus ${money(disc, cur)}` }, `−${money(disc, cur)}`), 'disc') : null,
    row('Total', money(price, cur), 'total'),
    deposit ? row(`Deposit ${pct}%`, money(depositOf(price, pct), cur), 'dep') : null);
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
  if (!(r.price > 0)) { openReservation(r, { intent: 'approve' }); return false; }
  const conf = conflictsFor({ ...r, status: 'confirmed' }, state.reservations);
  const extra = h('div', { class: 'dlg-extra' },
    h('p', { class: 'hint' }, `${r.guest_name || 'Unnamed'} · ${stayLine(r)}`),
    priceBreakdown(r),
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

  const form = h('form', { class: 'form', novalidate: true },
    unitSeg,
    h('div', { class: 'row2' }, field('Check-in', ci), field('Check-out', co)),
    nightsOut,
    warn,
    approving ? h('p', { class: 'info-note' }, 'Set the price before approving: the confirmation email shows it with the deposit.') : null,
    field('Guest name', name),
    h('div', { class: 'row2' }, field('Guests', guests, capHint), field('Source', source)),
    field('Email', email, h('span', { class: 'hint' }, 'Optional. Requests from the website have one.')),
    h('div', { class: 'row2' }, field('Phone', phone), field('Language', lang)),
    field('Status', status, !owner ? h('span', { class: 'hint' }, 'Only owners can confirm.') : null),
    h('div', { class: 'row3 price-fields' }, field(`Price, total (${currency()})`, price, priceNote),
      field('of which cleaning', cleaning), field('Discount', discount, discHint)),
    h('div', { class: 'quote-row' }, quoteInfo, recalcBtn),
    breakOut,
    h('div', { class: 'row2' }, field('Paid', paid), h('div')),
    balance,
    h('div', { class: 'switch-row' },
      h('label', { for: `${uid}-chk` }, 'Verified on Airbnb/Booking',
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

  const read = () => ({
    ...(existing || {}),
    unit_id: form.querySelector(`input[name="${uid}-unit"]:checked`)?.value || '',
    check_in: ci.value, check_out: co.value,
    guest_name: name.value.trim(),
    guests: Math.max(0, Math.round(num(guests.value))),
    source: source.value, status: status.value,
    price: num(price.value), paid: num(paid.value), cleaning_fee: num(cleaning.value), discount: num(discount.value),
    email: email.value.trim(), phone: phone.value.trim(), lang: lang.value,
    checked: checked.checked, notes: notes.value.trim(),
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
  let gross = existing && existing.price > 0 ? round2(existing.price + (Number(existing.discount) || 0)) : null;
  let priceMode = gross != null ? 'base' : null; // 'quote' | 'base' | 'manual' | null
  let qSeq = 0, qTimer = 0;
  const cur$ = () => currency();
  const discVal = () => Math.max(0, num(discount.value));
  const setPrice = (v) => { price.value = v > 0 ? String(round2(v)) : ''; };

  price.addEventListener('input', () => { priceTouched = true; priceMode = 'manual'; gross = null; });
  cleaning.addEventListener('input', () => { priceTouched = true; });
  discount.addEventListener('input', () => {
    if (lastQuote) {
      // A quote is loaded: the price becomes the price-list total less the discount again.
      gross = lastQuote.total;
      setPrice(gross - discVal());
      cleaning.value = lastQuote.cleaning_fee ? String(lastQuote.cleaning_fee) : '';
      priceTouched = false;
      quoted = true;
      priceMode = 'quote';
    } else if (priceMode === 'base' && gross != null) {
      setPrice(gross - discVal());
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
        : h('p', null, `Price list: ${plural(q.nights, 'night')}${per}, `, h('strong', null, money(q.total, c)), q.cleaning_fee ? ' with cleaning' : ''),
      q.below_min ? h('p', { class: 'bad' }, `Shorter than the minimum stay of ${plural(Number(q.min_nights) || 0, 'night')} for these dates.`) : null,
    ].filter(Boolean));
  }

  /** Breakdown of the form values, price source note and discount check. Called from update(). */
  function renderPriceInfo(cur) {
    const c = cur$();
    const d = Math.max(0, cur.discount);
    const fromList = priceMode === 'quote' && lastQuote;
    priceNote.textContent = !(cur.price > 0) ? ''
      : fromList ? (d > 0 ? `Price list ${money(lastQuote.total, c)} − discount` : 'From the price list')
        : priceMode === 'base' && d > 0 && gross != null ? `${money(gross, c)} − discount`
          : priceMode === 'manual' ? (d > 0 ? 'Entered by hand, after discount' : 'Entered by hand') : '';
    priceNote.classList.toggle('auto', !!fromList);
    let dErr = '';
    if (cur.discount < 0) dErr = 'Cannot be negative.';
    else if (lastQuote && d > lastQuote.total) dErr = `More than the price-list total ${money(lastQuote.total, c)}.`;
    discHint.textContent = dErr;
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
      const q = await actions.quoteFor(cur.unit_id, cur.check_in, cur.check_out);
      if (my !== qSeq || !dlg.isConnected) return;
      // An incomplete quote only covers the priced nights: never use its total.
      lastQuote = q.incomplete ? null : q;
      if (!q.incomplete && (manual || !priceTouched)) {
        gross = q.total;
        setPrice(q.total - discVal());
        cleaning.value = q.cleaning_fee ? String(q.cleaning_fee) : '';
        priceTouched = false;
        quoted = true;
        priceMode = 'quote';
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
    if (dates) invalidateQuote();
    if (dates || e.target === source) scheduleQuote();
  });

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  update();
  scheduleQuote();

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
    if (lastQuote && cur.discount > lastQuote.total) return fail(`The discount is more than the price-list total (${money(lastQuote.total, currency())}).`, discount);
    if (cur.cleaning_fee > cur.price + cur.discount && cur.price > 0) return fail('The cleaning fee is more than the price before discount.', cleaning);
    if (cur.email && !isEmail(cur.email)) return fail('Enter a valid email address, or leave it empty.', email);
    if (approving && !(cur.price > 0)) return fail('Enter the price, or press Recalculate price.', price);
    // New direct booking with no price typed and no quote: let the server price it from the list (total − discount).
    const autoprice = !existing && !quoted && cur.source === 'direct' && price.value.trim() === '';
    if (cur.discount > 0 && !(cur.price > 0) && !lastQuote && !autoprice) return fail('Enter the price, or clear the discount.', price);
    // A pending request with an email that is confirmed or declined here also emails the guest: ask first.
    const emailKind = existing?.status === 'pending' && cur.email
      ? (cur.status === 'confirmed' ? 'confirm' : cur.status === 'cancelled' ? 'decline' : null) : null;
    if (emailKind && notifyAnswer === undefined) {
      const ans = await askEmail(emailKind, cur, { okLabel: 'Save',
        extra: emailKind === 'confirm' && !(cur.price > 0) ? h('p', { class: 'hint' }, 'No price is set: the email will say the amount follows.') : null });
      if (ans === null) return;
      notifyAnswer = ans;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const d = await actions.saveReservation(cur, force, { notify: emailKind ? notifyAnswer : undefined, autoprice });
      const n = d.conflicts.length;
      if (!(approving && d.reservation.status === 'pending')) toast(n && d.reservation.status !== 'cancelled'
        ? `Saved. Overlaps ${plural(n, 'other stay')}.`
        : emailKind && notifyAnswer ? `Saved. Emailing ${cur.email}.`
          : existing ? 'Reservation updated.'
            : autoprice && Number(d.reservation.price) > 0 ? `Reservation added at ${money(d.reservation.price, currency())} (price list${cur.discount > 0 ? ` less ${money(cur.discount, currency())}` : ''}).`
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
