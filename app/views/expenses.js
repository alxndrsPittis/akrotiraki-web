// Expenses: list grouped by month, filters, add/edit form with receipt upload.
import { state, activeUnits, unitName, currency } from '../state.js';
import { h, icon, openDialog, confirmDialog, toast, downscaleImage, blobToBase64 } from '../ui.js';
import { todayISO, isISODate, fmtDate, fmtDateTime, money, num, capitalize, plural, MONTHS, CATEGORIES } from '../lib.js';
import * as actions from '../actions.js';

let fUnit = 'all';
let fCat = 'all';
let seq = 0;

export function renderExpenses(root) {
  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }
  const cur = currency();
  const units = activeUnits();
  const cats = [...new Set([...state.expenses.map((e) => (e.category || '').toLowerCase()).filter(Boolean)])].sort();
  if (fCat !== 'all' && !cats.includes(fCat)) fCat = 'all';

  const unitSel = h('select', { id: 'f-unit', value: fUnit, onchange: (e) => { fUnit = e.target.value; renderExpenses(root); } },
    h('option', { value: 'all' }, 'All units'), h('option', { value: '' }, 'Shared'),
    units.map((u) => h('option', { value: u.id }, u.name)));
  const catSel = h('select', { id: 'f-cat', value: fCat, onchange: (e) => { fCat = e.target.value; renderExpenses(root); } },
    h('option', { value: 'all' }, 'All categories'), cats.map((c) => h('option', { value: c }, capitalize(c))));

  const list = state.expenses
    .filter((e) => (fUnit === 'all' || (e.unit_id || '') === fUnit) && (fCat === 'all' || (e.category || '').toLowerCase() === fCat))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const total = list.reduce((s, e) => s + num(e.amount), 0);

  root.append(h('div', { class: 'filters' },
    h('label', { class: 'field compact' }, h('span', { class: 'field-label' }, 'Unit'), unitSel),
    h('label', { class: 'field compact' }, h('span', { class: 'field-label' }, 'Category'), catSel)));

  root.append(h('p', { class: 'summary' }, `${plural(list.length, 'expense')} · `, h('strong', null, money(total, cur))));

  if (!list.length) {
    root.append(h('p', { class: 'empty' }, state.expenses.length ? 'No expenses match these filters.' : 'No expenses yet. Tap Add to record one.'));
  }

  const groups = new Map();
  for (const e of list) {
    const k = e.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [k, items] of groups) {
    const sum = items.reduce((s, e) => s + num(e.amount), 0);
    const title = `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
    root.append(h('section', { class: 'group', 'aria-label': title },
      h('header', { class: 'group-head' }, h('h3', null, title), h('span', { class: 'num' }, money(sum, cur))),
      h('ul', { class: 'list' }, items.map((e) => h('li', { class: 'exp' },
        h('button', { type: 'button', class: 'list-row', onclick: () => openExpense(e) },
          h('span', { class: 'what' },
            h('span', { class: 'line1' }, capitalize(e.category || 'Other')),
            h('span', { class: 'line2' }, [fmtDate(e.date), unitName(e.unit_id), e.paid_by ? `paid by ${e.paid_by}` : '', e.notes]
              .filter(Boolean).join(' · '))),
          h('span', { class: 'num amount' }, money(e.amount, cur))),
        e.receipt_url ? receiptLink(e.receipt_url, 'receipt-link', icon('attach')) : null)))));
  }

  root.append(h('button', { class: 'fab', type: 'button', onclick: () => openExpense({}) }, icon('plus'), h('span', null, 'Add')));
}

function receiptLink(url, cls, content) {
  if (url.startsWith('data:image')) {
    return h('button', { type: 'button', class: cls, 'aria-label': 'View receipt', title: 'Receipt',
      onclick: () => openDialog({ title: 'Receipt', dismissable: true, body: h('img', { class: 'receipt-full', src: url, alt: 'Receipt' }) }) }, content);
  }
  if (!/^https?:/i.test(url)) return null;
  return h('a', { class: cls, href: url, target: '_blank', rel: 'noopener', 'aria-label': 'Open receipt', title: 'Receipt' }, content);
}

export function openExpense(input = {}) {
  const uid = `x${++seq}`;
  const existing = input.id ? state.expenses.find((e) => e.id === input.id) || input : null;
  const e = { date: todayISO(), category: '', amount: '', unit_id: '', paid_by: state.user?.name || '', notes: '', receipt_url: '', ...(existing || input) };
  const payers = [...new Set(state.expenses.map((x) => x.paid_by).filter(Boolean))];

  const field = (label, control, extra) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, extra);
  const date = h('input', { type: 'date', required: true, value: e.date });
  const category = h('input', { type: 'text', list: `${uid}-cats`, autocomplete: 'off', autocapitalize: 'none', value: e.category, placeholder: 'e.g. cleaning' });
  const amount = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', pattern: '[0-9]*[.,]?[0-9]*', value: e.amount, placeholder: '0.00' });
  const unit = h('select', { value: e.unit_id || '' }, h('option', { value: '' }, 'Shared'), activeUnits().map((u) => h('option', { value: u.id }, u.name)));
  const paidBy = h('input', { type: 'text', list: `${uid}-payers`, autocomplete: 'off', value: e.paid_by });
  const notes = h('textarea', { rows: 2, value: e.notes || '' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });

  let receiptUrl = e.receipt_url || '';
  let uploading = false;
  let previewUrl = null;
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: `${uid}-file`, class: 'sr-only' });
  const fileLabel = h('label', { for: `${uid}-file`, class: 'btn' }, icon('camera'), receiptUrl ? 'Replace photo' : 'Add receipt photo');
  const rStatus = h('span', { class: 'hint', 'aria-live': 'polite' });
  const preview = h('div', { class: 'receipt-preview' });
  const drawPreview = () => {
    preview.replaceChildren();
    const src = previewUrl || (receiptUrl.startsWith('data:image') ? receiptUrl : '');
    if (src) preview.append(h('img', { src, alt: 'Receipt' }));
    const link = receiptUrl ? receiptLink(receiptUrl, 'linkish', 'Open receipt') : null;
    if (link) preview.append(link);
  };
  drawPreview();

  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'row2' }, field('Date', date), field(`Amount (${currency()})`, amount)),
    field('Category', category),
    h('datalist', { id: `${uid}-cats` }, CATEGORIES.map((c) => h('option', { value: c }))),
    h('div', { class: 'row2' }, field('Unit', unit), field('Paid by', paidBy)),
    h('datalist', { id: `${uid}-payers` }, payers.map((p) => h('option', { value: p }))),
    field('Notes', notes),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Receipt'),
      h('div', { class: 'receipt-row' }, fileLabel, file, rStatus), preview),
    existing?.created_at ? h('p', { class: 'meta' }, `Added ${fmtDateTime(existing.created_at)}${existing.created_by ? ' by ' + existing.created_by : ''}`) : null,
    err);

  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save');
  const closeBtn = h('button', { class: 'btn', type: 'button' }, 'Close');
  const delBtn = existing ? h('button', { class: 'btn danger push-left', type: 'button' }, 'Delete') : null;
  const dlg = openDialog({ title: existing ? 'Edit expense' : 'New expense', body: form, foot: [delBtn, closeBtn, saveBtn] });
  dlg.addEventListener('close', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    uploading = true;
    saveBtn.disabled = true;
    rStatus.textContent = 'Preparing…';
    try {
      const blob = await downscaleImage(f, 1600, 0.8);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      drawPreview();
      rStatus.textContent = 'Uploading…';
      const base64 = await blobToBase64(blob);
      const d = isISODate(date.value) ? date.value : todayISO();
      const slug = (category.value || 'receipt').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'receipt';
      const res = await actions.uploadReceipt(`${d}-${slug}-${Date.now().toString(36)}.jpg`, 'image/jpeg', base64);
      receiptUrl = res.url || '';
      rStatus.textContent = 'Uploaded';
      fileLabel.lastChild.textContent = 'Replace photo';
      drawPreview();
    } catch (ex) {
      rStatus.textContent = 'Upload failed: ' + (ex?.message || 'could not read the image');
      if (ex && ex.code) actions.report(ex); else toast(ex?.message || 'Could not read the image.', 'error');
    } finally {
      uploading = false;
      saveBtn.disabled = false;
      file.value = '';
    }
  });

  const fail = (msg, el) => { err.textContent = msg; err.hidden = false; el?.focus(); };
  async function save() {
    err.hidden = true;
    if (uploading) return;
    if (!isISODate(date.value)) return fail('Enter a date.', date);
    const cat = category.value.trim().toLowerCase();
    if (!cat) return fail('Enter a category.', category);
    const amt = Math.round(num(amount.value) * 100) / 100;
    if (!(amt > 0)) return fail('Enter an amount.', amount);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await actions.saveExpense({ ...(existing || {}), date: date.value, category: cat, amount: amt, unit_id: unit.value,
        paid_by: paidBy.value.trim(), notes: notes.value.trim(), receipt_url: receiptUrl });
      toast(existing ? 'Expense updated.' : 'Expense added.');
      dlg.close();
    } catch (ex) { actions.report(ex); } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
  form.addEventListener('submit', (ev) => { ev.preventDefault(); save(); });
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', () => dlg.close());
  delBtn?.addEventListener('click', async () => {
    const ok = await confirmDialog(`Delete this ${existing.category || 'expense'} of ${money(existing.amount, currency())}?`, { ok: 'Delete', danger: true, title: 'Delete expense' });
    if (!ok) return;
    try {
      await actions.deleteExpense(existing.id);
      toast('Expense deleted.');
      dlg.close();
    } catch (ex) { actions.report(ex); }
  });
  return dlg;
}
