// In-memory fake backend implementing the API.md actions with sample data.
// Used when config.API_URL is empty, config.MOCK is true, or the URL has ?mock=1.
import { addDays, diffDays, todayISO, isISODate, conflictsFor, SOURCES, STATUSES, CATEGORIES, pad } from './lib.js';
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
    const price = free ? 0 : nights * rate;
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
    };
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
  mk({ unit_id: 'u1', check_in: addDays(T, 9), check_out: addDays(T, 14), source: 'direct', status: 'confirmed', notes: 'Arriving with the evening ferry.' });
  mk({ unit_id: 'u1', check_in: addDays(T, 12), check_out: addDays(T, 16), source: 'direct', status: 'pending', notes: 'Asked by email, waiting for the deposit.' });
  mk({ unit_id: 'u3', check_in: addDays(T, 5), check_out: addDays(T, 8), source: 'direct', status: 'pending' });
  mk({ unit_id: 'u2', check_in: addDays(T, 19), check_out: addDays(T, 24), source: 'booking', status: 'pending' });
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

const actions = {
  bootstrap(user) {
    return {
      user,
      units: UNITS.map(({ id, name, type, capacity, color, active }) => ({ id, name, type, capacity, color, active })),
      settings: { season_start: '05-01', season_end: '10-31', currency: 'EUR' },
      reservations: db.reservations,
      expenses: db.expenses,
    };
  },
  listReservations(user, { from, to } = {}) {
    return db.reservations.filter((r) => (!to || r.check_in < to) && (!from || r.check_out > from));
  },
  saveReservation(user, { reservation, force } = {}) {
    if (!reservation) throw new E('bad_request', 'Missing reservation.');
    const prev = reservation.id ? db.reservations.find((r) => r.id === reservation.id) : null;
    if (reservation.id && !prev) throw new E('not_found', 'Reservation not found.');
    const now = new Date().toISOString();
    const next = {
      external_uid: '', notes: '', guests: 0, price: 0, paid: 0, checked: false,
      ...prev, ...reservation,
      id: prev?.id || `r${++seq}`,
      created_at: prev?.created_at || now, created_by: prev?.created_by || user.email, updated_at: now,
    };
    validateReservation(next);
    const conflicts = applyStatusRules(user, prev, next, force);
    if (prev) Object.assign(prev, next); else db.reservations.push(next);
    return { reservation: next, conflicts };
  },
  setReservationStatus(user, { id, status } = {}) {
    const prev = db.reservations.find((r) => r.id === id);
    if (!prev) throw new E('not_found', 'Reservation not found.');
    if (!STATUSES[status]) throw new E('bad_request', 'Unknown status.');
    const next = { ...prev, status, updated_at: new Date().toISOString() };
    const conflicts = applyStatusRules(user, prev, next, false);
    Object.assign(prev, next);
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
  importIcal(user) {
    if (user.role !== 'owner') throw new E('forbidden', 'Owner only.');
    return { imported: 0, updated: 0, cancelled: 0 };
  },
  totals(user, { year } = {}) {
    const t = computeTotals({ year: year || new Date().getFullYear(), reservations: db.reservations, expenses: db.expenses,
      units: UNITS, settings: { season_start: '05-01', season_end: '10-31' } });
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
