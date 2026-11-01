// In-memory fake backend implementing the API.md actions with sample data.
// Used when config.API_URL is empty, config.MOCK is true, or the URL has ?mock=1.
import { addDays, diffDays, todayISO, isISODate, conflictsFor, isEmail, round2, SOURCES, STATUSES, CATEGORIES, LANGS, pad,
  normExtra, extraAmount, parseExtrasLines, EXTRA_LANGS } from './lib.js';
import { computeTotals } from './calc.js';
import { decodeJwt } from './auth.js';

let UNITS = [
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
  { id: 'd4', name: 'Gap filler', kind: 'gap', percent: 10, min_nights: '', days_before: '', max_gap_nights: 3, from: '', to: '', unit_type: '', unit_id: '', active: false, notes: '' },
].map((d) => ({ max_gap_nights: '', ...d }));
// gap: announced backend kind (field max_gap_nights); mirrored here so the app can be tried before the backend has it.
const KINDS = ['long_stay', 'early_booking', 'last_minute', 'period', 'gap'];
const isWhole = (v) => v === '' || v == null || (Number.isInteger(Number(v)) && Number(v) >= 0);
const usable = (d) => KINDS.includes(d.kind) && Number(d.percent) > 0 && Number(d.percent) <= 100 &&
  (!d.from === !d.to) && (!d.from || (isISODate(d.from) && isISODate(d.to) && d.from <= d.to)) &&
  !(d.kind === 'period' && !d.from) && !(d.kind === 'long_stay' && !(Number(d.min_nights) >= 1)) &&
  !((d.kind === 'early_booking' || d.kind === 'last_minute') && (d.days_before === '' || d.days_before == null)) &&
  !(d.kind === 'gap' && !(Number(d.max_gap_nights) >= 1));
/** Gap rule (mock reading, to be confirmed by the backend): the stay lies between two confirmed stays of the same unit
 *  (the previous one leaves on or before check-in, the next arrives on or after check-out) that are at most
 *  max_gap_nights apart. Stays overlapping the requested dates are ignored (e.g. the reservation being re-quoted). */
function fillsGap(unit_id, check_in, check_out, maxGap) {
  let prevOut = null, nextIn = null;
  for (const r of db?.reservations || []) {
    if (r.unit_id !== unit_id || r.status !== 'confirmed') continue;
    if (r.check_in < check_out && check_in < r.check_out) continue;
    if (r.check_out <= check_in && (!prevOut || r.check_out > prevOut)) prevOut = r.check_out;
    if (r.check_in >= check_out && (!nextIn || r.check_in < nextIn)) nextIn = r.check_in;
  }
  return !!(prevOut && nextIn && diffDays(prevOut, nextIn) <= maxGap);
}
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
    if (d.kind === 'gap' && !fillsGap(u.id, check_in, addDays(check_in, nightly.length), Number(d.max_gap_nights))) continue;
    const base = nightly.filter((n) => n.price != null && (!d.from || (n.date >= d.from && n.date <= d.to))).reduce((s, n) => s + n.price, 0);
    const amount = round2(base * Number(d.percent) / 100);
    if (amount > 0 && (!best || amount > best.amount)) best = { amount, name: d.name, percent: Number(d.percent) };
  }
  return best;
}

