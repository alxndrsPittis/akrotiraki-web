// Akrotiraki management app: shell, auth flow, routing.
import config from './config.js';
import { state, loadCache, applyBootstrap, clearState, subscribe, emit, pendingCount } from './state.js';
import * as auth from './auth.js';
import { configureApi, call, ApiError } from './api.js';
import { $, h, icon, toast, openDialog, prefs, setPrefs, resetPrefs, applyPrefs, SCHEMES, PREF_CHOICES } from './ui.js';
import { fmtDateTime, capitalize } from './lib.js';
import { renderCalendar, resetCalendarView } from './views/calendar.js';
import { renderRequests } from './views/requests.js';
import { renderExpenses } from './views/expenses.js';
import { renderTotals } from './views/totals.js';
import { renderStats } from './views/stats.js';
import { renderPrices } from './views/prices.js';

const params = new URLSearchParams(location.search);
const MOCK = !!config.MOCK || !config.API_URL || params.get('mock') === '1' || params.has('fixture'); // fixture: dev replay, see mock.js
state.mock = MOCK;

const ROUTES = {
  calendar: { title: 'Calendar', render: renderCalendar },
  requests: { title: 'Requests', render: renderRequests },
  expenses: { title: 'Expenses', render: renderExpenses },
  totals: { title: 'Totals', render: renderTotals },
  stats: { title: 'Statistics', render: renderStats },
  prices: { title: 'Prices', render: renderPrices },
  profile: { title: 'Profile', render: renderProfile },
};
let route = 'calendar';
let lastRefresh = 0;

const el = { signin: $('#signin'), app: $('#app'), view: $('#view') };
applyPrefs(); // scheme and density were set by index.html; this also sets the currency display

// Tab icons (inline SVG)
document.querySelectorAll('[data-icon]').forEach((s) => s.replaceWith(icon(s.dataset.icon)));

configureApi({
  mock: MOCK,
  url: config.API_URL,
  getToken: ensureToken,
  onUnauthorized: () => {
    auth.clearAuth();
    showSignIn('Your session has expired. Please sign in again.');
  },
});

async function ensureToken() {
  let st = auth.tokenState();
  if (MOCK) {
    if (st === 'none') throw new ApiError('unauthorized', 'Please sign in.');
    return auth.getAuth().token;
  }
  if (st === 'expiring' || st === 'expired') {
    await auth.silentRefresh(config.CLIENT_ID);
    st = auth.tokenState();
  }
  if (st === 'expired' || st === 'none') {
    showSignIn('Please sign in again.');
    throw new ApiError('unauthorized', 'Please sign in.');
  }
  return auth.getAuth().token;
}

// ---------- Sign-in ----------
function showSignIn(msg = '') {
  el.app.hidden = true;
  el.signin.hidden = false;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const actionsBox = $('#signin-actions');
  $('#signin-msg').textContent = msg;
  actionsBox.replaceChildren();
  if (MOCK) {
    const asOwner = h('button', { class: 'btn primary wide', type: 'button' }, 'Continue as Owner (demo)');
    const asManager = h('button', { class: 'btn ghost', type: 'button' }, 'or as Manager (demo)');
    asOwner.addEventListener('click', () => mockSignIn('owner'));
    asManager.addEventListener('click', () => mockSignIn('manager'));
    actionsBox.append(asOwner, asManager, h('p', { class: 'hint' }, 'Demo mode: sample data, nothing is saved.'));
    asOwner.focus();
    return;
  }
  if (!config.CLIENT_ID) {
    $('#signin-msg').textContent = 'CLIENT_ID is not set in config.js.';
    return;
  }
  const btnBox = h('div', { class: 'gsi-btn' }, h('span', { class: 'hint' }, 'Loading Google sign-in…'));
  actionsBox.append(btnBox);
  auth.renderButton(btnBox, config.CLIENT_ID).catch((e) => {
    btnBox.replaceChildren();
    $('#signin-msg').textContent = e.message || 'Could not load Google sign-in.';
  });
}

