// App state, last-bootstrap cache and change notifications.
import { truthy, round2, normExtra, parseExtrasLines } from './lib.js';

const CACHE_KEY = 'ak.cache.v1';

export const state = {
  mock: false,
  loaded: false,       // true once we have data (from cache or network)
  offline: false,      // last network attempt failed
  updatedAt: null,     // ISO time of the last successful bootstrap
  version: 0,          // bumps on every change (used to invalidate derived data)
  user: null,          // {email, name, role}
  units: [],
  settings: {},
  prices: [],          // price list rows {unit_type, unit_id?, from, to, price_per_night, min_nights, notes}
  reservations: [],
  expenses: [],
  plan: [],            // optional business plan rows {month:'YYYY-MM', unit_nights, room_revenue, expenses}
  extras: [],          // Extras tab rows as sent (all, also inactive): {id, name_en, …, category, kind, price, options, …}
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit() { state.version++; for (const fn of [...subs]) fn(); }

function normalize(data) {
  state.user = data.user || null;
  state.units = (data.units || []).map((u) => ({ ...u, capacity: Number(u.capacity) || 0 }));
  state.settings = normSettings(data.settings);
  state.prices = Array.isArray(data.prices) ? data.prices.filter((r) => r && typeof r === 'object') : [];
  state.reservations = (Array.isArray(data.reservations) ? data.reservations : []).filter(Boolean).map(normRes);
  state.expenses = (Array.isArray(data.expenses) ? data.expenses : []).filter(Boolean).map(normExp);
  state.plan = (Array.isArray(data.plan) ? data.plan : []).map(normPlan).filter(Boolean);
  state.extras = Array.isArray(data.extras) ? data.extras.filter((r) => r && typeof r === 'object') : [];
}
const s10 = (v) => (v == null ? '' : String(v).slice(0, 10)); // dates arrive as text; a Date-ish value keeps its day
/** Settings arrive as strings ("30", "05-01"); keep them as text. A season day the Sheet turned into a date
 *  ("2026-05-01…") is reduced to MM-DD. Numeric settings are read with Number() where they are used. */
function normSettings(raw) {
  const s = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) s[k] = v == null ? '' : String(v).trim();
  for (const k of ['season_start', 'season_end']) {
    const m = /^\d{4}-(\d{2}-\d{2})/.exec(s[k] || '');
    if (m) s[k] = m[1];
  }
  return s;
}
const optNum = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
/** Plan rows → {month:'YYYY-MM', unit_nights, room_revenue, expenses} (numbers or null); unreadable months dropped. */
function normPlan(p) {
  const m = /^(\d{4})-(\d{2})/.exec(String(p?.month ?? ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { ...p, month: `${m[1]}-${m[2]}`, unit_nights: optNum(p.unit_nights), room_revenue: optNum(p.room_revenue), expenses: optNum(p.expenses) };
}
export const normRes = (r) => ({ ...r, id: String(r.id ?? ''), unit_id: String(r.unit_id ?? ''),
  check_in: s10(r.check_in), check_out: s10(r.check_out), status: String(r.status || ''), source: String(r.source || ''),
  guest_name: String(r.guest_name ?? ''), notes: String(r.notes ?? ''), created_at: r.created_at == null ? '' : String(r.created_at), checked: truthy(r.checked), price: Number(r.price) || 0, paid: Number(r.paid) || 0,
  cleaning_fee: Number(r.cleaning_fee) || 0, discount: Number(r.discount) || 0, guests: Number(r.guests) || 0,
  discount_label: Number(r.discount) > 0 ? String(r.discount_label || '').trim() : '',
  email: String(r.email || '').trim(), phone: String(r.phone || '').trim(), lang: r.lang || '',
  // extras: the stored JSON text parsed to [{id, qty, option, unit_price, amount}]; extras_total kept as sent.
  extras: parseExtrasLines(r.extras), extras_total: round2(Number(r.extras_total) || 0),
  group_id: String(r.group_id ?? '').trim() });
export const normExp = (e) => ({ ...e, id: String(e.id ?? ''), date: s10(e.date), category: String(e.category || ''), amount: Number(e.amount) || 0, unit_id: e.unit_id ? String(e.unit_id) : '' });

export function applyBootstrap(data, persistIt = true) {
  normalize(data);
  state.loaded = true;
  state.updatedAt = new Date().toISOString();
  if (persistIt) persist();
}

export function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.data) {
      normalize(c.data);
      state.updatedAt = c.updatedAt || null;
      state.loaded = true;
      return true;
    }
  } catch { /* ignore corrupt cache */ }
  return false;
}

export function persist() {
  if (state.mock) return;
  try {
    const { user, units, settings, prices, reservations, expenses, plan, extras } = state;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ updatedAt: state.updatedAt, data: { user, units, settings, prices, reservations, expenses, plan, extras } }));
  } catch { /* quota or private mode */ }
}

export function clearState() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  Object.assign(state, { loaded: false, offline: false, updatedAt: null, user: null, units: [], settings: {}, prices: [], reservations: [], expenses: [], plan: [], extras: [] });
}

/** Replace-or-insert an object by id in a state list, persist and notify. */
export function upsert(listName, obj) {
  const list = state[listName];
  const i = list.findIndex((x) => x.id === obj.id);
  if (i >= 0) list[i] = obj; else list.push(obj);
  persist();
  emit();
}
/** Replace-or-insert several objects by id, then persist and notify once. */
export function upsertMany(listName, objs) {
  const list = state[listName];
  for (const obj of objs) {
    const i = list.findIndex((x) => x.id === obj.id);
    if (i >= 0) list[i] = obj; else list.push(obj);
  }
  persist();
  emit();
}
export function removeById(listName, id) {
  state[listName] = state[listName].filter((x) => x.id !== id);
  persist();
  emit();
}

export const isOwner = () => state.user?.role === 'owner';
export const currency = () => (/^[A-Z]{3}$/.test(String(state.settings?.currency || '').toUpperCase()) ? String(state.settings.currency).toUpperCase() : 'EUR');
export const depositPercent = () => {
  const n = Number(state.settings?.deposit_percent);
  return isFinite(n) && n >= 0 && n <= 100 && state.settings?.deposit_percent !== '' && state.settings?.deposit_percent != null ? n : 30;
};
export const pendingCount = () => state.reservations.filter((r) => r.status === 'pending').length;
export const unitById = (id) => state.units.find((u) => u.id === id);
export const activeUnits = () => {
  const act = state.units.filter((u) => u.active === undefined || u.active === '' || truthy(u.active));
  return act.length ? act : state.units;
};
/** Reservations sharing r's group_id (whole-house request), maisonettes first, then Units order; [] when none. */
export function groupMembers(r) {
  if (!r?.group_id) return [];
  const order = (id) => { const i = state.units.findIndex((u) => u.id === id); const u = state.units[i]; return (u?.type === 'maisonette' ? 0 : 1000) + (i < 0 ? 999 : i); };
  return state.reservations.filter((x) => x.group_id === r.group_id).sort((a, b) => order(a.unit_id) - order(b.unit_id) || a.id.localeCompare(b.id));
}
export const unitName = (id) => (id ? unitById(id)?.name || id : 'Shared');

/** Extras rows normalized (lib normExtra), in sheet order; cached per state version. */
let exCache = { src: null, list: [] };
export function extrasList() {
  if (exCache.src !== state.extras) exCache = { src: state.extras, list: state.extras.map((r, i) => normExtra(r, i)).filter((x) => x.id) };
  return exCache.list;
}
export const extraById = (id) => extrasList().find((x) => x.id === id);