// Extras tab: the backend's seed list (Setup.js SEED_EXTRAS), all active, sort 10, 20, …
const SEED_EXTRAS = [
  // paid
  { id: 'breakfast', kind: 'per_person_night', price: 10, name_en: 'Breakfast basket', name_el: 'Καλάθι πρωινού',
    name_fr: 'Panier petit-déjeuner', name_es: 'Cesta de desayuno', name_de: 'Frühstückskorb' },
  { id: 'daily_cleaning', kind: 'per_night', price: 25, name_en: 'Daily cleaning', name_el: 'Καθημερινός καθαρισμός',
    name_fr: 'Ménage quotidien', name_es: 'Limpieza diaria', name_de: 'Tägliche Reinigung' },
  { id: 'linen_change', kind: 'per_stay', price: 15, name_en: 'Extra linen and towel change',
    name_el: 'Επιπλέον αλλαγή σεντονιών και πετσετών', name_fr: 'Changement supplémentaire du linge et des serviettes',
    name_es: 'Cambio adicional de sábanas y toallas', name_de: 'Zusätzlicher Wechsel von Bettwäsche und Handtüchern' },
  { id: 'port_transfer', kind: 'per_stay', price: 35, name_en: 'Port transfer Kamares ↔ Platys Gialos',
    name_el: 'Μεταφορά λιμάνι Καμάρες ↔ Πλατύς Γιαλός', name_fr: 'Transfert port Kamares ↔ Platys Gialos',
    name_es: 'Traslado puerto Kamares ↔ Platys Gialos', name_de: 'Hafentransfer Kamares ↔ Platys Gialos' },
  { id: 'wine', kind: 'per_stay', price: 18, options: 'Sifnos white=18;Sifnos red=18;Assyrtiko Santorini=28',
    name_en: 'Bottle of wine on arrival', name_el: 'Μπουκάλι κρασί κατά την άφιξη',
    name_fr: 'Bouteille de vin à l\'arrivée', name_es: 'Botella de vino a la llegada', name_de: 'Flasche Wein bei Ankunft' },
  { id: 'starter_groceries', kind: 'per_stay', price: 25,
    name_en: 'Starter groceries on arrival (milk, cereals, bread, eggs, butter, juice)',
    name_el: 'Βασικά τρόφιμα κατά την άφιξη (γάλα, δημητριακά, ψωμί, αυγά, βούτυρο, χυμός)',
    name_fr: 'Courses de base à l\'arrivée (lait, céréales, pain, œufs, beurre, jus)',
    name_es: 'Compra básica a la llegada (leche, cereales, pan, huevos, mantequilla, zumo)',
    name_de: 'Grundeinkauf bei Ankunft (Milch, Müsli, Brot, Eier, Butter, Saft)' },
  // request: free wishes (price 0)
  { id: 'baby_cot', category: 'request', price: 0, max_qty: 2, name_en: 'Baby cot', name_el: 'Βρεφικό κρεβάτι',
    name_fr: 'Lit bébé', name_es: 'Cuna', name_de: 'Babybett' },
  { id: 'high_chair', category: 'request', price: 0, name_en: 'High chair', name_el: 'Παιδικό καρεκλάκι φαγητού',
    name_fr: 'Chaise haute', name_es: 'Trona', name_de: 'Hochstuhl' },
  { id: 'extra_pillows', category: 'request', price: 0, max_qty: 4, name_en: 'Extra pillows',
    name_el: 'Επιπλέον μαξιλάρια', name_fr: 'Oreillers supplémentaires', name_es: 'Almohadas adicionales',
    name_de: 'Zusätzliche Kissen' },
  { id: 'hypoallergenic_bedding', category: 'request', price: 0, name_en: 'Hypoallergenic bedding',
    name_el: 'Υποαλλεργικά κλινοσκεπάσματα', name_fr: 'Literie hypoallergénique', name_es: 'Ropa de cama hipoalergénica',
    name_de: 'Allergikerbettwäsche' },
  { id: 'early_arrival', category: 'request', price: 0, name_en: 'Early arrival if possible',
    name_el: 'Νωρίτερη άφιξη αν είναι δυνατόν', name_fr: 'Arrivée anticipée si possible',
    name_es: 'Llegada anticipada si es posible', name_de: 'Frühe Anreise, falls möglich' },
  { id: 'late_departure', category: 'request', price: 0, name_en: 'Late departure if possible',
    name_el: 'Αργότερη αναχώρηση αν είναι δυνατόν', name_fr: 'Départ tardif si possible',
    name_es: 'Salida tardía si es posible', name_de: 'Späte Abreise, falls möglich' },
  { id: 'dinner_reservation', category: 'request', price: 0, name_en: 'Dinner reservation at a taverna',
    name_el: 'Κράτηση για δείπνο σε ταβέρνα', name_fr: 'Réservation pour dîner dans une taverne',
    name_es: 'Reserva para cenar en una taberna', name_de: 'Tischreservierung in einer Taverne' },
  // quote: paid, price agreed later (price cell empty)
  { id: 'local_products', category: 'quote', name_en: 'Local products on arrival (cheese, honey, koulouria)',
    name_el: 'Τοπικά προϊόντα κατά την άφιξη (τυρί, μέλι, κουλούρια)',
    name_fr: 'Produits locaux à l\'arrivée (fromage, miel, koulouria)',
    name_es: 'Productos locales a la llegada (queso, miel, koulouria)',
    name_de: 'Lokale Produkte bei Ankunft (Käse, Honig, Koulouria)' },
  { id: 'boat_or_car', category: 'quote', name_en: 'Boat day or car rental arranged',
    name_el: 'Οργάνωση ημέρας με σκάφος ή ενοικίασης αυτοκινήτου',
    name_fr: 'Journée en bateau ou location de voiture organisée',
    name_es: 'Día en barco o alquiler de coche organizado', name_de: 'Bootstag oder Mietwagen organisiert' },
  { id: 'celebration', category: 'quote', name_en: 'Celebration setup (birthday, anniversary)',
    name_el: 'Προετοιμασία για γιορτή (γενέθλια, επέτειος)',
    name_fr: 'Décoration pour une fête (anniversaire, anniversaire de mariage)',
    name_es: 'Preparación para una celebración (cumpleaños, aniversario)',
    name_de: 'Dekoration für einen Anlass (Geburtstag, Jahrestag)' },
  { id: 'pottery_workshop', category: 'quote', name_en: 'Pottery workshop visit arranged',
    name_el: 'Οργάνωση επίσκεψης σε εργαστήριο κεραμικής', name_fr: 'Visite d\'un atelier de poterie organisée',
    name_es: 'Visita a un taller de cerámica organizada', name_de: 'Besuch einer Töpferwerkstatt organisiert' }
];

