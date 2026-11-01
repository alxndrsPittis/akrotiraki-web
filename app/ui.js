// DOM helpers: element builder, icons, toasts, dialogs.

export const $ = (s, r = document) => r.querySelector(s);

/** Build an element. Text children are inserted as text nodes (never as HTML). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let deferredValue;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') deferredValue = v;
      else if (k === 'checked' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

const P = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  receipt: '<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>',
  totals: '<path d="M4 20h16M7 16.5V11M12 16.5V6.5M17 16.5v-8"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5"/>',
  camera: '<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10H4z"/><circle cx="12" cy="13.2" r="3.2"/>',
  attach: '<path d="M8 12.5l5.2-5.2a2.6 2.6 0 0 1 3.7 3.7l-6.6 6.6a4.2 4.2 0 0 1-6-6L10.6 5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  inbox: '<path d="M3.5 13.5l2.6-7.2a1.5 1.5 0 0 1 1.4-.8h9a1.5 1.5 0 0 1 1.4.8l2.6 7.2V18a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18z"/><path d="M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  phone: '<path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 6a2 2 0 0 1 2-2z"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 7.5h8M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01"/>',
};
export function icon(name, cls = 'ic') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export function toast(msg, kind = 'info', ms = 3400) {
  const box = $('#toasts');
  if (!box) return;
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }, kind === 'error' ? ms + 1600 : ms);
}

let dlgSeq = 0;
/**
 * Modal dialog. Bottom sheet on phones, centered dialog on wider screens (CSS).
 * Removed from the DOM when closed. `dismissable` closes on backdrop click.
 */
export function openDialog({ title, body, foot, dismissable = false, cls = '' }) {
  const id = `dlg-${++dlgSeq}`;
  const dlg = h('dialog', { class: `sheet ${cls}`, 'aria-labelledby': id });
  const closeBtn = h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'Close' }, icon('x'));
  closeBtn.addEventListener('click', () => dlg.close());
  dlg.append(
    h('div', { class: 'dlg-head' }, h('h2', { id }, title), closeBtn),
    h('div', { class: 'dlg-body' }, body),
  );
  if (foot) dlg.append(h('div', { class: 'dlg-foot' }, foot));
  if (dismissable) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/**
 * Confirmation dialog. Resolves false when dismissed, otherwise true — or, with `check`
 * ({label, checked, okUnchecked}), an object {checked} with the checkbox state.
 * `extra` is an optional node shown under the message.
 */
export function confirmDialog(message, { ok = 'OK', cancel = 'Back', danger = false, title = 'Are you sure?', check = null, extra = null } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const okBtn = h('button', { class: `btn ${danger ? 'danger-solid' : 'primary'}`, type: 'button' }, ok);
    const backBtn = h('button', { class: 'btn', type: 'button' }, cancel);
    const box = check ? h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: check.checked !== false, id: `dlg-chk-${dlgSeq + 1}` }) : null;
    const body = h('div', null,
      h('p', { class: 'confirm-text' }, message),
      extra,
      box ? h('div', { class: 'switch-row check-row' }, h('label', { for: box.id }, check.label), box) : null);
    const dlg = openDialog({ title, body, foot: [backBtn, okBtn], dismissable: true, cls: 'small' });
    if (box && check.okUnchecked) box.addEventListener('change', () => { okBtn.textContent = box.checked ? ok : check.okUnchecked; });
    okBtn.addEventListener('click', () => { result = box ? { checked: box.checked } : true; dlg.close(); });
    backBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => resolve(result));
    okBtn.focus();
  });
}

/** Copy text to the clipboard (falls back to a hidden textarea where the API is unavailable). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;left:-1000px' });
    ta.value = text;
    (document.querySelector('dialog[open]') || document.body).append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

/** Downscale an image file to max `max` px on the long edge, JPEG at `quality`. */
export async function downscaleImage(file, max = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const scale = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * scale), hgt = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process the image.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
