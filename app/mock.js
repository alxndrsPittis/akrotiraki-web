// In-memory fake backend implementing the API.md actions with sample data.
// Used when config.API_URL is empty, config.MOCK is true, or the URL has ?mock=1.
import { addDays, diffDays, todayISO, isISODate, conflictsFor, isEmail, round2, SOURCES, STATUSES, CATEGORIES, LANGS, pad } from './lib.js';
import { computeTotals } from './calc.js';
import { decodeJwt } from './auth.js';

const UNITS = [
  { id: 'u1', name: 'Thalassa', type: 'maisonette', capacity: 5, color: '#1f5f8b', active: true },
  { id: 'u2', name: 'Ammos', type: 'maisonette', capacity: 4, color: '#c9a46b', active: true },
  { id: 'u3', name: 'Petra', type: 'studio', capacity: 2, color: '#7d9a78', active: true },
  { id: 'u4', name: 'Ilios', type: 'studio', capacity: 2, color: '#b8735a', active: true },
];
const GUESTS = ['Sophie Laurent', 'Lukas Becker', 'Emma Johansson', 'Marco Rossi', 'Chloé Martin', 'Daniel Novak',
  'Hannah Weber', 'James Whitfield', 'Elena Papadaki', 'Nikos Georgiou', 'Isabella García', 'Thomas Müller',
  'Anna Kowalska', 'Oliver Smith', 'Lucía Fernández', 'Matteo Bianchi', 'Sarah Cohen', 'Pieter de Vries',
  'Yuki Tanaka', 'Claire Dubois', 'Jonas Lindqvist', 'Maya Patel', 'Felix Hoffmann', 'Giulia Conti', 'Ethan Brooks'];
const PAYERS = ['Owner (demo)', 'Maria', 'Giorgos'];
const SETTINGS = {
  season_start: '05-01', season_end: '10-31', currency: 'EUR',
  cleaning_fee_maisonette: '30', cleaning_fee_studio: '20', deposit_percent: '30', // Settings arrive as strings
  site_url: 'https://alxndrspittis.github.io/akrotiraki-web/',
  cleaning_fee_u1: '35', // per-unit override (Thalassa is the largest)
  sheet_url: 'https://docs.google.com/spreadsheets/d/DEMO/edit', // optional link to the analysis sheet
};
// Price list (Prices tab). from/to inclusive. 20–31 Dec is deliberately unpriced to show an incomplete quote.
function makePrices() {
  const Y = +todayISO().slice(0, 4);
  const bands = [['01-01', '04-30', 120, 70, 3, 'Low season'], ['05-01', '06-30', 160, 95, 3, 'Shoulder'],
    ['07-01', '08-31', 220, 130, 5, 'High season'], ['09-01', '10-31', 160, 95, 3, 'Shoulder'], ['11-01', '12-19', 120, 70, 3, 'Low season']];
  const rows = [];
  for (const y of [Y - 1, Y, Y + 1]) {
    for (const [f, t, pm, ps, min, notes] of bands) {
      rows.push({ unit_type: 'maisonette', from: `${y}-${f}`, to: `${y}-${t}`, price_per_night: pm, min_nights: min, notes });
      rows.push({ unit_type: 'studio', from: `${y}-${f}`, to: `${y}-${t}`, price_per_night: ps, min_nights: min, notes });
    }
    // Per-unit override (unit_id set): Thalassa sleeps 5, so it costs more in high season.
    rows.push({ unit_type: '', unit_id: 'u1', from: `${y}-07-01`, to: `${y}-08-31`, price_per_night: 240, min_nights: 5, notes: 'Thalassa, high season' });
  }
  return rows;
}
let PRICES = makePrices();
// Discount rules (Discounts tab). One active rule, plus inactive examples of the other kinds.
let DISCOUNTS = [
  { id: 'd1', name: 'Long stay 7+ nights', kind: 'long_stay', percent: 10, min_nights: 7, days_before: '', from: '', to: '', unit_type: '', unit_id: '', active: true, notes: '' },
  { id: 'd2', name: 'Early booking', kind: 'early_booking', percent: 5, min_nights: '', days_before: 120, from: '', to: '', unit_type: '', unit_id: '', active: false, notes: 'Try next season' },
  { id: 'd3', name: 'Late October', kind: 'period', percent: 15, min_nights: '', days_before: '', from: `${+todayISO().slice(0, 4) + 1}-10-15`, to: `${+todayISO().slice(0, 4) + 1}-10-31`, unit_type: 'studio', unit_id: '', active: false, notes: '' },
];
const KINDS = ['long_stay', 'early_booking', 'last_minute', 'period'];
const isWhole = (v) => v === '' || v == null || (Number.isInteger(Number(v)) && Number(v) >= 0);
const usable = (d) => KINDS.includes(d.kind) && Number(d.percent) > 0 && Number(d.percent) <= 100 &&
  (!d.from === !d.to) && (!d.from || (isISODate(d.from) && isISODate(d.to) && d.from <= d.to)) &&
  !(d.kind === 'period' && !d.from) && !(d.kind === 'long_stay' && !(Number(d.min_nights) >= 1)) &&
  !((d.kind === 'early_booking' || d.kind === 'last_minute') && (d.days_before === '' || d.days_before == null));
