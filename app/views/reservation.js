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

/** Price lines for a stay: accommodation + cleaning = total, deposit. Empty when there is no price. */
export function priceBreakdown(r, { deposit = true } = {}) {
  const cur = currency();
  const price = Number(r.price) || 0;
  if (!(price > 0)) return null;
  const fee = Math.min(Number(r.cleaning_fee) || 0, price);
  const pct = depositPercent();
  const row = (k, v, cls = '') => [h('dt', { class: cls }, k), h('dd', { class: `num ${cls}` }, v)];
  return h('dl', { class: 'breakdown' },
    fee > 0 ? [row('Accommodation', money(round2(price - fee), cur)), row('Cleaning fee', money(fee, cur))] : null,
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
    email: '', phone: '', lang: 'en', cleaning_fee: '',
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
  const email = h('input', { type: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'email', maxlength: 254, value: r.email || '' });
  const phone = h('input', { type: 'tel', autocomplete: 'off', maxlength: 40, value: r.phone || '' });
  const lang = h('select', { value: LANGS[r.lang] ? r.lang : 'en' }, Object.entries(LANGS).map(([k, v]) => h('option', { value: k }, v)));
  const recalcBtn = h('button', { class: 'btn sm', type: 'button' }, icon('calc'), 'Recalculate price');
  const quoteOut = h('div', { class: 'quote', 'aria-live': 'polite' });
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
    h('div', { class: 'row2' }, field(`Price, total (${currency()})`, price), field('of which cleaning', cleaning)),
    h('div', { class: 'quote-row' }, quoteOut, recalcBtn),
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
    price: num(price.value), paid: num(paid.value), cleaning_fee: num(cleaning.value),
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

  // ---- Price list quote ----
  // New reservations (and requests being priced for approval) quote automatically until the user types a price.
  const autoQuote = !existing || (approving && !(existing.price > 0));
  let priceTouched = !autoQuote;
  let quoted = false;
  let qSeq = 0, qTimer = 0;
  const cur$ = () => currency();
  price.addEventListener('input', () => { priceTouched = true; });
  cleaning.addEventListener('input', () => { priceTouched = true; });

  function renderQuote(q) {
    const c = q.currency || cur$();
    const rates = (q.nightly || []).map((x) => Number(x.price)).filter((p) => p > 0);
    const lo = Math.min(...rates), hi = Math.max(...rates);
    const per = rates.length ? ` (${lo === hi ? money(lo, c) : `${money(lo, c)}–${money(hi, c)}`}/night)` : '';
    const missing = (q.nightly || []).filter((x) => x.price == null).length;
    quoteOut.replaceChildren(...[
      q.incomplete
        ? h('p', { class: 'bad' }, `No rate in the price list for ${plural(missing, 'night')} of ${q.nights}. Enter the price by hand, or add the rates to the Prices tab.`)
        : h('p', null, `${plural(q.nights, 'night')} ${money(q.accommodation, c)}${per}${q.cleaning_fee ? ` + cleaning ${money(q.cleaning_fee, c)}` : ''} = `, h('strong', null, money(q.total, c))),
      q.below_min ? h('p', { class: 'bad' }, `Shorter than the minimum stay of ${plural(Number(q.min_nights) || 0, 'night')} for these dates.`) : null,
    ].filter(Boolean));
  }

  async function runQuote(manual) {
    const cur = read();
    if (!cur.unit_id || !isISODate(cur.check_in) || !isISODate(cur.check_out) || cur.check_out <= cur.check_in) {
      if (manual) quoteOut.replaceChildren(h('p', { class: 'bad' }, 'Choose the unit and valid dates first.'));
      return;
    }
    const my = ++qSeq;
    recalcBtn.disabled = true;
    quoteOut.replaceChildren(h('p', { class: 'hint' }, 'Getting the price…'));
    try {
      const q = await actions.quoteFor(cur.unit_id, cur.check_in, cur.check_out);
      if (my !== qSeq || !dlg.isConnected) return;
      // An incomplete quote only covers the priced nights: never use its total.
      if (!q.incomplete && (manual || !priceTouched)) {
        price.value = q.total ? String(q.total) : '';
        cleaning.value = q.cleaning_fee ? String(q.cleaning_fee) : '';
        priceTouched = false;
        quoted = true;
      }
      renderQuote(q);
      update();
    } catch (e) {
      if (my !== qSeq) return;
      quoteOut.replaceChildren(h('p', { class: manual ? 'bad' : 'hint' },
        e.code === 'network' ? 'Offline: no price list quote.' : manual ? (e.message || 'Could not get a quote.') : 'No automatic price. Enter it, or press Recalculate.'));
    } finally {
      if (my === qSeq) recalcBtn.disabled = false;
    }
  }
  function scheduleQuote() {
    if (!autoQuote || priceTouched) return;
    if (source.value === 'family' || source.value === 'block') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => runQuote(false), 300);
  }
  recalcBtn.addEventListener('click', () => runQuote(true));
  form.addEventListener('change', (e) => {
    if (e.target === ci || e.target === co || e.target === source || e.target.name === `${uid}-unit`) scheduleQuote();
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
    if (cur.cleaning_fee > cur.price && cur.price > 0) return fail('The cleaning fee is more than the total price.', cleaning);
    if (cur.email && !isEmail(cur.email)) return fail('Enter a valid email address, or leave it empty.', email);
    if (approving && !(cur.price > 0)) return fail('Enter the price, or press Recalculate price.', price);
    // A pending request with an email that is confirmed or declined here also emails the guest: ask first.
    const emailKind = existing?.status === 'pending' && cur.email
      ? (cur.status === 'confirmed' ? 'confirm' : cur.status === 'cancelled' ? 'decline' : null) : null;
    if (emailKind && notifyAnswer === undefined) {
      const ans = await askEmail(emailKind, cur, { okLabel: 'Save',
        extra: emailKind === 'confirm' && !(cur.price > 0) ? h('p', { class: 'hint' }, 'No price is set: the email will say the amount follows.') : null });
      if (ans === null) return;
      notifyAnswer = ans;
    }
    // New direct booking with no price typed and no quote: let the server price it from the list.
    const autoprice = !existing && !quoted && cur.source === 'direct' && price.value.trim() === '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const d = await actions.saveReservation(cur, force, { notify: emailKind ? notifyAnswer : undefined, autoprice });
      const n = d.conflicts.length;
      if (!(approving && d.reservation.status === 'pending')) toast(n && d.reservation.status !== 'cancelled'
        ? `Saved. Overlaps ${plural(n, 'other stay')}.`
        : emailKind && notifyAnswer ? `Saved. Emailing ${cur.email}.`
          : existing ? 'Reservation updated.'
            : autoprice && Number(d.reservation.price) > 0 ? `Reservation added at ${money(d.reservation.price, currency())} (price list).`
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
