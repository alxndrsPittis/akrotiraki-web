// Write operations: call the API, then update local state from the returned object.
import { call } from './api.js';
import { upsert, removeById, normRes, normExp } from './state.js';
import { toast } from './ui.js';

const RES_FIELDS = ['id', 'unit_id', 'check_in', 'check_out', 'guest_name', 'guests', 'source', 'status',
  'price', 'paid', 'checked', 'notes', 'external_uid'];
const EXP_FIELDS = ['id', 'date', 'category', 'amount', 'unit_id', 'paid_by', 'receipt_url', 'notes'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export async function saveReservation(reservation, force = false) {
  const payload = { reservation: pick(reservation, RES_FIELDS) };
  if (!payload.reservation.id) delete payload.reservation.id;
  if (force) payload.force = true;
  const d = await call('saveReservation', payload);
  upsert('reservations', normRes(d.reservation));
  return { reservation: d.reservation, conflicts: d.conflicts || [] };
}

export async function setReservationStatus(id, status) {
  const d = await call('setReservationStatus', { id, status });
  upsert('reservations', normRes(d.reservation));
  return { reservation: d.reservation, conflicts: d.conflicts || [] };
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