let EXTRAS = SEED_EXTRAS.map((e, i) => ({
  id: e.id, name_en: e.name_en, name_el: e.name_el, name_fr: e.name_fr, name_es: e.name_es, name_de: e.name_de,
  category: e.category || 'paid', kind: e.kind || 'per_stay', price: e.price == null ? '' : e.price, options: e.options || '',
  unit_type: e.unit_type || '', unit_id: e.unit_id || '', max_qty: e.max_qty || 1, active: true, sort: (i + 1) * 10,
  notes: 'seed — to confirm',
}));
const xErr = (message, index, field = 'extras') => new E('bad_request', message, index == null ? { field } : { field, index });
/**
 * Owner-side pricing of extras (backend priceExtras with opts.owner): inactive extras and other units allowed,
 * qty 1..99, option required when the extra has options; a quote extra takes `amount` when sent, else 0.
 * selection [{id, qty, option, amount?}] → {lines: [{id, name, category, kind, option, qty, unit_price, amount}], total}.
 */
function priceExtras(selection, nights, guests) {
  if (selection == null || selection === '') return { lines: [], total: 0 };
  if (!Array.isArray(selection)) throw xErr('extras must be a list.');
  if (selection.length > 20) throw xErr('At most 20 extras.');
  const seen = new Set();
  let cents = 0;
  const lines = selection.map((s, i) => {
    if (!s || typeof s !== 'object') throw xErr('Each extra must be {id, qty}.', i);
    if (seen.has(s.id)) throw xErr(`This extra is listed twice: ${s.id}.`, i);
    seen.add(s.id);
    const row = EXTRAS.find((r) => r.id === s.id);
    const x = row && normExtra(row);
    if (!x) throw xErr(`This extra is not available: ${s.id}.`, i);
    const qty = s.qty == null || s.qty === '' ? 1 : Number(s.qty);
    if (!(Number.isInteger(qty) && qty >= 1 && qty <= 99)) throw xErr(`Please choose 1 to 99 for ${x.name}.`, i);
    let option = '', unit_price = x.price, amount = 0;
    if (x.options.length) {
      const o = x.options.find((op) => op.label.toLowerCase() === String(s.option || '').toLowerCase());
      if (!o) throw xErr(`Please choose one of: ${x.options.map((op) => op.label).join(', ')} (${x.name}).`, i);
      option = o.label;
      if (o.price != null) unit_price = o.price;
    } else if (s.option) throw xErr(`${x.name} has no options.`, i);
    if (x.category === 'paid') {
      if (x.kind === 'per_person_night' && !(Number.isInteger(guests) && guests >= 1)) throw xErr(`Please enter the number of guests (needed for ${x.name}).`, i, 'guests');
      amount = extraAmount(x.kind, unit_price, qty, nights, guests);
    } else if (x.category === 'quote' && s.amount != null && s.amount !== '') {
      const a = Number(s.amount);
      if (!(isFinite(a) && a >= 0)) throw xErr('amount must be a number ≥ 0.', i);
      amount = round2(a); unit_price = round2(amount / qty);
    } else unit_price = 0;
    cents += Math.round(amount * 100);
    return { id: x.id, name: x.name, category: x.category, kind: x.kind, option, qty, unit_price, amount };
  });
  return { lines, total: round2(cents / 100) };
}
/** Stored form (reservation column): JSON text of [{id, qty, option?, unit_price, amount}], '' when none. */
const extrasJson = (lines) => (lines.length ? JSON.stringify(lines.map((l) => ({ id: l.id, qty: l.qty, ...(l.option ? { option: l.option } : {}), unit_price: l.unit_price, amount: l.amount }))) : '');

/** Same shape as the backend quoteFor. Missing nights count 0 and mark the quote incomplete.
 *  A row with unit_id applies to that unit only and wins over the unit_type rows. */
