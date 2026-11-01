// Requests: inbox of pending reservations (website requests and anything else awaiting a decision).
import { state, unitById, isOwner, groupMembers, currency } from '../state.js';
import { h, icon, toast, copyText } from '../ui.js';
import { todayISO, diffDays, fmtRange, fmtDateTime, conflictsFor, plural, fromWebsite, money, SOURCES, LANGS, STATUSES } from '../lib.js';
import { openReservation, conflictList, priceBreakdown, mailtoFor, approveRequest, declineRequest, extrasSummary, unpricedExtras,
  approveGroup, declineGroup, groupSum } from './reservation.js';

const byCreated = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
const byArrival = (a, b) => a.check_in.localeCompare(b.check_in) || a.unit_id.localeCompare(b.unit_id);
let sort = 'arrival';

export function renderRequests(root) {
  root.replaceChildren();
  if (!state.loaded) { root.append(h('p', { class: 'empty' }, state.offline ? 'Offline, and no saved data on this device yet.' : 'Loading…')); return; }
  const owner = isOwner();
  const today = todayISO();
  // Whole-house requests (same group_id) become one item: {r: first member, members}.
  const items = [];
  const groups = new Map();
  for (const r of state.reservations) {
    if (r.status !== 'pending') continue;
    if (!r.group_id) { items.push({ r, members: [r] }); continue; }
    if (groups.has(r.group_id)) continue;
    const members = groupMembers(r).filter((x) => x.status === 'pending');
    groups.set(r.group_id, true);
    items.push({ r: members[0], members });
  }
  const list = items.sort((a, b) => (sort === 'arrival' ? byArrival : byCreated)(a.r, b.r));

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

  root.append(h('div', { class: 'req-list' }, list.map(({ r, members }) => (r.group_id ? groupCard(members, owner, today) : card(r, owner, today)))));
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

  const tbd = unpricedExtras(r);
  const ready = r.price > 0 && !tbd.length;
  const approveBtn = h('button', {
    class: `btn ${conf.length && ready ? 'danger-solid' : 'approve'}`, type: 'button', disabled: !owner,
    title: owner ? null : 'Only owners can approve',
  }, ready ? (conf.length ? 'Approve anyway' : 'Approve') : 'Set price & approve');
  approveBtn.addEventListener('click', () => busy(approveBtn, () => approveRequest(r)));
  const declineBtn = h('button', { class: 'btn danger-solid', type: 'button' }, 'Decline');
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
    extrasSummary(r),
    tbd.length ? h('p', { class: 'tbd-note' }, icon('warn', 'ic tiny'),
      ` ${tbd.map((x) => x.name).join(', ')}: agree the price with the guest and set it before approving.`) : null,
    conf.length ? h('div', { class: `warn${hardConf ? ' strong' : ''}` },
      h('p', { class: 'warn-title' }, icon('warn'), hardConf ? 'Overlaps a confirmed stay:' : 'Overlaps other requests:'),
      conflictList(conf)) : null,
    h('div', { class: 'pitem-actions req-actions' },
      r.email ? h('a', { class: 'btn ghost push-left', href: mailtoFor(r) }, icon('mail'), 'Contact') : null,
      editBtn, declineBtn, approveBtn));
}

function contactsOf(r) {
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
  return contact.length ? h('div', { class: 'contacts' }, contact) : null;
}

