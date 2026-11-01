// Google Identity Services sign-in and ID-token storage.
const KEY = 'ak.auth.v1';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
export const REFRESH_WINDOW = 5 * 60 * 1000; // try a silent refresh within 5 minutes of expiry

let gsiPromise = null;
let listener = null;
let waiters = [];

export function decodeJwt(token) {
  const part = String(token).split('.')[1] || '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function b64url(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setToken(token) {
  const p = decodeJwt(token);
  const a = { token, exp: (p.exp || 0) * 1000, email: p.email || '', name: p.name || p.email || '' };
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
  return a;
}
export function clearAuth() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
/** 'none' | 'expired' | 'expiring' | 'valid' */
export function tokenState() {
  const a = getAuth();
  if (!a || !a.token) return 'none';
  const left = a.exp - Date.now();
  if (left <= 0) return 'expired';
  if (left < REFRESH_WINDOW) return 'expiring';
  return 'valid';
}

/** Unsigned token in JWT shape for MOCK mode only. */
export function makeMockToken(role) {
  const name = role === 'owner' ? 'Owner (demo)' : 'Manager (demo)';
  const payload = { email: `${role}@example.com`, name, role, exp: Math.floor(Date.now() / 1000) + 12 * 3600 };
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.mock`;
}

export function onCredential(fn) { listener = fn; }

function handleCredential(resp) {
  if (!resp || !resp.credential) return;
  const a = setToken(resp.credential);
  waiters.splice(0).forEach((w) => w(true));
  if (listener) listener(a);
}

export function loadGsi(clientId) {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => {
      try {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredential,
          auto_select: true,
          cancel_on_tap_outside: false,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        resolve(google.accounts.id);
      } catch (e) { reject(e); }
    };
    s.onerror = () => { gsiPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
    document.head.append(s);
  });
  return gsiPromise;
}

export async function renderButton(el, clientId) {
  const id = await loadGsi(clientId);
  el.replaceChildren();
  id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
  try { id.prompt(); } catch { /* one-tap is optional */ }
}

/** Ask GIS for a fresh credential without user interaction. Resolves true on success. */
export async function silentRefresh(clientId, timeout = 6000) {
  if (!clientId) return false;
  let id;
  try { id = await loadGsi(clientId); } catch { return false; }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; clearTimeout(t); waiters = waiters.filter((w) => w !== finish); resolve(ok); } };
    const t = setTimeout(() => finish(false), timeout);
    waiters.push(finish);
    try { id.prompt(); } catch { finish(false); }
  });
}

export function signOut() {
  clearAuth();
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
}