function quote(unit_id, check_in, check_out, ex = { lines: [], total: 0 }) {
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
    extras: ex.lines, extras_total: ex.total,
    total: round2(accommodation + cleaning_fee - rule_discount + ex.total),
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
let dbReady = null;
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
    const g = ri(1, u.capacity);
    const guestsN = o.source === 'block' ? 0 : o.guests ?? g;
    const ex = priceExtras(o.extras || [], nights, o.exGuests ?? guestsN);
    if (price > 0) price = round2(price + ex.total); // price = accommodation + cleaning − discount + extras
    const past = o.check_in <= T;
    const created = addDays(o.check_in, -ri(15, 90));
    const r = {
      ...r0,
      guest_name: o.guest_name ?? GUESTS[gi++ % GUESTS.length],
      guests: guestsN,
      source: o.source,
      price,
      paid: o.status === 'confirmed' ? (past ? price : Math.round(price * 0.3)) : 0,
      checked: (o.source === 'airbnb' || o.source === 'booking' || o.source === 'vrbo') && o.status !== 'pending' && (past || R() < 0.5),
      notes: o.notes || '',
      external_uid: o.source === 'airbnb' || o.source === 'booking' || o.source === 'vrbo' ? `${o.source}-${id}@mock` : '',
      created_at: stamp(created),
      updated_at: o.status === 'cancelled' ? stamp(addDays(T, -ri(2, 20))) : stamp(created),
      created_by: 'owner@example.com',
      cleaning_fee, discount, discount_label, email: '', phone: '', lang: '', extras: extrasJson(ex.lines), extras_total: ex.total,
      group_id: '',
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
      mk({ unit_id: u.id, check_in: d, check_out: co, source: x < 0.4 ? 'airbnb' : x < 0.7 ? 'booking' : x < 0.8 ? 'vrbo' : 'direct', status: 'confirmed', ...special[`${u.id}:${n}`] });
    }
  }
  // Around today, so the current month has something to show.
  mk({ unit_id: 'u2', check_in: addDays(T, -2), check_out: addDays(T, 3), source: 'booking', status: 'confirmed' });
  mk({ unit_id: 'u4', check_in: addDays(T, 1), check_out: addDays(T, 5), source: 'airbnb', status: 'confirmed' });
  mk({ unit_id: 'u1', check_in: addDays(T, 9), check_out: addDays(T, 14), source: 'direct', status: 'confirmed', discount: 50, notes: 'Arriving with the evening ferry. Returning guests: €50 off.' });
  // Website requests (requestStay): pending, direct, created_by "website", notes = the guest's message, price 0.
  const web = (email, phone, lang) => ({ email, phone, lang, created_by: 'website' });
  mk({ unit_id: 'u1', check_in: addDays(T, 12), check_out: addDays(T, 16), source: 'direct', status: 'pending', priced: 'quote', hoursAgo: 3,
    guest_name: 'Sarah Cohen', guests: 3,
    extras: [{ id: 'breakfast' }, { id: 'port_transfer' }, { id: 'baby_cot' }, { id: 'early_arrival' }, { id: 'local_products' }], extra: web('sarah.cohen@example.com', '+44 7700 900123', 'en'),
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
    guests: 2, extras: [{ id: 'wine', option: 'Assyrtiko Santorini' }, { id: 'daily_cleaning' }, { id: 'celebration', amount: 60 }, { id: 'late_departure' }],
    extra: { email: 'laura.bennett@example.com', lang: 'en' }, notes: 'Ten nights, long-stay discount applied.' });
  mk({ unit_id: 'u3', check_in: addDays(T, 2), check_out: addDays(T, 4), source: 'airbnb', status: 'cancelled' });
  mk({ unit_id: 'u3', check_in: addDays(T, 15), check_out: addDays(T, 18), source: 'family', status: 'confirmed', guest_name: 'Family: Kostas' });
  mk({ unit_id: 'u4', check_in: addDays(T, 22), check_out: addDays(T, 27), source: 'vrbo', status: 'confirmed' });

  // Whole-house request (requestStay unit_id "ALL"): one pending reservation per unit, same group_id, maisonettes
  // first; 10 guests spread by capacity (5, 4, 1, 0 here); extras and the message on the first, the others point to it.
  {
    const gid = 'k3x9p2', ci = `${Y + 1}-07-04`, co = `${Y + 1}-07-11`;
    const order = [...UNITS].sort((a, b) => (a.type === 'maisonette' ? 0 : 1) - (b.type === 'maisonette' ? 0 : 1));
    let left = 10;
    const g = web('familie.hoffmann@example.de', '+49 151 2345 6789', 'en');
    order.forEach((u, i) => {
      const n = Math.min(u.capacity, left); left -= n;
      mk({ unit_id: u.id, check_in: ci, check_out: co, source: 'direct', status: 'pending', priced: 'quote', hoursAgo: 6,
        guest_name: 'Felix Hoffmann', guests: n, exGuests: 10, extras: i === 0 ? [{ id: 'breakfast' }, { id: 'port_transfer' }, { id: 'baby_cot' }] : [],
        extra: { ...g, group_id: gid },
        notes: i === 0 ? 'Hello, we are three families travelling together (6 adults, 4 children) and would like the whole house for a week in July.'
          : `Part of group ${gid} (whole house request; message and extras on ${order[0].id}).` });
    });
    // A Vrbo hold on one studio overlaps the request, so the card shows a conflict.
    mk({ unit_id: order[2].id, check_in: `${Y + 1}-07-09`, check_out: `${Y + 1}-07-13`, source: 'vrbo', status: 'pending', guest_name: 'Vrbo hold' });
  }

  // Dev knob ?mock=1&many=1: ~300 extra stays over last, this and next year (calendar performance checks).
  if (/[?&]many=1\b/.test(globalThis.location?.search || '')) {
    for (const u of UNITS) {
      for (let d = `${Y - 1}-03-01`; d < `${Y + 1}-11-30`;) {
        const co = addDays(d, ri(2, 9));
        const x = R();
        mk({ unit_id: u.id, check_in: d, check_out: co, source: x < 0.35 ? 'airbnb' : x < 0.6 ? 'booking' : x < 0.7 ? 'vrbo' : x < 0.95 ? 'direct' : 'family',
          status: R() < 0.06 ? 'cancelled' : 'confirmed' });
        d = addDays(co, ri(d.slice(5, 7) >= '05' && d.slice(5, 7) <= '09' ? 0 : 6, d.slice(5, 7) >= '05' && d.slice(5, 7) <= '09' ? 6 : 30));
      }
    }
  }

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
  if (FIX) return fixturePricing();
  const per_unit = {};
  for (const u of UNITS) { const v = SETTINGS[`cleaning_fee_${u.id}`]; if (v !== undefined && v !== '') per_unit[u.id] = Number(v) || 0; }
  return {
    prices: PRICES, discounts: DISCOUNTS, extras: EXTRAS,
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

// ---- Fixture mode (dev only): ?fixture=<url> replays a real-shaped bootstrap payload (e.g. a Sheet export) ----
// The JSON is a bootstrap `data` object (or a whole {ok, data} reply). It replaces units, settings, prices, discounts,
// extras, plan, reservations and expenses; `user` comes from the demo sign-in so both roles can be tried. getPricing is
// derived from it the way the backend builds it, except cleaning_fees keep the Settings strings ("30") to exercise the
// string case; a `getPricing` key in the fixture is used as is instead.
let FIX = null;
const fixtureUrl = () => { try { return new URLSearchParams(globalThis.location?.search || '').get('fixture') || ''; } catch { return ''; } };
async function loadFixture(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fixture ${url}: HTTP ${res.status}`);
  const j = await res.json();
  const d = j && j.ok === true && j.data ? j.data : j;
  if (!d || typeof d !== 'object') throw new Error(`Fixture ${url}: not a bootstrap object`);
  FIX = d;
  UNITS = Array.isArray(d.units) ? d.units : [];
  for (const k of Object.keys(SETTINGS)) delete SETTINGS[k];
  Object.assign(SETTINGS, d.settings || {});
  PRICES = Array.isArray(d.prices) ? d.prices : [];
  DISCOUNTS = Array.isArray(d.discounts) ? d.discounts : [];
  EXTRAS = Array.isArray(d.extras) ? d.extras : [];
  console.info(`[mock] fixture ${url}: ${(d.reservations || []).length} reservations, ${(d.expenses || []).length} expenses`);
  return { units: UNITS, reservations: Array.isArray(d.reservations) ? d.reservations : [], expenses: Array.isArray(d.expenses) ? d.expenses : [] };
}
function fixturePricing() {
  if (FIX.getPricing && typeof FIX.getPricing === 'object') return FIX.getPricing;
  const per_unit = {};
  for (const u of UNITS) { const v = SETTINGS[`cleaning_fee_${u.id}`]; if (v !== undefined && v !== '') per_unit[u.id] = v; }
  return {
    prices: PRICES, discounts: DISCOUNTS, extras: EXTRAS,
    cleaning_fees: { maisonette: SETTINGS.cleaning_fee_maisonette ?? 0, studio: SETTINGS.cleaning_fee_studio ?? 0, per_unit },
    currency: SETTINGS.currency || 'EUR', units: UNITS.map(({ id, name, type, capacity, color, active }) => ({ id, name, type, capacity, color, active })),
  };
}

const actions = {
  bootstrap(user) {
    if (FIX) {
      const { note, getPricing, ...rest } = FIX; // eslint-disable-line no-unused-vars
      return { ...rest, user, prices: PRICES, discounts: DISCOUNTS, extras: EXTRAS, units: UNITS, settings: { ...SETTINGS },
        reservations: db.reservations, expenses: db.expenses };
    }
    return {
      user,
      units: UNITS.map(({ id, name, type, capacity, color, active }) => ({ id, name, type, capacity, color, active })),
      settings: { ...SETTINGS },
      prices: PRICES,
      plan: makePlan(),
      extras: EXTRAS,
      reservations: db.reservations,
      expenses: db.expenses,
    };
  },
  listReservations(user, { from, to } = {}) {
    return db.reservations.filter((r) => (!to || r.check_in < to) && (!from || r.check_out > from));
  },
  quoteFor(user, { unit_id, check_in, check_out, extras, guests } = {}) {
    if (!UNITS.some((u) => u.id === unit_id)) throw new E('bad_request', 'Unknown unit.');
    if (!isISODate(check_in) || !isISODate(check_out) || check_out <= check_in) throw new E('bad_request', 'Check-out must be after check-in.');
    let g = null;
    if (guests != null && guests !== '') {
      g = Number(guests);
      if (!(Number.isInteger(g) && g >= 0 && g <= 50)) throw new E('bad_request', 'Please enter the number of guests (0 to 50).', { field: 'guests' });
    }
    return quote(unit_id, check_in, check_out, priceExtras(extras, diffDays(check_in, check_out), g));
  },
  saveReservation(user, { reservation, force, notify, autoprice } = {}) {
    if (!reservation) throw new E('bad_request', 'Missing reservation.');
    const prev = reservation.id ? db.reservations.find((r) => r.id === reservation.id) : null;
    if (reservation.id && !prev) throw new E('not_found', 'Reservation not found.');
    const now = new Date().toISOString();
    const discountSent = reservation.discount !== undefined && reservation.discount !== '' && reservation.discount !== null;
    const extrasSent = reservation.extras !== undefined;
    const next = {
      external_uid: '', notes: '', guests: 0, price: 0, paid: 0, checked: false, cleaning_fee: 0, discount: 0, discount_label: '', email: '', phone: '', lang: '',
      extras: '', extras_total: 0,
      ...prev, ...reservation,
      id: prev?.id || `r${++seq}`,
      created_at: prev?.created_at || now, created_by: prev?.created_by || user.email, updated_at: now,
    };
    if (!discountSent) next.discount = prev ? prev.discount : 0;
    next.group_id = prev?.group_id || ''; // server-owned: ignored in input, kept on update, '' on create
    next.extras = prev ? prev.extras : '';
    next.extras_total = prev ? prev.extras_total : 0;
    validateReservation(next);
    next.guests = Number(next.guests) || 0;
    // discount_label: cleared when the discount changes without one, and whenever the discount is 0.
    if (reservation.discount_label === undefined && prev && Number(prev.discount) !== next.discount) next.discount_label = '';
    if (!prev && reservation.discount_label === undefined) next.discount_label = '';
    next.discount_label = String(next.discount_label || '').slice(0, 200);
    // autoprice: explicit flag, else default true only when creating a direct stay with price 0 (API.md).
    const datesChanged = !prev || prev.unit_id !== next.unit_id || prev.check_in !== next.check_in || prev.check_out !== next.check_out;
    const auto = autoprice === undefined ? !prev && next.source === 'direct' && !next.price : autoprice === true;
    let q = null;
    const nightsN = diffDays(next.check_in, next.check_out);
    // Extras (API.md saveReservation → extras). Quote extras keep their stored amount when none is sent.
    const storedLines = parseExtrasLines(prev?.extras);
    const selection = (list) => (typeof list === 'string' ? parseExtrasLines(list) : list || []).map((l) => {
      const st = storedLines.find((x) => x.id === l.id);
      const isQuote = EXTRAS.find((r) => r.id === l.id)?.category === 'quote';
      const amount = l.amount != null && l.amount !== '' ? l.amount : isQuote && st && st.amount > 0 ? st.amount : undefined;
      return { id: l.id, qty: l.qty, option: l.option || '', ...(isQuote && amount !== undefined ? { amount } : {}) };
    });
    if (auto && datesChanged) {
      const ex = priceExtras(selection(extrasSent ? reservation.extras : storedLines), nightsN, next.guests);
      q = quote(next.unit_id, next.check_in, next.check_out, ex);
      next.extras = extrasJson(ex.lines);
      next.extras_total = ex.total;
      const gross = round2(q.accommodation + q.cleaning_fee);
      if (discountSent) {
        if (!q.incomplete && next.discount > gross) throw new E('bad_request', 'The discount is more than the price-list total.', { field: 'discount', quote: q });
        next.discount_label = '';
      } else {
        next.discount = q.rule_discount;
        next.discount_label = q.rule_discount > 0 ? `${q.rule_name}, ${q.rule_percent}%` : '';
      }
      next.price = q.incomplete ? 0 : Math.max(0, round2(gross - next.discount + ex.total)); // price = accommodation + cleaning − discount + extras
      next.cleaning_fee = q.incomplete ? 0 : q.cleaning_fee;
    } else if (autoprice === true && extrasSent) {
      // Only the extras repriced: the price moves by the difference in extras_total (unless price is sent or 0).
      const ex = priceExtras(selection(reservation.extras), nightsN, next.guests);
      if (reservation.price === undefined && next.price > 0) next.price = Math.max(0, round2(next.price - (Number(prev?.extras_total) || 0) + ex.total));
      next.extras = extrasJson(ex.lines);
      next.extras_total = ex.total;
    } else if (extrasSent) {
      // Stored as given: unit_price and amount required; the price is not changed.
      const lines = typeof reservation.extras === 'string' ? JSON.parse(reservation.extras || '[]') : reservation.extras;
      if (!Array.isArray(lines)) throw xErr('extras must be a list.');
      lines.forEach((l, i) => {
        if (!l || !l.id) throw xErr('Each extra needs an id.', i);
        if (l.unit_price == null || l.amount == null || l.unit_price === '' || l.amount === '') throw xErr(`Extra ${l.id}: unit_price and amount are required (or send autoprice: true).`, i);
        if (!(Number(l.amount) >= 0)) throw xErr('amount must be a number ≥ 0.', i);
      });
      const clean = lines.map((l) => ({ id: String(l.id), qty: Number(l.qty) || 1, option: String(l.option || ''), unit_price: round2(Number(l.unit_price)), amount: round2(Number(l.amount)) }));
      next.extras = extrasJson(clean);
      next.extras_total = round2(clean.reduce((a, l) => a + l.amount, 0));
    }
    if (!(next.discount > 0)) next.discount_label = '';
    const conflicts = applyStatusRules(user, prev, next, force);
    const prevStatus = prev?.status || null;
    if (prev) Object.assign(prev, next); else db.reservations.push(next);
    simulateNotify(prevStatus, next, notify);
    return { reservation: next, conflicts, quote: q };
  },
  setReservationStatus(user, { id, status, force, notify, apply_to_group } = {}) {
    const prev = db.reservations.find((r) => r.id === id);
    if (!prev) throw new E('not_found', 'Reservation not found.');
    if (!STATUSES[status]) throw new E('bad_request', 'Unknown status.');
    if (apply_to_group !== undefined && typeof apply_to_group !== 'boolean') throw new E('bad_request', 'apply_to_group must be true or false.', { field: 'apply_to_group' });
    if (apply_to_group === true) {
      // All members checked first (role, conflicts), then all written: an error leaves the group unchanged.
      const isM = (r) => (UNITS.find((u) => u.id === r.unit_id)?.type === 'maisonette' ? 0 : 1);
      const members = (prev.group_id ? db.reservations.filter((r) => r.group_id === prev.group_id) : [prev])
        .sort((a, b) => isM(a) - isM(b) || UNITS.findIndex((u) => u.id === a.unit_id) - UNITS.findIndex((u) => u.id === b.unit_id));
      const now = new Date().toISOString();
      const nexts = members.map((m) => ({ ...m, status, updated_at: now }));
      const all = [];
      const conflictErr = [];
      nexts.forEach((n, i) => {
        try { all.push(...applyStatusRules(user, members[i], n, force)); } catch (e) {
          if (e.code !== 'conflict') throw e;
          conflictErr.push(...e.data.conflicts);
        }
      });
      if (conflictErr.length) throw new E('conflict', `Overlaps with ${conflictErr.length} other reservation${conflictErr.length > 1 ? 's' : ''}.`, { conflicts: conflictErr });
      const prevStatus = members.map((m) => m.status);
      nexts.forEach((n, i) => Object.assign(members[i], n));
      const mailTo = nexts.find((n, i) => prevStatus[i] === 'pending' && n.email);
      if (mailTo) simulateNotify('pending', mailTo, notify);
      return { reservation: nexts.find((n) => n.id === id), reservations: nexts, conflicts: all };
    }
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
      if (!isWhole(r.max_gap_nights)) bad(i, 'max_gap_nights', 'Max gap nights must be a whole number ≥ 0.');
      if (r.kind === 'gap' && !(Number(r.max_gap_nights) >= 1)) bad(i, 'max_gap_nights', 'A gap rule needs max gap nights of at least 1.');
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
        days_before: r.days_before === '' || r.days_before == null ? '' : Number(r.days_before),
        max_gap_nights: r.max_gap_nights === '' || r.max_gap_nights == null ? '' : Number(r.max_gap_nights), from, to, unit_type, unit_id,
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
  saveExtras(user, { rows } = {}) {
    owner(user);
    rowsOk(rows, 50);
    const ids = new Set();
    rows.forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) bad(i, '', 'Row is not an object.');
      const id = String(r.id ?? '').trim();
      if (!id) return;
      if (id.length > 40 || !/^[A-Za-z0-9_-]+$/.test(id)) bad(i, 'id', 'id may only contain letters, digits, - and _ (up to 40).');
      if (ids.has(id)) bad(i, 'id', `Duplicate id: ${id}`);
      ids.add(id);
    });
    const money = (v, i, field, required) => {
      if (v === '' || v == null) { if (required) bad(i, field, `${field} is required for paid extras`); return ''; }
      const n = Number(v);
      if (!(isFinite(n) && n >= 0 && n <= 100000)) bad(i, field, `${field} must be a number from 0 to 100000`);
      return n;
    };
    EXTRAS = rows.map((r, i) => {
      const out = {};
      for (const l of EXTRA_LANGS) {
        out[`name_${l}`] = String(r[`name_${l}`] ?? '').trim();
        if (out[`name_${l}`].length > 100) bad(i, `name_${l}`, `name_${l} is limited to 100 characters`);
      }
      if (!out.name_en) bad(i, 'name_en', 'name_en is required');
      const category = String(r.category || '').trim().toLowerCase() || 'paid';
      if (!['paid', 'request', 'quote'].includes(category)) bad(i, 'category', 'category must be one of paid, request, quote');
      const kind = String(r.kind || '').trim().toLowerCase();
      if (!['per_stay', 'per_night', 'per_person_night'].includes(kind)) bad(i, 'kind', 'kind must be one of per_stay, per_night, per_person_night');
      const price = money(r.price, i, 'price', category === 'paid');
      const opts = [];
      for (const part of String(r.options ?? '').split(';')) {
        if (!part.trim()) continue;
        const eq = part.lastIndexOf('=');
        const label = (eq >= 0 ? part.slice(0, eq) : part).trim();
        const raw = eq >= 0 ? part.slice(eq + 1).trim() : '';
        if (!label) bad(i, 'options', 'every option needs a label');
        if (raw !== '' && !(Number(raw) >= 0 && Number(raw) <= 100000)) bad(i, 'options', `option "${label}" has an invalid price`);
        if (opts.some((o) => o.label.toLowerCase() === label.toLowerCase())) bad(i, 'options', `duplicate option: ${label}`);
        opts.push({ label, price: raw === '' ? null : Number(raw) });
      }
      if (opts.length && category !== 'paid') bad(i, 'options', 'only paid extras can have options');
      const unit_type = String(r.unit_type || '').trim().toLowerCase();
      if (unit_type && !UNITS.some((u) => u.type === unit_type)) bad(i, 'unit_type', 'Unknown unit type.');
      const unit_id = String(r.unit_id || '').trim();
      if (unit_id && !UNITS.some((u) => u.id === unit_id)) bad(i, 'unit_id', 'Unknown unit.');
      const mq = r.max_qty === '' || r.max_qty == null ? 1 : Number(r.max_qty);
      if (!(Number.isInteger(mq) && mq >= 1 && mq <= 99)) bad(i, 'max_qty', 'max_qty must be a whole number from 1 to 99');
      const a = r.active;
      if (!(a === true || a === false || a === '' || a == null || /^(true|false)$/i.test(String(a)))) bad(i, 'active', 'active must be true or false');
      const sort = r.sort === '' || r.sort == null ? 0 : Number(r.sort);
      if (!isFinite(sort)) bad(i, 'sort', 'sort must be a number');
      const notes = String(r.notes ?? '');
      if (notes.length > 500) bad(i, 'notes', 'Notes are limited to 500 characters.');
      let id = String(r.id ?? '').trim();
      if (!id) { do id = Math.random().toString(36).slice(2, 10); while (ids.has(id)); ids.add(id); }
      return { id, ...out, category, kind, price, options: opts.map((o) => o.label + (o.price == null ? '' : `=${o.price}`)).join(';'),
        unit_type, unit_id, max_qty: mq, active: a === true || /^true$/i.test(String(a)), sort, notes };
    });
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
  if (!db) {
    const url = fixtureUrl();
    dbReady ||= url ? loadFixture(url) : Promise.resolve(seed());
    db = await dbReady;
  }
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
