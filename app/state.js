// App state, last-bootstrap cache and change notifications.
import { truthy } from './lib.js';

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
  reservations: [],
  expenses: [],
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit() { state.version++; for (const fn of [...subs]) fn(); }

function normalize(data) {
  state.user = data.user || null;
  state.units = (data.units || []).map((u) => ({ ...u, capacity: Number(u.capacity) || 0 }));
  state.settings = data.settings || {};
  state.reservations = (data.reservations || []).map(normRes);
  state.expenses = (data.expenses || []).map(normExp);
}
export const normRes = (r) => ({ ...r, checked: truthy(r.checked), price: Number(r.price) || 0, paid: Number(r.paid) || 0, guests: Number(r.guests) || 0 });
export const normExp = (e) => ({ ...e, amount: Number(e.amount) || 0, unit_id: e.unit_id || '' });

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
    const { user, units, settings, reservations, expenses } = state;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ updatedAt: state.updatedAt, data: { user, units, settings, reservations, expenses } }));
  } catch { /* quota or private mode */ }
}

export function clearState() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  Object.assign(state, { loaded: false, offline: false, updatedAt: null, user: null, units: [], settings: {}, reservations: [], expenses: [] });
}

/** Replace-or-insert an object by id in a state list, persist and notify. */
export function upsert(listName, obj) {
  const list = state[listName];
  const i = list.findIndex((x) => x.id === obj.id);
  if (i >= 0) list[i] = obj; else list.push(obj);
  persist();
  emit();
}
export function removeById(listName, id) {
  state[listName] = state[listName].filter((x) => x.id !== id);
  persist();
  emit();
}

export const isOwner = () => state.user?.role === 'owner';
export const currency = () => state.settings?.currency || 'EUR';
export const unitById = (id) => state.units.find((u) => u.id === id);
export const activeUnits = () => {
  const act = state.units.filter((u) => u.active === undefined || u.active === '' || truthy(u.active));
  return act.length ? act : state.units;
};
export const unitName = (id) => (id ? unitById(id)?.name || id : 'Shared');