function mockSignIn(role) {
  auth.setToken(auth.makeMockToken(role));
  enterApp();
}

auth.onCredential(() => {
  if (!el.signin.hidden) enterApp();
  else renderChrome();
});

function enterApp() {
  // Different person than the cached data? Drop the cache.
  const a = auth.getAuth();
  if (state.user && a && state.user.email && a.email && state.user.email !== a.email) clearState();
  showApp();
  refresh();
}

// ---------- Shell ----------
let shown = false;
function showApp() {
  el.signin.hidden = true;
  el.app.hidden = false;
  if (!shown) {
    shown = true;
    window.addEventListener('hashchange', () => { navigate(); el.view.focus({ preventScroll: true }); });
  }
  navigate();
}

function navigate() {
  const name = location.hash.slice(1);
  route = ROUTES[name] ? name : name ? 'calendar' : prefs().start; // no hash: the Profile's start screen
  document.querySelectorAll('.tabs a[data-route]').forEach((a) => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#view-title').textContent = ROUTES[route].title;
  document.title = `${ROUTES[route].title} · Akrotiraki`;
  if (el.view.dataset.view !== route) { el.view.replaceChildren(); window.scrollTo(0, 0); }
  el.view.dataset.view = route;
  renderView();
}

function renderView() {
  if (el.app.hidden) return;
  try {
    ROUTES[route].render(el.view);
  } catch (e) {
    // A view that throws must not leave a blank screen: say what failed, keep the shell usable.
    console.error(`${ROUTES[route].title} could not render`, e);
    el.view.replaceChildren(h('div', { class: 'render-error', role: 'alert' },
      h('p', { class: 'empty bad' }, `Could not render: ${e?.message || e}`),
      h('p', { class: 'hint center' }, 'Try Refresh in the Account menu. If it keeps happening, tell Alexandros what you opened.')));
  }
  try { renderChrome(); } catch (e) { console.error('Header could not render', e); }
}
subscribe(renderView);

function renderChrome() {
  const a = auth.getAuth();
  const user = state.user || (a ? { name: a.name, email: a.email } : null);
  const note = $('#status-note');
  note.replaceChildren();
  if (state.offline) {
    note.append(h('span', { class: 'pill offline' }, 'Offline'), state.updatedAt ? ` · last updated ${fmtDateTime(state.updatedAt)}` : '');
  } else if (MOCK) {
    note.append(h('span', { class: 'pill demo' }, 'Demo data'));
  }
  const initials = (user?.name || user?.email || '?').replace(/\(.*?\)/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const btn = $('#account-btn');
  btn.textContent = initials || '?';
  btn.setAttribute('aria-label', `Account: ${user?.name || 'signed in'}`);
  const n = state.loaded ? pendingCount() : 0;
  const badge = $('#req-badge');
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
  $('#req-badge-sr').textContent = n ? `, ${n} pending` : '';
  const foot = $('#rail-foot');
  foot.replaceChildren();
  if (user) {
    const prof = h('a', { href: '#profile', 'data-route': 'profile', class: 'rail-profile' }, icon('user'), h('span', null, 'Profile'));
    if (route === 'profile') prof.setAttribute('aria-current', 'page');
    foot.append(prof, h('p', { class: 'who' }, h('strong', null, user.name || user.email), h('span', null, user.email)),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: signOut }, 'Sign out'));
  }
}

