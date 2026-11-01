// Write operations: call the API, then update local state from the returned object.
import { call } from './api.js';
import { state, upsert, upsertMany, removeById, normRes, normExp, persist, emit } from './state.js';
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
 * opts.extras: send the booked extras (omitted = stored extras unchanged). With autoprice, lines
 *   {id, qty, option?, amount? (quote extras with amountSet)} are priced by the server; otherwise they are stored as
 *   given and must carry unit_price and amount (the form keeps price consistent).
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
  if (Array.isArray(opts.extras)) {
    payload.reservation.extras = opts.extras.map((l) => {
      const o = { id: l.id, qty: l.qty };
      if (l.option) o.option = l.option;
      if (opts.autoprice) { if (l.category === 'quote' && l.amountSet) o.amount = l.amount; }
      else { o.unit_price = l.unit_price; o.amount = l.amount; }
      return o;
    });
  }
  if (force) payload.force = true;
  if (typeof opts.notify === 'boolean') payload.notify = opts.notify;
  const d = await call('saveReservation', payload);
  upsert('reservations', normRes(d.reservation));
  return { reservation: d.reservation, conflicts: d.conflicts || [], quote: d.quote || null };
}

/** applyToGroup: the status goes to every reservation with this one's group_id (all or nothing, ONE guest email);
 *  the reply's `reservations` (the whole group) replace the local copies. */
export async function setReservationStatus(id, status, { force = false, notify, applyToGroup = false } = {}) {
  const payload = { id, status };
  if (force) payload.force = true;
  if (typeof notify === 'boolean') payload.notify = notify;
  if (applyToGroup) payload.apply_to_group = true;
  const d = await call('setReservationStatus', payload);
  const list = Array.isArray(d.reservations) && d.reservations.length ? d.reservations : [d.reservation];
  upsertMany('reservations', list.map(normRes));
  return { reservation: d.reservation, reservations: list, conflicts: d.conflicts || [] };
}

/** Price-list quote: { nights, nightly:[{date,price}], accommodation, cleaning_fee, rule_discount, rule_name, rule_percent,
 *  extras:[{id,name,category,kind,option,qty,unit_price,amount}], extras_total,
 *  total (net of rule_discount, extras included), currency, incomplete, min_nights, below_min }
 *  extras: form lines {id, qty, option, category, amount, amountSet}; amount is sent only for quote extras with an agreed price. */
export function quoteFor(unit_id, check_in, check_out, { extras, guests } = {}) {
  const p = { unit_id, check_in, check_out };
  if (extras?.length) {
    p.extras = extras.map((l) => {
      const o = { id: l.id, qty: l.qty };
      if (l.option) o.option = l.option;
      if (l.category === 'quote' && l.amountSet) o.amount = l.amount;
      return o;
    });
    p.guests = guests ?? 0;
  }
  return call('quoteFor', p);
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
  if (Array.isArray(p.extras)) state.extras = p.extras;
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
export const saveExtras = (rows) => call('saveExtras', { rows }).then(syncPricing);
export const saveCleaningFees = (fees) => call('saveCleaningFees', fees).then(syncPricing);

/** Surface an API error as a toast (sign-in errors are handled by the app shell). */
export function report(err) {
  if (!err || err.code === 'unauthorized') return;
  if (err.code === 'network') toast('Offline: not saved. Try again when connected.', 'error');
  else toast(err.message || 'Something went wrong.', 'error');
}
