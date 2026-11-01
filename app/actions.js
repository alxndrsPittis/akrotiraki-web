// Write operations: call the API, then update local state from the returned object.
import { call } from './api.js';
import { upsert, removeById, normRes, normExp } from './state.js';
import { toast } from './ui.js';

const RES_FIELDS = ['id', 'unit_id', 'check_in', 'check_out', 'guest_name', 'guests', 'source', 'status',
  'price', 'paid', 'checked', 'notes', 'external_uid', 'email', 'phone', 'lang', 'cleaning_fee', 'discount'];
const EXP_FIELDS = ['id', 'date', 'category', 'amount', 'unit_id', 'paid_by', 'receipt_url', 'notes'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * opts.notify (boolean): guest email on pending → confirmed/cancelled; omitted = server default (send).
 * opts.autoprice: let the server fill price and cleaning_fee from the price list (sent as false otherwise);
 *   the server then sets price = quote total − discount, so discount is still sent.
 */
export async function saveReservation(reservation, force = false, opts = {}) {
  const payload = { reservation: pick(reservation, RES_FIELDS) };
  if (!payload.reservation.id) delete payload.reservation.id;
  // Always explicit: the server defaults to repricing new direct stays with price 0.
  payload.autoprice = !!opts.autoprice;
  if (opts.autoprice) {
    delete payload.reservation.price;
    delete payload.reservation.cleaning_fee;
  }
  if (force) payload.force = true;
  if (typeof opts.notify === 'boolean') payload.notify = opts.notify;
  const d = await call('saveReservation', payload);
  upsert('reservations', normRes(d.reservation));
  return { reservation: d.reservation, conflicts: d.conflicts || [], quote: d.quote || null };
}

export async function setReservationStatus(id, status, { force = false, notify } = {}) {
  const payload = { id, status };
  if (force) payload.force = true;
  if (typeof notify === 'boolean') payload.notify = notify;
  const d = await call('setReservationStatus', payload);
  upsert('reservations', normRes(d.reservation));
  return { reservation: d.reservation, conflicts: d.conflicts || [] };
}

/** Price-list quote: { nights, nightly:[{date,price}], accommodation, cleaning_fee, total, currency, incomplete, min_nights, below_min } */
export function quoteFor(unit_id, check_in, check_out) {
  return call('quoteFor', { unit_id, check_in, check_out });
}

export async function saveExpense(expense) {
  const payload = { expense: pick(expense, EXP_FIELDS) };
  if (!payload.expense.id) delete payload.expense.id;
  const d = await call('saveExpense', payload);
  upsert('expenses', normExp(d.expense));
  return d.expense;
}

export async function deleteExpense(id) {
  await call('deleteExpense', { id });
  removeById('expenses', id);
}

export function uploadReceipt(filename, mimeType, base64) {
  return call('uploadReceipt', { filename, mimeType, base64 });
}

/** Surface an API error as a toast (sign-in errors are handled by the app shell). */
export function report(err) {
  if (!err || err.code === 'unauthorized') return;
  if (err.code === 'network') toast('Offline: not saved. Try again when connected.', 'error');
  else toast(err.message || 'Something went wrong.', 'error');
}
