// Pure helpers (no DOM): dates, formatting, overlap rules, constants.
// Dates are 'YYYY-MM-DD' strings; arithmetic is done in UTC to avoid DST drift.

export const DAY = 86400000;
export const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function toUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function fromUTC(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY);
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY);
export const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
export const ymd = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
export const weekday = (s) => new Date(toUTC(s)).getUTCDay(); // 0 = Sunday

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map((m) => m.slice(0, 3));
export const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(s) { return { y: +s.slice(0, 4), m: +s.slice(5, 7) - 1, d: +s.slice(8, 10) }; }

/** "12 Jul", "12 Jul 2025" when not the current year. */
export function fmtDate(s, { weekday: wd = false, year } = {}) {
  if (!isISODate(s)) return '';
  const p = parts(s);
  const showYear = year ?? p.y !== new Date().getFullYear();
  return `${wd ? WD3[weekday(s)] + ' ' : ''}${p.d} ${MON[p.m]}${showYear ? ' ' + p.y : ''}`;
}
/** Stay range: "3–8 Jul", "28 Jun – 3 Jul" (check_out shown as departure day). */
export function fmtRange(a, b) {
  if (!isISODate(a) || !isISODate(b)) return '';
  const A = parts(a), B = parts(b);
  const y = A.y !== B.y || A.y !== new Date().getFullYear() ? ` ${B.y}` : '';
  if (A.y === B.y && A.m === B.m) return `${A.d}–${B.d} ${MON[A.m]}${y}`;
  return `${A.d} ${MON[A.m]}${A.y !== B.y ? ' ' + A.y : ''} – ${B.d} ${MON[B.m]}${y}`;
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay ? `today ${time}` : `${d.getDate()} ${MON[d.getMonth()]} ${time}`;
}

const fmtCache = new Map();
export function money(n, currency = 'EUR') {
  const v = Number(n) || 0;
  const frac = Math.round(v * 100) % 100 !== 0;
  const key = currency + frac;
  if (!fmtCache.has(key)) {
    try {
      fmtCache.set(key, new Intl.NumberFormat('en-IE', {
        style: 'currency', currency, minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: frac ? 2 : 0,
      }));
    } catch {
      fmtCache.set(key, new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }));
    }
  }
  return fmtCache.get(key).format(v);
}
export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}
export const truthy = (v) => v === true || v === 1 || v === 'TRUE' || v === 'true' || v === '1';
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export const SOURCES = {
  direct: { label: 'Direct', mark: 'DI' },
  airbnb: { label: 'Airbnb', mark: 'AB' },
  booking: { label: 'Booking.com', mark: 'BK' },
  family: { label: 'Family', mark: 'FA' },
  block: { label: 'Blocked', mark: 'BL' },
};
export const STATUSES = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};
export const CATEGORIES = ['cleaning', 'laundry', 'supplies', 'linen', 'electricity', 'water', 'internet',
  'maintenance', 'garden', 'insurance', 'accountant', 'software', 'municipal fee', 'other'];

/** Overlap rule from API.md: same unit, both not cancelled, different ids, half-open ranges. */
export function overlaps(a, b) {
  return a.id !== b.id && a.unit_id === b.unit_id &&
    a.status !== 'cancelled' && b.status !== 'cancelled' &&
    a.check_in < b.check_out && b.check_in < a.check_out;
}
export function conflictsFor(res, list) {
  if (!res || !isISODate(res.check_in) || !isISODate(res.check_out) || res.check_out <= res.check_in) return [];
  return list.filter((o) => (res.id ? o.id !== res.id : true) && overlaps({ ...res, id: res.id || '__new__' }, o))
    .sort((x, y) => x.check_in.localeCompare(y.check_in));
}
export const byCheckIn = (a, b) => a.check_in.localeCompare(b.check_in) || a.unit_id.localeCompare(b.unit_id);
