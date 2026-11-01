// Reservation form: bottom sheet on phones, dialog on wide screens.
import { state, activeUnits, unitById, isOwner, currency } from '../state.js';
import { h, icon, openDialog, confirmDialog, toast } from '../ui.js';
import { addDays, diffDays, todayISO, isISODate, conflictsFor, fmtRange, fmtDateTime, money, num, plural, SOURCES, STATUSES } from '../lib.js';
import * as actions from '../actions.js';

let seq = 0;

export function conflictList(list) {
  return h('ul', { class: 'conflicts' }, list.map((c) => h('li', null,
    h('strong', null, c.guest_name || 'Unnamed'), ' · ', fmtRange(c.check_in, c.check_out),
    ' · ', unitById(c.unit_id)?.name || c.unit_id,
    h('span', { class: `badge ${c.status}` }, STATUSES[c.status] || c.status))));
}

export function openReservation(input = {}) {
  const uid = `r${++seq}`;
  const existing = input.id ? state.reservations.find((r) => r.id === input.id) || input : null;
  const owner = isOwner();
  const units = activeUnits();
  const t = todayISO();
  const r = {
    unit_id: units[0]?.id || '', check_in: t, check_out: addDays(t, 1), guest_name: '', guests: 2,
    source: 'direct', status: owner ? 'confirmed' : 'pending', price: '', paid: '', checked: false, notes: '',
    ...(existing || input),
  };
  if (!existing && r.check_out <= r.check_in) r.check_out = addDays(r.check_in, 1);

  const field = (label, control, extra) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, extra);

  // Unit: segmented control (radio group)
  const unitSeg = h('fieldset', { class: 'field' },
    h('legend', { class: 'field-label' }, 'Unit'),
    h('div', { class: 'seg' }, units.map((u) => [
      h('input', { type: 'radio', name: `${uid}-unit`, id: `${uid}-u-${u.id}`, value: u.id, checked: u.id === r.unit_id }),
      h('label', { for: `${uid}-u-${u.id}` }, h('span', { class: 'dot', style: `background:${u.color || 'var(--sea)'}` }), u.name),
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
    field('Guest name', name),
    h('div', { class: 'row2' }, field('Guests', guests, capHint), field('Source', source)),
    field('Status', status, !owner ? h('span', { class: 'hint' }, 'Only owners can confirm.') : null),
    h('div', { class: 'row2' }, field(`Price (${currency()})`, price), field('Paid', paid)),
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

  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save');
  const closeBtn = h('button', { class: 'btn', type: 'button' }, 'Close');
  const cancelBtn = existing && existing.status !== 'cancelled'
    ? h('button', { class: 'btn danger push-left', type: 'button' }, 'Cancel reservation') : null;

  const dlg = openDialog({
    title: existing ? (existing.guest_name || 'Reservation') : 'New reservation',
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
    price: num(price.value), paid: num(paid.value),
    checked: checked.checked, notes: notes.value.trim(),
  });

  let serverConflicts = null;
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
    const due = cur.price - cur.paid;
    balance.textContent = cur.price > 0 ? (due > 0 ? `Balance due ${money(due, currency())}` : 'Paid in full') : '';
    serverConflicts = null;
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
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  update();

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
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const d = await actions.saveReservation(cur, force);
      const n = d.conflicts.length;
      toast(n && d.reservation.status !== 'cancelled'
        ? `Saved. Overlaps ${plural(n, 'other stay')}.`
        : existing ? 'Reservation updated.' : 'Reservation added.', n ? 'warn' : 'info');
      dlg.close();
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
      saveBtn.textContent = 'Save';
    }
  }

  saveBtn.addEventListener('click', () => save(false));
  closeBtn.addEventListener('click', () => dlg.close());
  cancelBtn?.addEventListener('click', async () => {
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
