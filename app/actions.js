// Write operations: call the API, then update local state from the returned object.
import { call } from './api.js';
import { state, upsert, removeById, normRes, normExp, persist, emit } from './state.js';
import { toast } from './ui.js';

const RES_FIELDS = ['id', 'unit_id', 'check_in', 'check_out', 'guest_name', 'guests', 'source', 'status',
  'price', 'paid', 'checked', 'notes', 'external_uid', 'email', 'phone', 'lang', 'cleaning_fee', 'discount', 'discount_label'];
const EXP_FIELDS = ['id', 'date', 'category', 'amount', 'unit_id', 'paid_by', 'receipt_url', 'notes'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * opts.notify (boolean): guest email on pending → confirmed/cancelled; omitted = server default (send).
 * opts.autoprice: let the server fill price and cleaning_fee from the price list (sent as false otherwise).
 * opts.discountSet: the owner typed a discount (0 included). When autopricing without one, `discount` and
 *   `discount_label` are omitted so the server applies the best discount rule (API.md); with one, the owner's
 *   value wins and the label is left for the server to clear.
 */
export async function saveReservation(reservation, force = false, opts = {}) {
  const payload = { reservation: pick(reservation, RES_FIELDS) };
  if (!payload.reservation.id) delete payload.reservation.id;
  // Always explicit: the server defaults to repricing new direct stays with price 0.
  payload.autoprice = !!opts.autoprice;
  if (opts.autoprice) {
    delete payload.reservation.price;
    delete payload.reservation.cleaning_fee;
    delete payload.reservation.discount_label;
    if (!opts.discountSet) delete payload.reservation.discount;
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

/** Price-list quote: { nights, nightly:[{date,price}], accommodation, cleaning_fee, rule_discount, rule_name, rule_percent,
 *  total (net of rule_discount), currency, incomplete, min_nights, below_min } */
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

// ---- Owner pricing (getPricing / savePrices / saveDiscounts / saveCleaningFees all return the getPricing payload) ----
/** Keep bootstrap's copy (price list and cleaning-fee settings) in step with a pricing payload. */
function syncPricing(p) {
  if (!p) return p;
  if (Array.isArray(p.prices)) state.prices = p.prices;
  const cf = p.cleaning_fees;
  if (cf) {
    const s = { ...state.settings };
    for (const k of Object.keys(s)) if (/^cleaning_fee_/.test(k) && k !== 'cleaning_fee_maisonette' && k !== 'cleaning_fee_studio') delete s[k];
    s.cleaning_fee_maisonette = String(cf.maisonette ?? '');
    s.cleaning_fee_studio = String(cf.studio ?? '');
    for (const [id, v] of Object.entries(cf.per_unit || {})) s[`cleaning_fee_${id}`] = String(v);
    state.settings = s;
  }
  persist();
  emit();
  return p;
}
export const getPricing = () => call('getPricing', {});
export const savePrices = (rows) => call('savePrices', { rows }).then(syncPricing);
export const saveDiscounts = (rows) => call('saveDiscounts', { rows }).then(syncPricing);
export const saveCleaningFees = (fees) => call('saveCleaningFees', fees).then(syncPricing);

/** Surface an API error as a toast (sign-in errors are handled by the app shell). */
export function report(err) {
  if (!err || err.code === 'unauthorized') return;
  if (err.code === 'network') toast('Offline: not saved. Try again when connected.', 'error');
  else toast(err.message || 'Something went wrong.', 'error');
}
