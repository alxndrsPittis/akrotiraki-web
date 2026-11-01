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

export function confirmDialog(message, { ok = 'OK', cancel = 'Back', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const okBtn = h('button', { class: `btn ${danger ? 'danger-solid' : 'primary'}`, type: 'button' }, ok);
    const backBtn = h('button', { class: 'btn', type: 'button' }, cancel);
    const dlg = openDialog({ title, body: h('p', { class: 'confirm-text' }, message), foot: [backBtn, okBtn], dismissable: true, cls: 'small' });
    okBtn.addEventListener('click', () => { result = true; dlg.close(); });
    backBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => resolve(result));
    okBtn.focus();
  });
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
