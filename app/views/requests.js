// Requests: inbox of pending reservations (website requests and anything else awaiting a decision).
import { state, unitById, isOwner } from '../state.js';
import { h, icon, toast, copyText } from '../ui.js';
import { todayISO, diffDays, fmtRange, fmtDateTime, conflictsFor, plural, fromWebsite, SOURCES, LANGS } from '../lib.js';
import { openReservation, conflictList, priceBreakdown, mailtoFor, approveRequest, declineRequest } from './reservation.js';

const byCreated = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
const byArrival = (a, b) => a.check_in.localeCompare(b.check_in) || a.unit_id.localeCompare(b.unit_id);
let sort = 'arrival';

export function renderRequests(root) {
  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }
  const owner = isOwner();
  const today = todayISO();
  const list = state.reservations.filter((r) => r.status === 'pending').sort(sort === 'arrival' ? byArrival : byCreated);

  const head = h('div', { class: 'req-head' },
    h('p', { class: 'summary' }, list.length ? `${plural(list.length, 'request')} waiting` : ''),
    list.length > 1 ? h('label', { class: 'field compact req-sort' }, h('span', { class: 'sr-only' }, 'Sort'),
      h('select', { value: sort, onchange: (e) => { sort = e.target.value; renderRequests(root); } },
        h('option', { value: 'arrival' }, 'By arrival'), h('option', { value: 'received' }, 'Newest first'))) : null);
  root.append(head);

  if (!list.length) {
    root.append(h('p', { class: 'empty' }, 'No pending requests. New ones from the website appear here.'));
    return;
  }
  if (!owner) root.append(h('p', { class: 'hint note req-note' }, 'Only owners can approve. You can still edit, email or decline.'));

  root.append(h('div', { class: 'req-list' }, list.map((r) => card(r, owner, today))));
}

function card(r, owner, today) {
  const u = unitById(r.unit_id);
  const nights = diffDays(r.check_in, r.check_out);
  const web = fromWebsite(r);
  const src = SOURCES[r.source] || { mark: '??', label: r.source };
  const conf = conflictsFor({ ...r, status: 'confirmed' }, state.reservations);
  const hardConf = conf.some((c) => c.status === 'confirmed');
  const titleId = `req-${r.id}`;

  const contact = [];
  if (r.email) {
    contact.push(h('button', {
      type: 'button', class: 'contact copy', 'aria-label': `Copy email ${r.email}`, title: 'Copy email',
      onclick: async () => toast((await copyText(r.email)) ? 'Email copied.' : 'Could not copy.'),
    }, icon('mail'), h('span', { class: 'contact-text' }, r.email), icon('copy', 'ic copy-ic')));
  }
  if (r.phone) {
    contact.push(h('a', { class: 'contact', href: `tel:${r.phone.replace(/[^\d+]/g, '')}`, 'aria-label': `Call ${r.phone}` },
      icon('phone'), h('span', { class: 'contact-text' }, r.phone)));
  }

  const received = r.created_at ? `Received ${fmtDateTime(r.created_at)}` : '';
  const via = web ? ' via the website' : r.created_by ? ` · added by ${r.created_by}` : '';
  const langNote = r.email && LANGS[r.lang] && r.lang !== 'en' ? ` · emails in ${LANGS[r.lang]}` : '';

  const approveBtn = h('button', {
    class: `btn ${conf.length && r.price > 0 ? 'danger-solid' : 'primary'}`, type: 'button', disabled: !owner,
    title: owner ? null : 'Only owners can approve',
  }, r.price > 0 ? (conf.length ? 'Approve anyway' : 'Approve') : 'Set price & approve');
  approveBtn.addEventListener('click', () => busy(approveBtn, () => approveRequest(r)));
  const declineBtn = h('button', { class: 'btn danger', type: 'button' }, 'Decline');
  declineBtn.addEventListener('click', () => busy(declineBtn, () => declineRequest(r)));
  const editBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Edit');
  editBtn.addEventListener('click', () => openReservation(r));

  return h('article', { class: `pitem req${web ? ' web' : ''}`, 'aria-labelledby': titleId },
    h('div', { class: 'pitem-head' },
      h('span', { class: 'dot', style: `background:${u?.color || 'var(--sea)'}` }),
      h('h3', { id: titleId, class: 'req-name' }, r.guest_name || 'Unnamed'),
      web ? h('span', { class: 'badge web' }, icon('mail', 'ic tiny'), 'Website') : null,
      h('abbr', { class: 'src plain', title: src.label }, src.mark)),
    h('p', { class: 'req-stay' },
      h('strong', null, fmtRange(r.check_in, r.check_out)), ` · ${plural(nights, 'night')} · ${u?.name || r.unit_id}`,
      r.guests ? ` · ${plural(r.guests, 'guest')}` : '',
      u?.capacity && r.guests > u.capacity ? h('span', { class: 'bad' }, ` (sleeps ${u.capacity})`) : null),
    h('p', { class: 'pitem-meta' }, received + via + langNote,
      r.check_in < today ? h('span', { class: 'bad' }, ' · arrival date has passed') : null),
    contact.length ? h('div', { class: 'contacts' }, contact) : null,
    r.notes ? h('blockquote', { class: 'req-msg' }, r.notes) : null,
    r.price > 0
      ? priceBreakdown(r)
      : h('p', { class: 'hint req-noprice' }, 'No price yet.', owner ? ' Approving asks for it first.' : ''),
    conf.length ? h('div', { class: `warn${hardConf ? ' strong' : ''}` },
      h('p', { class: 'warn-title' }, icon('warn'), hardConf ? 'Overlaps a confirmed stay:' : 'Overlaps other requests:'),
      conflictList(conf)) : null,
    h('div', { class: 'pitem-actions req-actions' },
      r.email ? h('a', { class: 'btn ghost push-left', href: mailtoFor(r) }, icon('mail'), 'Email guest') : null,
      editBtn, declineBtn, approveBtn));
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { if (btn.isConnected) btn.disabled = false; }
}