$('#account-btn').addEventListener('click', () => {
  const a = auth.getAuth();
  const user = state.user || { name: a?.name, email: a?.email };
  const refreshBtn = h('button', { class: 'btn', type: 'button' }, icon('refresh'), 'Refresh');
  const pricesLink = h('a', { class: 'btn ghost wide prices-link', href: '#prices' }, icon('tag'), 'Prices and discounts');
  const profileLink = h('a', { class: 'btn ghost wide account-link', href: '#profile' }, icon('user'), 'Profile and display');
  const outBtn = h('button', { class: 'btn danger', type: 'button' }, 'Sign out');
  const dlg = openDialog({
    title: 'Account',
    dismissable: true,
    cls: 'small',
    body: h('div', { class: 'account' },
      h('p', { class: 'who big' }, h('strong', null, user.name || user.email || 'Signed in'), h('span', null, user.email || '')),
      h('dl', { class: 'kv' },
        h('dt', null, 'Role'), h('dd', null, capitalize(state.user?.role || '–')),
        h('dt', null, 'Data'), h('dd', null, MOCK ? 'Demo (in memory)' : state.offline ? 'Offline copy' : 'Live'),
        h('dt', null, 'Last updated'), h('dd', null, state.updatedAt ? fmtDateTime(state.updatedAt) : '–')),
      pricesLink, profileLink),
    foot: [outBtn, refreshBtn],
  });
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    await refresh(true);
    dlg.close();
  });
  outBtn.addEventListener('click', () => { dlg.close(); signOut(); });
  pricesLink.addEventListener('click', () => dlg.close());
  profileLink.addEventListener('click', () => dlg.close());
});

// ---------- Profile (account details + per-device display options) ----------
function renderProfile(root, force = false) {
  const a = auth.getAuth();
  const user = state.user || (a ? { name: a.name, email: a.email } : {});
  // Data refreshes re-render the view; keep the form (and focus) unless the account shown changed.
  const sig = `${user.name}|${user.email}|${state.user?.role}`;
  if (!force && root.dataset.profileSig === sig && root.querySelector('.profile')) return;
  root.dataset.profileSig = sig;
  const p = prefs();
  const uid = 'prf';
  const opts = (map, val) => Object.entries(map).map(([k, label]) => h('option', { value: k, selected: k === val }, label));
  const selectField = (key, label, map) => {
    const sel = h('select', { id: `${uid}-${key}` }, opts(map, p[key]));
    sel.addEventListener('change', () => save({ [key]: sel.value }));
    return h('div', { class: 'field' }, h('label', { class: 'field-label', for: sel.id }, label), sel);
  };
  const segField = (key, label, map) => h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, label),
    h('div', { class: 'seg' }, Object.entries(map).map(([k, text]) => {
      const id = `${uid}-${key}-${k}`;
      const inp = h('input', { type: 'radio', name: `${uid}-${key}`, id, value: k, checked: p[key] === k });
      inp.addEventListener('change', () => { if (inp.checked) save({ [key]: k }); });
      return [inp, h('label', { for: id }, text)];
    })));
  function save(changes) {
    setPrefs(changes);
    if ('calView' in changes) resetCalendarView();
    if ('scheme' in changes) swatches.dataset.scheme = changes.scheme === 'system' ? document.documentElement.dataset.scheme : changes.scheme;
  }

  const schemeSel = h('select', { id: `${uid}-scheme`, 'aria-describedby': `${uid}-scheme-hint` },
    SCHEMES.map((g) => (g.group ? h('optgroup', { label: g.group }, opts(Object.fromEntries(g.items), p.scheme)) : opts(Object.fromEntries(g.items), p.scheme))));
  schemeSel.addEventListener('change', () => save({ scheme: schemeSel.value }));
  // Native <option>s cannot hold colours, so one strip previews the chosen scheme (its own tokens via data-scheme).
  const swatches = h('span', { class: 'swatches', 'aria-hidden': 'true', 'data-scheme': p.scheme === 'system' ? document.documentElement.dataset.scheme : p.scheme },
    Array.from({ length: 7 }, () => h('i')));

  const resetBtn = h('button', { class: 'btn', type: 'button' }, 'Reset to defaults');
  resetBtn.addEventListener('click', () => {
    resetPrefs();
    resetCalendarView();
    renderProfile(root, true);
    toast('Display options reset.');
    $(`#${uid}-scheme`)?.focus();
  });

  root.replaceChildren(h('div', { class: 'profile' },
    h('section', { class: 'card', 'aria-labelledby': `${uid}-acc` },
      h('div', { class: 'card-head' }, h('h2', { id: `${uid}-acc` }, 'Account')),
      h('dl', { class: 'kv' },
        h('dt', null, 'Name'), h('dd', null, user.name || '–'),
        h('dt', null, 'Email'), h('dd', null, user.email || '–'),
        h('dt', null, 'Role'), h('dd', null, capitalize(state.user?.role || '–'))),
      h('p', { class: 'hint', style: 'margin-top:12px' }, 'Name and role are set in the Users tab of the sheet.')),
    h('section', { class: 'card', 'aria-labelledby': `${uid}-dev` },
      h('div', { class: 'card-head' }, h('h2', { id: `${uid}-dev` }, 'On this device')),
      h('p', { class: 'hint' }, 'Saved in this browser only and applied straight away.'),
      h('div', { class: 'field', style: 'margin-top:14px' },
        h('label', { class: 'field-label', for: schemeSel.id }, 'Colour scheme'),
        h('div', { class: 'scheme-row' }, schemeSel, swatches),
        h('span', { class: 'hint', id: `${uid}-scheme-hint` }, 'System follows the light or dark setting of this device.')),
      selectField('calView', 'Default calendar view', PREF_CHOICES.calView),
      selectField('start', 'Start screen', PREF_CHOICES.start),
      segField('density', 'Density', PREF_CHOICES.density),
      segField('money', 'Currency display', PREF_CHOICES.money)),
    h('div', { class: 'profile-foot' }, resetBtn,
      h('button', { class: 'btn danger', type: 'button', onclick: signOut }, 'Sign out'))));
}