const typeFee = (u) => {
  const own = SETTINGS[`cleaning_fee_${u.id}`];
  return own !== undefined && own !== '' ? Number(own) || 0 : Number(SETTINGS[`cleaning_fee_${u.type}`]) || 0;
};
/** Best applicable rule (API.md "Best rule"): highest amount, earlier row on a tie, no stacking. */
function bestRule(u, nightly, check_in) {
  const T = todayISO();
  const lead = diffDays(T, check_in);
  let best = null;
  for (const d of DISCOUNTS) {
    if (d.active !== true || !usable(d)) continue;
    if (d.unit_type && String(d.unit_type).toLowerCase() !== u.type) continue;
    if (d.unit_id && String(d.unit_id).toLowerCase() !== u.id.toLowerCase()) continue;
    if (d.kind === 'long_stay' && nightly.length < Number(d.min_nights)) continue;
    if (d.kind === 'early_booking' && lead < Number(d.days_before)) continue;
    if (d.kind === 'last_minute' && !(lead >= 0 && lead <= Number(d.days_before))) continue;
    const base = nightly.filter((n) => n.price != null && (!d.from || (n.date >= d.from && n.date <= d.to))).reduce((s, n) => s + n.price, 0);
    const amount = round2(base * Number(d.percent) / 100);
    if (amount > 0 && (!best || amount > best.amount)) best = { amount, name: d.name, percent: Number(d.percent) };
  }
  return best;
}

/** Same shape as the backend quoteFor. Missing nights count 0 and mark the quote incomplete.
 *  A row with unit_id applies to that unit only and wins over the unit_type rows. */