/** One card for a whole-house request: every apartment, total guests, group total and deposit, extras from the first. */
function groupCard(members, owner, today) {
  const r = members[0];
  const all = groupMembers(r);
  const nights = diffDays(r.check_in, r.check_out);
  const web = fromWebsite(r);
  const src = SOURCES[r.source] || { mark: '??', label: r.source };
  const cur = currency();
  const guests = members.reduce((s, m) => s + (Number(m.guests) || 0), 0);
  const conf = members.flatMap((m) => conflictsFor({ ...m, status: 'confirmed' }, state.reservations)
    .filter((c) => !(c.group_id && c.group_id === r.group_id)));
  const hardConf = conf.some((c) => c.status === 'confirmed');
  const unpriced = members.filter((m) => !(m.price > 0));
  const tbd = unpricedExtras(r);
  const ready = !unpriced.length && !tbd.length;
  const sum = groupSum(members);
  const others = all.filter((m) => !members.includes(m));
  const titleId = `req-g-${r.group_id}`;
  const received = r.created_at ? `Received ${fmtDateTime(r.created_at)}` : '';
  const via = web ? ' via the website' : r.created_by ? ` · added by ${r.created_by}` : '';
  const langNote = r.email && LANGS[r.lang] && r.lang !== 'en' ? ` · emails in ${LANGS[r.lang]}` : '';

  const approveBtn = h('button', {
    class: `btn ${conf.length && ready ? 'danger-solid' : 'approve'}`, type: 'button', disabled: !owner,
    title: owner ? null : 'Only owners can approve',
  }, ready ? (conf.length ? 'Approve all anyway' : 'Approve all') : 'Set prices first');
  approveBtn.addEventListener('click', () => busy(approveBtn, () => approveGroup(members)));
  const declineBtn = h('button', { class: 'btn danger-solid', type: 'button' }, 'Decline all');
  declineBtn.addEventListener('click', () => busy(declineBtn, () => declineGroup(members)));
  const editBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Edit');
  editBtn.addEventListener('click', () => openReservation(unpriced[0] || r));

  return h('article', { class: `pitem req group${web ? ' web' : ''}`, 'aria-labelledby': titleId },
    h('div', { class: 'pitem-head' },
      icon('link', 'ic group-ic'),
      h('h3', { id: titleId, class: 'req-name' }, `Whole house · ${plural(members.length, 'apartment')}`),
      web ? h('span', { class: 'badge web' }, icon('mail', 'ic tiny'), 'Website') : null,
      h('abbr', { class: 'src plain', title: src.label }, src.mark)),
    h('p', { class: 'req-guest' }, r.guest_name || 'Unnamed'),
    h('p', { class: 'req-stay' },
      h('strong', null, fmtRange(r.check_in, r.check_out)), ` · ${plural(nights, 'night')}`, guests ? ` · ${plural(guests, 'guest')} in total` : ''),
    h('p', { class: 'pitem-meta' }, received + via + langNote,
      r.check_in < today ? h('span', { class: 'bad' }, ' · arrival date has passed') : null),
    h('ul', { class: 'group-units' }, members.map((m) => {
      const u = unitById(m.unit_id);
      return h('li', null,
        h('button', { type: 'button', class: 'gu-row', onclick: () => openReservation(m), 'aria-label': `Open ${u?.name || m.unit_id}` },
          h('span', { class: 'dot', style: `background:${u?.color || 'var(--sea)'}` }),
          h('span', { class: 'gu-name' }, u?.name || m.unit_id),
          h('span', { class: 'gu-guests' }, m.guests ? plural(m.guests, 'guest') : 'no guests',
            u?.capacity && m.guests > u.capacity ? h('span', { class: 'bad' }, ` (sleeps ${u.capacity})`) : null),
          h('span', { class: 'gu-price num' }, m.price > 0 ? money(m.price, cur) : h('span', { class: 'bad' }, 'no price'))));
    })),
    others.length ? h('p', { class: 'hint' }, `Also in this booking, not pending: ${others.map((m) => `${unitById(m.unit_id)?.name || m.unit_id} (${(STATUSES[m.status] || m.status).toLowerCase()})`).join(', ')}. Approve and Decline apply to every apartment of the booking.`) : null,
    contactsOf(r),
    r.notes ? h('blockquote', { class: 'req-msg' }, r.notes) : null,
    sum.price > 0 && !unpriced.length ? priceBreakdown(sum)
      : h('p', { class: 'hint req-noprice' }, unpriced.length === members.length ? 'No prices yet.' : `No price yet for ${unpriced.map((m) => unitById(m.unit_id)?.name || m.unit_id).join(', ')}.`,
        ' Set each apartment\'s price (Edit), then approve.'),
    extrasSummary({ ...r, guests }), // extras are priced for the whole group
    tbd.length ? h('p', { class: 'tbd-note' }, icon('warn', 'ic tiny'),
      ` ${tbd.map((x) => x.name).join(', ')}: agree the price with the guest and set it (on ${unitById(r.unit_id)?.name || r.unit_id}) before approving.`) : null,
    conf.length ? h('div', { class: `warn${hardConf ? ' strong' : ''}` },
      h('p', { class: 'warn-title' }, icon('warn'), hardConf ? 'Overlaps a confirmed stay:' : 'Overlaps other requests:'),
      conflictList(conf)) : null,
    h('div', { class: 'pitem-actions req-actions' },
      r.email ? h('a', { class: 'btn ghost push-left', href: mailtoFor(r) }, icon('mail'), 'Contact') : null,
      editBtn, declineBtn, approveBtn));
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { if (btn.isConnected) btn.disabled = false; }
}