function signOut() {
  auth.signOut();
  clearState();
  showSignIn('Signed out.');
}

// ---------- Data ----------
let inflight = null;
function refresh(manual = false) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await call('bootstrap', {});
      applyBootstrap(data);
      state.offline = false;
      lastRefresh = Date.now();
      emit();
      if (manual) toast('Up to date.');
    } catch (e) {
      if (e.code === 'network') {
        state.offline = true;
        emit();
        if (manual) toast('Offline. Showing the last saved data.', 'error');
      } else if (e.code !== 'unauthorized') {
        toast(e.message || 'Could not load data.', 'error');
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

window.addEventListener('online', () => { if (!el.app.hidden) refresh(); });
window.addEventListener('offline', () => { state.offline = true; renderChrome(); });
// Refresh when the window comes back (after 30 s away) and every 2 minutes while visible,
// so a tab left open on the laptop follows changes made on the phone.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !el.app.hidden && Date.now() - lastRefresh > 30 * 1000) refresh();
});
window.addEventListener('focus', () => {
  if (!el.app.hidden && Date.now() - lastRefresh > 30 * 1000) refresh();
});
setInterval(() => {
  if (!MOCK && !el.app.hidden && auth.tokenState() === 'expiring') auth.silentRefresh(config.CLIENT_ID);
  if (!el.app.hidden && document.visibilityState === 'visible' && Date.now() - lastRefresh > 2 * 60 * 1000) refresh();
}, 60 * 1000);

// ---------- Start ----------
function start() {
  if (!MOCK) loadCache();
  if (!navigator.onLine) state.offline = true;
  const st = auth.tokenState();
  if (st === 'none') return showSignIn();
  if (st === 'expired' && !MOCK) {
    // Offline with cached data: show it read-only rather than a sign-in screen that cannot work.
    if (state.loaded && !navigator.onLine) { showApp(); return; }
    showSignIn();
    return;
  }
  showApp();
  refresh();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* optional */ });
    // When a new version takes over, reload once so the page runs the new modules.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (sessionStorage.getItem('ak.reloaded') === '1') return;
      sessionStorage.setItem('ak.reloaded', '1');
      location.reload();
    });
  });
}

start();