function quote(unit_id, check_in, check_out) {
  const u = UNITS.find((x) => x.id === unit_id);
  const nightly = [];
  let min = 0;
  for (let d = check_in; d < check_out; d = addDays(d, 1)) {
    const covers = (p) => p.from <= d && d <= p.to && p.price_per_night > 0;
    const row = PRICES.findLast((p) => p.unit_id === unit_id && covers(p))
      || PRICES.findLast((p) => !p.unit_id && String(p.unit_type || '').toLowerCase() === u.type && covers(p));
    nightly.push({ date: d, price: row ? row.price_per_night : null });
    if (row) min = Math.max(min, Number(row.min_nights) || 0);
  }
  const accommodation = round2(nightly.reduce((s, n) => s + (n.price || 0), 0));
  const cleaning_fee = typeFee(u);
  const rule = bestRule(u, nightly, check_in);
  const rule_discount = rule ? rule.amount : 0;
  return {
    nights: nightly.length, nightly, accommodation, cleaning_fee,
    rule_discount, rule_name: rule ? rule.name : null, rule_percent: rule ? rule.percent : 0,
    total: round2(accommodation + cleaning_fee - rule_discount),
    currency: SETTINGS.currency, incomplete: nightly.some((n) => n.price == null), min_nights: min, below_min: nightly.length < min,
  };
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let db = null;
let seq = 1000;

function seed() {
  const R = rng(20260501);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = (a) => a[Math.floor(R() * a.length)];
  const T = todayISO();
  const Y = +T.slice(0, 4);
  const reservations = [];
  let gi = 0, id = 1;
  const stamp = (d) => `${d}T09:${pad(ri(10, 59))}:00.000Z`;

  const mk = (o) => {
    const u = UNITS.find((x) => x.id === o.unit_id);
    const r0 = { id: `r${pad(id)}`, unit_id: o.unit_id, check_in: o.check_in, check_out: o.check_out, status: o.status };
    if (o.status === 'confirmed' && conflictsFor(r0, reservations).length) return null; // keep sample data consistent
    id++;
    const nights = diffDays(o.check_in, o.check_out);
    const free = o.source === 'family' || o.source === 'block';
    const rate = u.type === 'maisonette' ? ri(15, 22) * 10 : ri(8, 12) * 10;
    const fee = free ? 0 : Number(SETTINGS[`cleaning_fee_${u.type}`]);
    let price = free ? 0 : nights * rate + fee;
    let cleaning_fee = fee;
    let discount = 0, discount_label = '';
    if (o.priced === 'quote') {
      const q = quote(o.unit_id, o.check_in, o.check_out);
      price = round2(q.accommodation + q.cleaning_fee);
      cleaning_fee = q.cleaning_fee;
      if (!o.discount && q.rule_discount > 0) { discount = q.rule_discount; discount_label = `${q.rule_name}, ${q.rule_percent}%`; }
    } else if (o.priced === false) { price = 0; cleaning_fee = 0; }
    else if (o.source === 'direct' && nights >= 7 && !o.discount) {
      discount = round2(nights * rate * 0.1); discount_label = 'Long stay 7+ nights, 10%'; // booked under the rule
    }
    if (o.discount && price > 0) discount = Math.min(o.discount, price); // price = accommodation + cleaning − discount
    price = round2(price - discount);
    const past = o.check_in <= T;
    const created = addDays(o.check_in, -ri(15, 90));
    const r = {
      ...r0,
      guest_name: o.guest_name ?? GUESTS[gi++ % GUESTS.length],
      guests: o.source === 'block' ? 0 : ri(1, u.capacity),
      source: o.source,
      price,
      paid: o.status === 'confirmed' ? (past ? price : Math.round(price * 0.3)) : 0,
      checked: (o.source === 'airbnb' || o.source === 'booking') && o.status !== 'pending' && (past || R() < 0.5),
      notes: o.notes || '',
      external_uid: o.source === 'airbnb' || o.source === 'booking' ? `${o.source}-${id}@mock` : '',
      created_at: stamp(created),
      updated_at: o.status === 'cancelled' ? stamp(addDays(T, -ri(2, 20))) : stamp(created),
      created_by: 'owner@example.com',
      cleaning_fee, discount, discount_label, email: '', phone: '', lang: '',
      ...o.extra,
    };
    if (o.hoursAgo != null) r.created_at = r.updated_at = new Date(Date.now() - o.hoursAgo * 3600e3).toISOString();
    reservations.push(r);
    return r;
  };

  // Season stays: five per unit between mid-May and early October.
  const special = { 'u2:2': { source: 'family', guest_name: 'Family: Eleni & kids', notes: 'Bring extra towels.' },
    'u4:1': { source: 'block', guest_name: 'Maintenance', notes: 'Painting the terrace.' },
    'u1:3': { status: 'cancelled' }, 'u3:2': { status: 'cancelled' } };
  // Five ~30-day slots from mid-May; one stay of 4-9 nights in each.
  for (const u of UNITS) {
    for (let n = 0; n < 5; n++) {
      const d = addDays(`${Y}-05-12`, n * 30 + ri(0, 14));
      const co = addDays(d, ri(4, 9));
      const x = R();
      mk({ unit_id: u.id, check_in: d, check_out: co, source: x < 0.45 ? 'airbnb' : x < 0.8 ? 'booking' : 'direct', status: 'confirmed', ...special[`${u.id}:${n}`] });
    }
  }
  // Around today, so the current month has something to show.
  mk({ unit_id: 'u2', check_in: addDays(T, -2), check_out: addDays(T, 3), source: 'booking', status: 'confirmed' });
  mk({ unit_id: 'u4', check_in: addDays(T, 1), check_out: addDays(T, 5), source: 'airbnb', status: 'confirmed' });
  mk({ unit_id: 'u1', check_in: addDays(T, 9), check_out: addDays(T, 14), source: 'direct', status: 'confirmed', discount: 50, notes: 'Arriving with the evening ferry. Returning guests: €50 off.' });
  // Website requests (requestStay): pending, direct, created_by "website", notes = the guest's message, price 0.
  const web = (email, phone, lang) => ({ email, phone, lang, created_by: 'website' });
  mk({ unit_id: 'u1', check_in: addDays(T, 12), check_out: addDays(T, 16), source: 'direct', status: 'pending', priced: false, hoursAgo: 3,
    guest_name: 'Sarah Cohen', extra: web('sarah.cohen@example.com', '+44 7700 900123', 'en'),
    notes: 'Hello! We are two adults and a seven-year-old, arriving on the morning ferry from Piraeus. Would an early check-in be possible? Many thanks.' });
  mk({ unit_id: 'u3', check_in: addDays(T, 5), check_out: addDays(T, 8), source: 'direct', status: 'pending', priced: false, hoursAgo: 27,
    guest_name: 'Amélie Roux', extra: web('amelie.roux@example.fr', '', 'fr'),
    notes: 'Bonjour, nous sommes deux et aimerions le studio pour trois nuits. Merci beaucoup !' });
  mk({ unit_id: 'u4', check_in: addDays(T, 30), check_out: addDays(T, 37), source: 'direct', status: 'pending', priced: 'quote', hoursAgo: 52,
    guest_name: 'Νίκος Γεωργίου', extra: web('n.georgiou@example.gr', '+30 694 123 4567', 'el'),
    notes: 'Καλησπέρα σας, θα θέλαμε το στούντιο για μία εβδομάδα. Υπάρχει δυνατότητα για παρκάρισμα κοντά;' });
  mk({ unit_id: 'u1', check_in: addDays(T, 40), check_out: addDays(T, 44), source: 'direct', status: 'pending', priced: 'quote', discount: 40,
    guest_name: 'Ingrid Olsen', extra: { email: 'ingrid.olsen@example.com', lang: 'en' }, notes: 'Asked by email, waiting for the deposit.' });
  mk({ unit_id: 'u2', check_in: addDays(T, 19), check_out: addDays(T, 24), source: 'booking', status: 'pending' });
  mk({ unit_id: 'u2', check_in: addDays(T, 75), check_out: addDays(T, 85), source: 'direct', status: 'confirmed', priced: 'quote', guest_name: 'Laura Bennett',
    extra: { email: 'laura.bennett@example.com', lang: 'en' }, notes: 'Ten nights, long-stay discount applied.' });
  mk({ unit_id: 'u3', check_in: addDays(T, 2), check_out: addDays(T, 4), source: 'airbnb', status: 'cancelled' });
  mk({ unit_id: 'u3', check_in: addDays(T, 15), check_out: addDays(T, 18), source: 'family', status: 'confirmed', guest_name: 'Family: Kostas' });

  // ~30 expenses from January up to today.
  const RANGES = { cleaning: [40, 90], laundry: [25, 70], supplies: [15, 80], linen: [60, 240], electricity: [80, 260],
    water: [20, 70], internet: [35, 35], maintenance: [50, 400], garden: [40, 150], insurance: [380, 520],
    accountant: [120, 250], software: [12, 30], 'municipal fee': [60, 180], other: [10, 120] };
  const SHARED = new Set(['internet', 'insurance', 'accountant', 'software', 'municipal fee', 'garden']);
  const weighted = [...CATEGORIES, 'cleaning', 'cleaning', 'laundry', 'laundry', 'supplies', 'maintenance'];
  const lastMonth = +T.slice(5, 7);
  const expenses = [];
  for (let i = 0; i < 30; i++) {
    const m = 1 + Math.floor((i / 30) * lastMonth);
    let date = `${Y}-${pad(m)}-${pad(ri(1, 28))}`;
    if (date > T) date = T;
    const category = pick(weighted);
    const [a, b] = RANGES[category];
    const amount = Math.round((a + R() * (b - a)) * 100) / 100;
    const unit_id = SHARED.has(category) || R() < 0.25 ? '' : pick(UNITS).id;
    expenses.push({
      id: `e${pad(i + 1)}`, date, category, amount, unit_id, paid_by: pick(PAYERS), receipt_url: '',
      notes: category === 'maintenance' ? pick(['Plumber, shower drain', 'AC service', 'Door lock replaced']) : '',
      created_at: stamp(date), updated_at: stamp(date), created_by: 'owner@example.com',
    });
  }
  return { units: UNITS, reservations, expenses };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class E extends Error { constructor(code, message, data) { super(message); this.code = code; this.data = data; } }

function userFromToken(token) {
  try {
    const p = decodeJwt(token);
    if (!p.email || !p.exp || p.exp * 1000 < Date.now()) return null;
    return { email: p.email, name: p.name, role: p.role === 'manager' ? 'manager' : 'owner' };
  } catch { return null; }
}

function validateReservation(r) {
  if (!UNITS.some((u) => u.id === r.unit_id)) throw new E('bad_request', 'Unknown unit.');
  if (!isISODate(r.check_in) || !isISODate(r.check_out)) throw new E('bad_request', 'Dates must be YYYY-MM-DD.');
  if (r.check_out <= r.check_in) throw new E('bad_request', 'Check-out must be after check-in.');
  if (!SOURCES[r.source]) throw new E('bad_request', 'Unknown source.');
  if (!STATUSES[r.status]) throw new E('bad_request', 'Unknown status.');
  r.email = String(r.email || '').trim();
  if (r.email && !isEmail(r.email)) throw new E('bad_request', 'email is not a valid address', { field: 'email' });
  r.phone = String(r.phone || '').trim().slice(0, 40);
  r.lang = LANGS[r.lang] ? r.lang : r.lang ? 'en' : '';
  r.price = Number(r.price) || 0;
  r.cleaning_fee = Number(r.cleaning_fee) || 0;
  r.discount = Number(r.discount) || 0;
  if (r.discount < 0) throw new E('bad_request', 'discount cannot be negative', { field: 'discount' });
  if (r.price < 0) throw new E('bad_request', 'price cannot be negative', { field: 'price' });
}

function applyStatusRules(user, prev, next, force) {
  if (user.role !== 'owner' && next.status === 'confirmed' && prev?.status !== 'confirmed') {
    throw new E('forbidden', 'Only owners can confirm reservations.');
  }
  const conflicts = conflictsFor(next, db.reservations);
  if (next.status === 'confirmed' && conflicts.length && force !== true) {
    throw new E('conflict', `Overlaps with ${conflicts.length} other reservation${conflicts.length > 1 ? 's' : ''}.`, { conflicts: clone(conflicts) });
  }
  return conflicts;
}

/** Backend Notify.js: pending → confirmed / cancelled emails the guest unless notify === false. Here: just log. */
function simulateNotify(prevStatus, r, notify) {
  if (prevStatus !== 'pending' || !r.email) return;
  const kind = r.status === 'confirmed' ? 'confirmation' : r.status === 'cancelled' ? 'decline' : null;
  if (!kind) return;
  if (notify === false) console.info(`[mock] ${kind} email to ${r.email} suppressed (notify: false)`);
  else console.info(`[mock] would send ${kind} email to ${r.email} in ${r.lang || 'en'}, price ${r.price}, deposit ${SETTINGS.deposit_percent}%`);
}

function owner(user) { if (user.role !== 'owner') throw new E('forbidden', 'Prices are managed by the owners.'); }
function bad(row, field, msg) { throw new E('bad_request', `Row ${row + 1}: ${msg}`, { row, field }); }
function rowsOk(rows, max) {
  if (!Array.isArray(rows) || rows.length > max) throw new E('bad_request', Array.isArray(rows) ? `At most ${max} rows.` : 'rows must be a list.', { field: 'rows' });
}
function pricing() {
  const per_unit = {};
  for (const u of UNITS) { const v = SETTINGS[`cleaning_fee_${u.id}`]; if (v !== undefined && v !== '') per_unit[u.id] = Number(v) || 0; }
  return {
    prices: PRICES, discounts: DISCOUNTS,
    cleaning_fees: { maisonette: Number(SETTINGS.cleaning_fee_maisonette) || 0, studio: Number(SETTINGS.cleaning_fee_studio) || 0, per_unit },
    currency: SETTINGS.currency, units: UNITS.map(({ id, name, type, capacity, color, active }) => ({ id, name, type, capacity, color, active })),
  };
}
/** Business plan (optional in bootstrap): this year's months May–October. */
function makePlan() {
  const Y = +todayISO().slice(0, 4);
  const nights = [0, 0, 0, 0, 25, 35, 45, 50, 35, 15, 0, 0];
  const rev = [0, 0, 0, 0, 3200, 4500, 7500, 8800, 4800, 1600, 0, 0];
  const exp = [150, 120, 150, 300, 350, 300, 350, 400, 300, 250, 120, 120];
  return nights.map((n, i) => ({ month: `${Y}-${pad(i + 1)}`, unit_nights: n, room_revenue: rev[i], expenses: exp[i] }));
}

const actions = {
  bootstrap(user) {
    return {
      user,
      units: UNITS.map(({ id, name, type, capacity, color, active }) => ({ id, name, type, capacity, color, active })),
      settings: { ...SETTINGS },
      prices: PRICES,
      plan: makePlan(),
      reservations: db.reservations,
      expenses: db.expenses,
    };
  },
  listReservations(user, { from, to } = {}) {
    return db.reservations.filter((r) => (!to || r.check_in < to) && (!from || r.check_out > from));
  },
  quoteFor(user, { unit_id, check_in, check_out } = {}) {
    if (!UNITS.some((u) => u.id === unit_id)) throw new E('bad_request', 'Unknown unit.');
    if (!isISODate(check_in) || !isISODate(check_out) || check_out <= check_in) throw new E('bad_request', 'Check-out must be after check-in.');
    return quote(unit_id, check_in, check_out);
  },
  saveReservation(user, { reservation, force, notify, autoprice } = {}) {
    if (!reservation) throw new E('bad_request', 'Missing reservation.');
    const prev = reservation.id ? db.reservations.find((r) => r.id === reservation.id) : null;
    if (reservation.id && !prev) throw new E('not_found', 'Reservation not found.');
    const now = new Date().toISOString();
    const discountSent = reservation.discount !== undefined && reservation.discount !== '' && reservation.discount !== null;
    const next = {
      external_uid: '', notes: '', guests: 0, price: 0, paid: 0, checked: false, cleaning_fee: 0, discount: 0, discount_label: '', email: '', phone: '', lang: '',
      ...prev, ...reservation,
      id: prev?.id || `r${++seq}`,
      created_at: prev?.created_at || now, created_by: prev?.created_by || user.email, updated_at: now,
    };
    if (!discountSent) next.discount = prev ? prev.discount : 0;
    validateReservation(next);
    // discount_label: cleared when the discount changes without one, and whenever the discount is 0.
    if (reservation.discount_label === undefined && prev && Number(prev.discount) !== next.discount) next.discount_label = '';
    if (!prev && reservation.discount_label === undefined) next.discount_label = '';
    next.discount_label = String(next.discount_label || '').slice(0, 200);
    // autoprice: explicit flag, else default true only when creating a direct stay with price 0 (API.md).
    const datesChanged = !prev || prev.unit_id !== next.unit_id || prev.check_in !== next.check_in || prev.check_out !== next.check_out;
    const auto = autoprice === undefined ? !prev && next.source === 'direct' && !next.price : autoprice === true;
    let q = null;
    if (auto && datesChanged) {
      q = quote(next.unit_id, next.check_in, next.check_out);
      const gross = round2(q.accommodation + q.cleaning_fee);
      if (discountSent) {
        if (!q.incomplete && next.discount > gross) throw new E('bad_request', 'The discount is more than the price-list total.', { field: 'discount', quote: q });
        next.discount_label = '';
      } else {
        next.discount = q.rule_discount;
        next.discount_label = q.rule_discount > 0 ? `${q.rule_name}, ${q.rule_percent}%` : '';
      }
      next.price = q.incomplete ? 0 : Math.max(0, round2(gross - next.discount)); // price = accommodation + cleaning − discount
      next.cleaning_fee = q.incomplete ? 0 : q.cleaning_fee;
    }
    if (!(next.discount > 0)) next.discount_label = '';
    const conflicts = applyStatusRules(user, prev, next, force);
    const prevStatus = prev?.status || null;
    if (prev) Object.assign(prev, next); else db.reservations.push(next);
    simulateNotify(prevStatus, next, notify);
    return { reservation: next, conflicts, quote: q };
  },
  setReservationStatus(user, { id, status, force, notify } = {}) {
    const prev = db.reservations.find((r) => r.id === id);
    if (!prev) throw new E('not_found', 'Reservation not found.');
    if (!STATUSES[status]) throw new E('bad_request', 'Unknown status.');
    const next = { ...prev, status, updated_at: new Date().toISOString() };
    const conflicts = applyStatusRules(user, prev, next, force);
    const prevStatus = prev.status;
    Object.assign(prev, next);
    simulateNotify(prevStatus, next, notify);
    return { reservation: next, conflicts };
  },
  saveExpense(user, { expense } = {}) {
    if (!expense) throw new E('bad_request', 'Missing expense.');
    if (!isISODate(expense.date)) throw new E('bad_request', 'Date must be YYYY-MM-DD.');
    if (!(Number(expense.amount) > 0)) throw new E('bad_request', 'Amount must be positive.');
    const prev = expense.id ? db.expenses.find((e) => e.id === expense.id) : null;
    if (expense.id && !prev) throw new E('not_found', 'Expense not found.');
    const now = new Date().toISOString();
    const next = { receipt_url: '', notes: '', unit_id: '', paid_by: '', ...prev, ...expense, amount: Number(expense.amount),
      id: prev?.id || `e${++seq}`, created_at: prev?.created_at || now, created_by: prev?.created_by || user.email, updated_at: now };
    if (prev) Object.assign(prev, next); else db.expenses.push(next);
    return { expense: next };
  },
  deleteExpense(user, { id } = {}) {
    const i = db.expenses.findIndex((e) => e.id === id);
    if (i < 0) throw new E('not_found', 'Expense not found.');
    db.expenses.splice(i, 1);
    return { id };
  },
  uploadReceipt(user, { filename, mimeType, base64 } = {}) {
    if (!base64) throw new E('bad_request', 'Empty file.');
    return { url: `data:${mimeType || 'image/jpeg'};base64,${base64}`, file_id: `mock-${++seq}-${filename || 'receipt'}` };
  },
  getPricing(user) { owner(user); return pricing(); },
  savePrices(user, { rows } = {}) {
    owner(user);
    rowsOk(rows, 500);
    const typeSet = new Set(['maisonette', 'studio', ...UNITS.map((u) => u.type)]);
    PRICES = rows.map((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) bad(i, '', 'Row is not an object.');
      const unit_id = String(r.unit_id || '').trim();
      let unit_type = String(r.unit_type || '').trim().toLowerCase();
      if (unit_id) {
        const u = UNITS.find((x) => x.id.toLowerCase() === unit_id.toLowerCase());
        if (!u) bad(i, 'unit_id', `Unknown unit "${unit_id}".`);
        unit_type = u.type;
      } else if (!typeSet.has(unit_type)) bad(i, 'unit_type', 'Choose a unit type or a unit.');
      if (!isISODate(r.from)) bad(i, 'from', 'From must be a date.');
      if (!isISODate(r.to)) bad(i, 'to', 'To must be a date.');
      if (r.from > r.to) bad(i, 'to', 'To must be on or after From.');
      const p = Number(r.price_per_night);
      if (!(p > 0)) bad(i, 'price_per_night', 'Price per night must be more than 0.');
      if (!isWhole(r.min_nights)) bad(i, 'min_nights', 'Min nights must be a whole number ≥ 0.');
      const notes = String(r.notes ?? '');
      if (notes.length > 500) bad(i, 'notes', 'Notes are limited to 500 characters.');
      return { unit_type, unit_id, from: r.from, to: r.to, price_per_night: p, min_nights: Number(r.min_nights) || 0, notes };
    });
    return pricing();
  },
  saveDiscounts(user, { rows } = {}) {
    owner(user);
    rowsOk(rows, 100);
    const ids = new Set();
    const out = rows.map((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) bad(i, '', 'Row is not an object.');
      let id = String(r.id || '').trim();
      if (id && !/^[A-Za-z0-9_-]+$/.test(id)) bad(i, 'id', 'Id may contain letters, digits, - and _ only.');
      if (id && ids.has(id)) bad(i, 'id', 'Duplicate id.');
      if (!id) do id = Math.random().toString(36).slice(2, 10); while (ids.has(id));
      ids.add(id);
      const name = String(r.name || '').trim();
      if (!name || name.length > 100) bad(i, 'name', 'Name is required (up to 100 characters).');
      if (!KINDS.includes(r.kind)) bad(i, 'kind', 'Unknown kind.');
      const percent = Number(r.percent);
      if (r.percent === '' || r.percent == null || !(percent >= 0 && percent <= 100)) bad(i, 'percent', 'Percent must be between 0 and 100.');
      if (!isWhole(r.min_nights)) bad(i, 'min_nights', 'Min nights must be a whole number ≥ 0.');
      if (r.kind === 'long_stay' && !(Number(r.min_nights) >= 1)) bad(i, 'min_nights', 'A long-stay rule needs min nights of at least 1.');
      if (!isWhole(r.days_before)) bad(i, 'days_before', 'Days before must be a whole number ≥ 0.');
      const needsDays = r.kind === 'early_booking' || r.kind === 'last_minute';
      if (needsDays && (r.days_before === '' || r.days_before == null)) bad(i, 'days_before', 'Days before is required for this kind.');
      const from = String(r.from || ''), to = String(r.to || '');
      if (from && !isISODate(from)) bad(i, 'from', 'From must be a date.');
      if (to && !isISODate(to)) bad(i, 'to', 'To must be a date.');
      if (!from !== !to) bad(i, from ? 'to' : 'from', 'Set both From and To, or neither.');
      if (r.kind === 'period' && !from) bad(i, 'from', 'A period rule needs From and To.');
      if (from && from > to) bad(i, 'to', 'To must be on or after From.');
      const unit_type = String(r.unit_type || '').trim().toLowerCase();
      if (unit_type && !UNITS.some((u) => u.type === unit_type)) bad(i, 'unit_type', 'Unknown unit type.');
      const unit_id = String(r.unit_id || '').trim();
      if (unit_id && !UNITS.some((u) => u.id === unit_id)) bad(i, 'unit_id', 'Unknown unit.');
      const a = r.active;
      if (!(a === true || a === false || a === '' || a == null || /^(true|false)$/i.test(String(a)))) bad(i, 'active', 'Active must be true or false.');
      const notes = String(r.notes ?? '');
      if (notes.length > 500) bad(i, 'notes', 'Notes are limited to 500 characters.');
      return { id, name, kind: r.kind, percent, min_nights: r.min_nights === '' || r.min_nights == null ? '' : Number(r.min_nights),
        days_before: r.days_before === '' || r.days_before == null ? '' : Number(r.days_before), from, to, unit_type, unit_id,
        active: a === true || /^true$/i.test(String(a)), notes };
    });
    DISCOUNTS = out;
    return pricing();
  },
  saveCleaningFees(user, { maisonette, studio, per_unit } = {}) {
    owner(user);
    const fee = (v, field) => {
      const n = Number(v);
      if (v === '' || v == null || !isFinite(n) || n < 0 || n > 100000) throw new E('bad_request', 'Enter an amount between 0 and 100000.', { field });
      return n;
    };
    const next = {};
    if (maisonette !== undefined) next.cleaning_fee_maisonette = String(fee(maisonette, 'maisonette'));
    if (studio !== undefined) next.cleaning_fee_studio = String(fee(studio, 'studio'));
    if (per_unit !== undefined && (typeof per_unit !== 'object' || per_unit === null || Array.isArray(per_unit))) throw new E('bad_request', 'per_unit must be an object.', { field: 'per_unit' });
    const del = [];
    for (const [id, v] of Object.entries(per_unit || {})) {
      if (!UNITS.some((u) => u.id === id)) throw new E('bad_request', `Unknown unit "${id}".`, { field: `per_unit.${id}` });
      if (v === '' || v == null) del.push(`cleaning_fee_${id}`);
      else next[`cleaning_fee_${id}`] = String(fee(v, `per_unit.${id}`));
    }
    Object.assign(SETTINGS, next);
    del.forEach((k) => delete SETTINGS[k]);
    return pricing();
  },
  importIcal(user) {
    if (user.role !== 'owner') throw new E('forbidden', 'Owner only.');
    return { imported: 0, updated: 0, cancelled: 0 };
  },
  totals(user, { year } = {}) {
    const t = computeTotals({ year: year || new Date().getFullYear(), reservations: db.reservations, expenses: db.expenses,
      units: UNITS, settings: SETTINGS });
    const strip = ({ nights, revenue, expenses }) => ({ nights, revenue, expenses });
    return { months: t.months.map((m) => ({ month: m.month, ...strip(m) })), season: strip(t.season), year: strip(t.year) };
  },
};

export async function handle(token, action, payload) {
  await sleep(120 + Math.random() * 180);
  db ||= seed();
  const user = userFromToken(token);
  if (!user) return { ok: false, error: 'unauthorized', message: 'Please sign in again.' };
  const fn = actions[action];
  if (!fn) return { ok: false, error: 'bad_request', message: `Unknown action: ${action}` };
  try {
    return { ok: true, data: clone(fn(user, payload || {})) };
  } catch (e) {
    if (e instanceof E) return { ok: false, error: e.code, message: e.message, data: e.data };
    return { ok: false, error: 'server', message: String(e && e.message || e) };
  }
}
