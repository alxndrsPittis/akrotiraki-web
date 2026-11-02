// Akrotiraki — request to stay in three steps (dates and guests → apartment with prices → details).
// Public, tokenless actions of the ops API: availability (once per page), quote (one per bookable
// apartment per search, in parallel, cached), requestStay. Contract: akrotiraki-ops/docs/API.md.
// The backend URL lives in one place: window.AKRO_API in site.js.
(function () {
  'use strict';
  var root = document.getElementById('booking');
  var form = document.getElementById('stay-form');
  if (!root || !form) return;

  var API = window.AKRO_API || root.getAttribute('data-api');
  var PHOTOS = root.getAttribute('data-photo-base') || 'photos/';
  var T = window.AKRO_T || {};
  var LANG = (document.documentElement.lang || 'en').slice(0, 2);
  var LOCALE = { en: 'en-GB', el: 'el-GR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' }[LANG] || 'en-GB';
  var OPENED = Date.now();                     // `t`: when the form was opened
  var MIN_FILL_MS = 4000;                       // backend rejects faster submissions
  var MAX_GUESTS = 12, DEFAULT_GUESTS = 2, HOUSE_GUESTS = 8;   // the whole house; single apartments are marked "sleeps up to N"

  // Fallback units if `availability` is unreachable (ids as seeded by the backend's setup).
  var FALLBACK = (root.getAttribute('data-fallback-units') || '').split(',').filter(Boolean).map(function (s) {
    var p = s.split(':'); return { id: p[0], type: p[1], capacity: Number(p[2]) || 2 };
  });
  // Card photo and size by apartment type
  var TYPE = {
    maisonette: { photo: 'terrace-view.webp', w: 765, h: 1020, sqm: 55 },
    studio: { photo: 'houses-above.webp', w: 1360, h: 906, sqm: 21 },
    house: { photo: 'house-bay-above.webp', w: 1360, h: 1020 }
  };
  var HOUSE = { id: 'ALL', type: 'house', capacity: 12 };

  /* ---------------------------------------------------------------- dates */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function nights(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  var TODAY = iso(new Date());
  var fmtLong = new Intl.DateTimeFormat(LANG, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var fmtShort = new Intl.DateTimeFormat(LANG, { day: 'numeric', month: 'short' });
  var fmtMonth = new Intl.DateTimeFormat(LANG, { month: 'long', year: 'numeric' });
  var fmtWd = new Intl.DateTimeFormat(LANG, { weekday: 'narrow' });
  var fmtDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
  function range(a, b) {
    try { if (fmtDay.formatRange) return fmtDay.formatRange(parse(a), parse(b)); } catch (e) {}
    return fmtDay.format(parse(a)) + ' – ' + fmtDay.format(parse(b));
  }
  function money(v, cur) {
    try {
      return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur || 'EUR', useGrouping: 'always',
        minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
    } catch (e) { return v + ' ' + (cur || 'EUR'); }
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ------------------------------------------------------------------ api */
  function call(action, payload) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
      body: JSON.stringify({ action: action, payload: payload || {} })
    }).then(function (r) { return r.json(); });
  }

  /* ---------------------------------------------------- availability data */
  var avail = null;           // {units, taken, pending}, loaded once per page
  function units() { return (avail && avail.units && avail.units.length) ? avail.units : FALLBACK; }
  function overlaps(list, unitId, a, b) {   // any stay of unitId overlapping [a, b)
    return (list || []).some(function (s) { return s.unit_id === unitId && s.check_in < b && a < s.check_out; });
  }
  function unitState(id, a, b) {
    if (!avail) return 'free';
    if (overlaps(avail.taken, id, a, b)) return 'taken';
    return overlaps(avail.pending, id, a, b) ? 'pending' : 'free';
  }
  // Night starting on `day`: free if any apartment is free, else on request, else taken.
  function nightState(day) {
    if (day < TODAY) return 'past';
    if (!avail) return 'free';
    var next = addDays(day, 1), anyPending = false, list = units();
    for (var i = 0; i < list.length; i++) {
      var s = unitState(list[i].id, day, next);
      if (s === 'free') return 'free';
      if (s === 'pending') anyPending = true;
    }
    return anyPending ? 'pending' : 'taken';
  }
  // Nearest window of the same length within ±14 days with no confirmed stay of this unit.
  function nearestFree(id, a, b) {
    if (!avail) return null;
    var n = nights(a, b);
    for (var d = 1; d <= 14; d++) {
      var cands = [addDays(a, -d), addDays(a, d)];
      for (var c = 0; c < 2; c++) {
        var s = cands[c];
        if (s >= TODAY && !overlaps(avail.taken, id, s, addDays(s, n))) return [s, addDays(s, n)];
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- steps */
  var steps = [1, 2, 3].map(function (n) { return document.getElementById('step-' + n); });
  var marks = form.querySelectorAll('.steps li');
  var current = 1;
  function show(n, focus) {
    current = n;
    steps.forEach(function (s, i) { s.hidden = i !== n - 1; });
    Array.prototype.forEach.call(marks, function (li, i) {
      if (i === n - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', i < n - 1);
    });
    if (focus !== false) {
      var h = steps[n - 1].querySelector('h3');
      if (h) { h.focus({ preventScroll: true }); }
      var r = form.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) form.scrollIntoView({ block: 'start' });
    }
  }
  form.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (b) { e.preventDefault(); show(Number(b.getAttribute('data-go'))); }
  });

  /* -------------------------------------------------------------- calendar */
  var cal = document.getElementById('cal');
  var monthsEl = document.getElementById('cal-months');
  var statusEl = document.getElementById('cal-status');
  var fIn = form.elements.check_in, fOut = form.elements.check_out, fGuests = form.elements.guests;
  var first = new Date(), focusDay = null;
  first.setDate(1);
  var LAST = new Date(); LAST.setDate(1); LAST.setMonth(LAST.getMonth() + 11);   // 12 months shown
  var wide = window.matchMedia('(min-width: 720px)');

  function render() {
    if (!cal || cal.hidden) return;
    var count = wide.matches ? 2 : 1, html = '', a = fIn.value, b = fOut.value;
    for (var m = 0; m < count; m++) {
      var mDate = new Date(first.getFullYear(), first.getMonth() + m, 1);
      if (mDate > LAST) break;
      html += '<div class="cal-month"><h4 class="cal-month-title">' + fmtMonth.format(mDate) + '</h4>' +
        '<div class="cal-grid" role="group" aria-label="' + fmtMonth.format(mDate) + '">';
      for (var w = 0; w < 7; w++) html += '<span class="cal-wd" aria-hidden="true">' + fmtWd.format(new Date(2024, 0, 1 + w)) + '</span>';
      var lead = (mDate.getDay() + 6) % 7;
      for (var i = 0; i < lead; i++) html += '<span class="cal-pad" aria-hidden="true"></span>';
      var dim = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate();
      for (var d = 1; d <= dim; d++) {
        var day = iso(new Date(mDate.getFullYear(), mDate.getMonth(), d));
        var st = nightState(day), cls = 'cal-day is-' + st, extra = '';
        if (a && day === a) { cls += ' is-start'; extra = ', ' + T.selArrival; }
        else if (b && day === b) { cls += ' is-end'; extra = ', ' + T.selDeparture; }
        else if (a && b && day > a && day < b) { cls += ' is-in'; extra = ', ' + T.selStay; }
        var label = fmtLong.format(parse(day)) + ', ' + ({ free: T.free, pending: T.onRequest, taken: T.taken, past: T.past }[st]) + extra;
        var inert = st === 'past' || (st === 'taken' && !canEnd(day));
        html += '<button type="button" class="' + cls + '" data-day="' + day + '" tabindex="-1" aria-label="' + label + '"' +
          (inert ? ' aria-disabled="true"' : '') + (a === day || b === day ? ' aria-pressed="true"' : '') + '>' + d + '</button>';
      }
      html += '</div></div>';
    }
    monthsEl.innerHTML = html;
    var now = new Date(); now.setDate(1);
    cal.querySelector('.cal-prev').disabled = first <= now;
    cal.querySelector('.cal-next').disabled = new Date(first.getFullYear(), first.getMonth() + count, 1) > LAST;
    var target = (focusDay && monthsEl.querySelector('[data-day="' + focusDay + '"]')) ||
      monthsEl.querySelector('[data-day="' + a + '"]') ||
      monthsEl.querySelector('.cal-day:not([aria-disabled])') || monthsEl.querySelector('.cal-day');
    if (target) target.tabIndex = 0;
  }
  // A taken day can still be a departure day if no night before it, from the arrival, is taken.
  function canEnd(day) {
    var a = fIn.value;
    if (!a || fOut.value || day <= a) return false;
    for (var d = a; d < day; d = addDays(d, 1)) if (nightState(d) === 'taken') return false;
    return true;
  }
  function announce(text) { if (statusEl) statusEl.textContent = text; }
  function pick(day) {
    var a = fIn.value, b = fOut.value, st = nightState(day);
    if (a && !b && day > a && canEnd(day)) {
      fOut.value = day;
      announce(T.pickedRange(nights(a, day), fmtShort.format(parse(a)), fmtShort.format(parse(day))));
    } else if (st === 'free' || st === 'pending') {
      fIn.value = day; fOut.value = quickN ? addDays(day, quickN) : '';
      announce(quickN ? T.pickedRange(quickN, fmtShort.format(parse(day)), fmtShort.format(parse(fOut.value)))
        : T.pickedArrival(fmtShort.format(parse(day))));
    } else return;
    clearFieldError('check_in'); clearFieldError('check_out');
    syncMin(); focusDay = day; render(); nightsUI();
    var btn = monthsEl.querySelector('[data-day="' + day + '"]'); if (btn) btn.focus();
  }
  if (cal) {
    monthsEl.addEventListener('click', function (e) { var b = e.target.closest('.cal-day'); if (b) pick(b.getAttribute('data-day')); });
    monthsEl.addEventListener('keydown', function (e) {
      var b = e.target.closest('.cal-day'); if (!b) return;
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      var day = addDays(b.getAttribute('data-day'), step);
      if (day < TODAY) return;
      var target = monthsEl.querySelector('[data-day="' + day + '"]');
      focusDay = day;
      if (!target) {
        var d = parse(day); first = new Date(d.getFullYear(), d.getMonth() - (step > 0 && wide.matches ? 1 : 0), 1);
        var now = new Date(); now.setDate(1); if (first < now) first = now;
        render(); target = monthsEl.querySelector('[data-day="' + day + '"]');
      }
      if (target) { monthsEl.querySelectorAll('.cal-day').forEach(function (x) { x.tabIndex = -1; }); target.tabIndex = 0; target.focus(); }
    });
    cal.querySelector('.cal-prev').addEventListener('click', function () { first.setMonth(first.getMonth() - 1); focusDay = null; render(); });
    cal.querySelector('.cal-next').addEventListener('click', function () { first.setMonth(first.getMonth() + 1); focusDay = null; render(); });
    wide.addEventListener('change', render);
  }
  function syncMin() { fIn.min = TODAY; fOut.min = fIn.value ? addDays(fIn.value, 1) : addDays(TODAY, 1); }
  // "Nights" quick choice: sets departure = arrival + n; editing the departure updates the count and
  // clears the choice when it no longer matches.
  var nightsSeg = document.getElementById('nights-seg'), nightsOut = document.getElementById('nights-out'), quickN = 0;
  function nightsUI() {
    var n = fIn.value && fOut.value && fOut.value > fIn.value ? nights(fIn.value, fOut.value) : 0;
    if (quickN && n && n !== quickN) quickN = 0;   // a different departure clears the quick choice
    if (nightsSeg) Array.prototype.forEach.call(nightsSeg.querySelectorAll('[data-n]'), function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-n')) === quickN));
    });
    if (nightsOut) nightsOut.textContent = n ? T.nightsN(n) : '';
  }
  function applyQuick() {
    if (!quickN || !fIn.value) return;
    fOut.value = addDays(fIn.value, quickN);
    clearFieldError('check_out'); syncMin(); render();
  }
  if (nightsSeg) nightsSeg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-n]'); if (!b) return;
    quickN = Number(b.getAttribute('data-n'));
    if (fIn.value) applyQuick(); else { nightsUI(); fIn.focus(); return; }
    nightsUI();
  });
  fIn.addEventListener('change', function () {
    if (quickN && fIn.value) fOut.value = addDays(fIn.value, quickN);
    if (fOut.value && fOut.value <= fIn.value) fOut.value = '';
    syncMin(); focusDay = fIn.value || null;
    if (fIn.value) { var d = parse(fIn.value); first = new Date(d.getFullYear(), d.getMonth(), 1); }
    render();
  });
  fOut.addEventListener('change', function () { render(); nightsUI(); });
  fIn.addEventListener('change', nightsUI);
  fGuests.max = MAX_GUESTS;
  syncMin();

  /* ---------------------------------------------------------------- errors */
  var errBox = document.getElementById('form-error');
  var FIELD_INPUT = { unit_id: 'unit_id', check_in: 'check_in', check_out: 'check_out', guests: 'guests',
    email: 'email', guest_name: 'guest_name', phone: 'phone', message: 'message', extras_note: 'extras_note', extras: 'extras_note' };
  var FIELD_STEP = { check_in: 1, check_out: 1, unit_id: 2 };
  function fieldError(field, text) {
    var p = document.getElementById('err-' + field); if (p) { p.textContent = text; p.hidden = false; }
    Array.prototype.forEach.call(form.querySelectorAll('[name="' + FIELD_INPUT[field] + '"]'), function (el) { el.setAttribute('aria-invalid', 'true'); });
  }
  function clearFieldError(field) {
    var p = document.getElementById('err-' + field); if (p) { p.hidden = true; p.textContent = ''; }
    Array.prototype.forEach.call(form.querySelectorAll('[name="' + FIELD_INPUT[field] + '"]'), function (el) { el.removeAttribute('aria-invalid'); });
  }
  function clearAll() { Object.keys(FIELD_INPUT).forEach(clearFieldError); errBox.hidden = true; }
  function general(text) { errBox.textContent = text; errBox.hidden = false; }
  ['guest_name', 'email', 'phone', 'guests', 'message', 'check_out'].forEach(function (f) {
    var el = form.elements[FIELD_INPUT[f]]; if (el) el.addEventListener('input', function () { clearFieldError(f); });
  });
  function focusField(f) { var el = form.querySelector('[name="' + FIELD_INPUT[f] + '"]'); if (el && el.focus) el.focus(); }

  /* ----------------------------------------------------- step 1 → step 2 */
  var sel = null;                 // {a, b}
  var lastChosen = null;
  var chosen = null;              // unit id
  var quotes = {};                // 'unit|a|b' → promise of quote data (or null)
  var cards = document.getElementById('apt-cards');
  var availP = Promise.resolve();

  function step1Errors() {
    var a = fIn.value, b = fOut.value, errs = {};
    if (!a) errs.check_in = T.err.check_in;
    else if (a < TODAY) errs.check_in = T.err.check_in_past;
    if (!b || (a && b <= a)) errs.check_out = T.err.check_out;
    else if (a && nights(a, b) > 60) errs.check_out = T.err.check_out_long;
    return errs;
  }
  function search() {
    ['check_in', 'check_out'].forEach(clearFieldError);
    var errs = step1Errors(), keys = Object.keys(errs);
    if (keys.length) { keys.forEach(function (k) { fieldError(k, errs[k]); }); focusField(keys[0]); return; }
    sel = { a: fIn.value, b: fOut.value };
    document.getElementById('s2-summary').textContent = range(sel.a, sel.b) + ' · ' + T.nightsN(nights(sel.a, sel.b));
    cards.setAttribute('aria-busy', 'true');
    cards.innerHTML = '<p class="cards-loading">' + esc(T.cardLoading) + '</p>' +
      '<div class="apt-card is-skeleton" aria-hidden="true"></div><div class="apt-card is-skeleton" aria-hidden="true"></div>';
    show(2);
    var s = sel;
    availP.then(function () {
      var list = units().slice(0, 4).map(function (u) {
        var st = unitState(u.id, s.a, s.b), key = u.id + '|' + s.a + '|' + s.b;
        if (st !== 'taken' && !quotes[key]) {
          quotes[key] = call('quote', { unit_id: u.id, check_in: s.a, check_out: s.b, guests: DEFAULT_GUESTS })
            .then(function (r) { return r && r.ok && r.data ? r.data : null; }, function () { return null; });
        }
        return { u: u, st: st, q: st === 'taken' ? Promise.resolve(null) : quotes[key] };
      });
      var houseFree = list.length > 0 && list.every(function (x) { return x.st !== 'taken'; });
      var hk = 'ALL|' + s.a + '|' + s.b;
      if (houseFree && !quotes[hk]) {
        quotes[hk] = call('quote', { unit_id: 'ALL', check_in: s.a, check_out: s.b, guests: HOUSE_GUESTS, lang: LANG })
          .then(function (r) { return r && r.ok && r.data ? r.data : null; }, function () { return null; });
      }
      list.push({ u: HOUSE, st: houseFree ? 'free' : 'taken', house: true, q: houseFree ? quotes[hk] : Promise.resolve(null) });
      return Promise.all(list.map(function (x) { return x.q; })).then(function (qs) {
        if (sel !== s) return;          // a newer search started
        list.forEach(function (x, i) { x.quote = qs[i]; });
        renderCards(list, s);
      });
    });
  }
  document.getElementById('s1-go').addEventListener('click', search);

  function typeIndex(u) {   // "Maisonette 1", "Studio 2": number within its type, by id
    var same = units().filter(function (x) { return x.type === u.type; }).map(function (x) { return x.id; }).sort();
    return same.indexOf(u.id) + 1;
  }
  function unitName(u) { return u.id === 'ALL' ? T.houseName : (T[u.type] || u.type) + ' ' + typeIndex(u); }
  function unitById(id) { return units().filter(function (u) { return u.id === id; })[0]; }

  function priceBlock(q) {
    if (!q || q.incomplete) return '<p class="apt-total">' + esc(T.cardOnRequest) + '</p>';
    var cur = q.currency, groups = [], by = {};
    (q.nightly || []).forEach(function (x) {
      var k = String(x.price);
      if (!by[k]) { by[k] = { price: x.price, count: 0 }; groups.push(by[k]); }
      by[k].count++;
    });
    var bd = groups.map(function (g) { return money(g.price, cur) + ' × ' + g.count; }).join(' + ');
    bd = T.cardNights(bd, groups.length ? groups[groups.length - 1].count : q.nights);
    var fee = Number(q.cleaning_fee) || 0;
    if (fee) bd += ', ' + T.quoteCleaning(money(fee, cur));
    var html = '<p class="apt-total">' + esc(T.cardTotal(money(q.total, cur), T.nightsN(q.nights))) + '</p>' +
      '<p class="apt-breakdown">' + esc(bd) + '</p>';
    var disc = Number(q.rule_discount) || 0;
    if (disc > 0) html += '<p class="apt-discount">' + esc(T.quoteDiscount(Number(q.rule_percent) || 0, q.rule_name || '', money(disc, cur))) + '</p>';
    return html;
  }

  function housePrice(q) {
    if (!q || q.incomplete) return '<p class="apt-total">' + esc(T.cardOnRequest) + '</p>';
    var cur = q.currency;
    var bd = (q.units || []).map(function (x) {
      var u = unitById(x.unit_id);
      return (u ? unitName(u) : (x.name || x.unit_id)) + ' ' + (x.incomplete ? T.cardOnRequest : money(x.total, cur));
    }).join(', ');
    var html = '<p class="apt-total">' + esc(T.cardTotal(money(q.total, cur), T.nightsN(q.nights))) + '</p>' +
      (bd ? '<p class="apt-breakdown">' + esc(bd) + '</p>' : '');
    var disc = Number(q.rule_discount) || 0;
    if (disc > 0) html += '<p class="apt-discount">' + esc(T.houseDiscount(money(disc, cur))) + '</p>';
    return html;
  }
  // Next whole-house windows of at least `n` nights (from availability.all_free_windows, `to` exclusive).
  function houseWindows(n) {
    return ((avail && avail.all_free_windows) || []).filter(function (w) {
      return w.to > TODAY && nights(w.from < TODAY ? TODAY : w.from, w.to) >= n;
    }).slice(0, 6).map(function (w) { return { from: w.from < TODAY ? TODAY : w.from, to: w.to }; });
  }

  function renderCards(list, s) {
    list.forEach(function (x) {
      var cap = Number(x.u.capacity) || 2;
      x.small = false;   // capacity is information only; the guest count is asked in step 3
      x.min = x.quote && x.quote.below_min ? x.quote.min_nights : 0;
      x.ok = x.st !== 'taken' && !x.small && !x.min;
      x.price = x.quote && !x.quote.incomplete ? Number(x.quote.total) : Infinity;
    });
    // apartments: bookable first, then by price; the whole house always last
    list.sort(function (p, q) { return (!!p.house - !!q.house) || (q.ok - p.ok) || (p.price - q.price) || (p.u.id < q.u.id ? -1 : 1); });
    var html = '';
    if (!list.some(function (x) { return x.ok; })) html += '<p class="cards-none">' + esc(T.cardNone) + '</p>';
    list.forEach(function (x) {
      if (x.house) { html += houseCard(x, s); return; }
      var u = x.u, t = TYPE[u.type] || TYPE.studio, cap = Number(u.capacity) || 2, notes = '';
      if (x.st === 'taken') {
        notes += '<p class="apt-note">' + esc(T.cardTaken) + '</p>';
        var w = nearestFree(u.id, s.a, s.b);
        if (w) notes += '<p class="apt-note">' + esc(T.cardFree(range(w[0], w[1]))) + '</p>';
      } else if (x.st === 'pending') notes += '<p class="apt-note">' + esc(T.cardPending) + '</p>';
      if (x.small) notes += '<p class="apt-note is-strong">' + esc(T.cardUpTo(cap)) + '</p>';
      if (x.min) notes += '<p class="apt-note is-strong">' + esc(T.minStay(x.min)) + '</p>';
      html += '<article class="apt-card is-' + x.st + (x.ok ? '' : ' is-off') + '" aria-labelledby="apt-' + u.id + '">' +
        '<img src="' + PHOTOS + t.photo + '" width="' + t.w + '" height="' + t.h + '" loading="lazy" decoding="async" alt="">' +
        '<div class="apt-body"><h4 id="apt-' + u.id + '">' + esc(unitName(u)) + '</h4>' +
        '<p class="apt-meta">' + esc([T[u.type] || u.type, T.sqm(t.sqm), T.cardSleeps(Math.min(2, cap), cap)].join(' · ')) + '</p>' +
        '<p class="apt-desc">' + esc(u.type === 'maisonette' ? T.descMaisonette : T.descStudio) + '</p>' +
        (x.st === 'taken' ? '' : '<div class="apt-price">' + priceBlock(x.quote) + '</div>') + notes +
        (x.ok ? '<button type="button" class="btn btn-solid" data-unit="' + esc(u.id) + '">' + esc(T.cardRequest) + '</button>' : '') +
        '</div></article>';
    });
    cards.innerHTML = html;
    cards.removeAttribute('aria-busy');
    cards.__list = list;
  }
  function houseCard(x, s) {
    var t = TYPE.house, notes = '';
    if (x.st === 'taken') {
      notes += '<p class="apt-note">' + esc(T.cardTaken) + '</p>' +
        '<p><button type="button" class="link-btn" data-find aria-expanded="false" aria-controls="house-windows">' + esc(T.houseFind) + '</button></p>' +
        '<div class="house-windows" id="house-windows" hidden></div>';
    }
    if (x.min) notes += '<p class="apt-note is-strong">' + esc(T.minStay(x.min)) + '</p>';
    return '<article class="apt-card is-house is-' + x.st + (x.ok ? '' : ' is-off') + '" aria-labelledby="apt-ALL">' +
      '<img src="' + PHOTOS + t.photo + '" width="' + t.w + '" height="' + t.h + '" loading="lazy" decoding="async" alt="">' +
      '<div class="apt-body"><h4 id="apt-ALL">' + esc(T.houseName) + '</h4>' +
      '<p class="apt-meta">' + esc(T.houseMeta) + '</p>' +
      (x.st === 'taken' ? '' : '<div class="apt-price">' + housePrice(x.quote) + '</div>') + notes +
      (x.ok ? '<button type="button" class="btn btn-solid" data-unit="ALL">' + esc(T.houseRequest) + '</button>' : '') +
      '</div></article>';
  }
  // "Find dates" for the whole house: list the next free windows; picking one sets the dates and searches again.
  cards.addEventListener('click', function (e) {
    var f = e.target.closest('[data-find]');
    if (f) {
      var box = document.getElementById('house-windows'), n = nights(sel.a, sel.b), ws = houseWindows(n);
      box.innerHTML = ws.length ? '<ul class="win-list">' + ws.map(function (w) {
        var to = addDays(w.from, n);
        return '<li><button type="button" class="link-btn" data-win="' + w.from + '|' + to + '">' +
          esc(T.houseWindow(range(w.from, w.to), nights(w.from, w.to))) + '</button></li>';
      }).join('') + '</ul>' : '<p class="apt-note">' + esc(T.houseNoWindow) + '</p>';
      box.hidden = !box.hidden;
      f.setAttribute('aria-expanded', String(!box.hidden));
      return;
    }
    var w = e.target.closest('[data-win]');
    if (w) {
      var p = w.getAttribute('data-win').split('|');
      fIn.value = p[0]; fOut.value = p[1]; syncMin();
      var d = parse(p[0]); first = new Date(d.getFullYear(), d.getMonth(), 1); render();
      search();
    }
  });

  /* ---------------------------------------------------------------- extras */
  // Loaded once per page (public `extras`); shown in step 3 for the chosen apartment. The summary line
  // re-quotes with the selection (debounced) so the total includes the paid extras.
  var EXTRAS = null, exState = {}, exBox = document.getElementById('extras'), exTimer = null, exSeq = 0, chosenX = null;
  function exName(e) { return (e.names && e.names[LANG]) || e.name || e.id; }
  function exFits(e, u) {
    if (u.id === 'ALL') return !e.unit_id && !e.unit_type;
    if (e.unit_id && String(e.unit_id).toLowerCase() !== String(u.id).toLowerCase()) return false;
    if (e.unit_type && String(e.unit_type).toLowerCase() !== String(u.type).toLowerCase()) return false;
    return true;
  }
  function exUnitPrice(e, st) {
    var o = (e.options || []).filter(function (x) { return x.label === st.option; })[0];
    return o && o.price != null ? o.price : e.price;
  }
  function exPriceText(e, st) {
    if (e.category === 'quote') return T.exOnRequest;
    if (e.category !== 'paid') return '';
    return T.exPer(e.kind, money(Number(exUnitPrice(e, st)) || 0, EXTRAS && EXTRAS.currency));
  }
  function renderExtras(u) {
    if (!exBox) return;
    var list = (EXTRAS && EXTRAS.extras || []).filter(function (e) { return exFits(e, u); });
    var groups = [['paid', T.exPaid], ['request', T.exRequest], ['quote', T.exQuote]], html = '';
    groups.forEach(function (g) {
      var items = list.filter(function (e) { return (e.category || 'paid') === g[0]; });
      if (!items.length) return;
      html += '<fieldset class="ex-group"><legend>' + esc(g[1]) + '</legend>';
      items.forEach(function (e) {
        var st = exState[e.id] || (exState[e.id] = { on: false, qty: 1, option: e.options && e.options.length ? e.options[0].label : '' });
        var id = 'ex-' + e.id, max = Math.max(1, Number(e.max_qty) || 1);
        html += '<div class="ex-item" data-ex="' + esc(e.id) + '"><label class="ex-check" for="' + id + '"><input type="checkbox" id="' + id + '"' + (st.on ? ' checked' : '') + '> <span>' + esc(exName(e)) + '</span></label>';
        if (e.options && e.options.length) {
          html += '<select class="ex-option" aria-label="' + esc(T.exOption + ': ' + exName(e)) + '">' + e.options.map(function (o) {
            return '<option' + (o.label === st.option ? ' selected' : '') + '>' + esc(o.label) + '</option>';
          }).join('') + '</select>';
        }
        if (max > 1) html += '<input class="ex-qty" type="number" min="1" max="' + max + '" value="' + st.qty + '" inputmode="numeric" aria-label="' + esc(T.exQty + ': ' + exName(e)) + '">';
        var pt = exPriceText(e, st);
        if (pt) html += '<span class="ex-price">' + esc(pt) + '</span>';
        html += '</div>';
      });
      html += '</fieldset>';
    });
    var note = form.elements.extras_note ? form.elements.extras_note.value : '';
    html += '<div class="field"><label for="f-exnote">' + esc(T.exNote) + ' <span class="opt">' + esc(T.exOptional) + '</span></label>' +
      '<input id="f-exnote" name="extras_note" type="text" maxlength="500" aria-describedby="err-extras_note">' +
      '<p class="field-error" id="err-extras_note" hidden></p></div>';
    exBox.innerHTML = html;
    form.elements.extras_note.value = note;
  }
  function exSelection() {
    if (!chosenX || !EXTRAS) return [];
    return (EXTRAS.extras || []).filter(function (e) { return exFits(e, chosenX.u) && exState[e.id] && exState[e.id].on; })
      .map(function (e) {
        var st = exState[e.id], o = { id: e.id, qty: Math.max(1, Math.min(Number(e.max_qty) || 1, Math.floor(Number(st.qty) || 1))) };
        if (e.options && e.options.length) o.option = st.option;
        return o;
      });
  }
  function guestsNow() {
    var g = Math.floor(Number(fGuests.value));
    return g >= 1 ? g : (chosenX && chosenX.house ? HOUSE_GUESTS : DEFAULT_GUESTS);
  }
  function setSummary(q) {
    var x = chosenX, parts = [unitName(x.u), range(sel.a, sel.b), T.guestsN(guestsNow())];
    if (q && !q.incomplete) parts.push(money(q.total, q.currency));
    var line = parts.join(' · ');
    var ex = q && Number(q.extras_total) > 0 ? q.extras_total : 0;
    if (ex) line += ' (' + T.exIncl(money(ex, q.currency)) + ')';
    document.getElementById('chosen').textContent = line;
    var sum = document.getElementById('extras-sum');
    if (sum) {
      var lines = (q && q.extras || []).filter(function (e) { return Number(e.amount) > 0; })
        .map(function (e) { return e.name + (e.option ? ' (' + e.option + ')' : '') + ' ' + money(e.amount, q.currency); });
      sum.textContent = lines.join(', ');
      sum.hidden = !lines.length;
    }
  }
  function requote() {
    clearTimeout(exTimer);
    var seq = ++exSeq, sel0 = exSelection();
    if (!sel0.length) { setSummary(chosenX.quote); return; }   // the price does not depend on guests without extras
    exTimer = setTimeout(function () {
      call('quote', { unit_id: chosenX.u.id, check_in: sel.a, check_out: sel.b, guests: guestsNow(), extras: sel0, lang: LANG }).then(function (r) {
        if (seq === exSeq && r && r.ok && r.data) setSummary(r.data);
      }).catch(function () {});
    }, 300);
  }
  fGuests.addEventListener('change', function () { if (chosenX) requote(); });
  if (exBox) {
    exBox.addEventListener('change', function (e) {
      var item = e.target.closest('[data-ex]'); if (!item) return;
      var st = exState[item.getAttribute('data-ex')]; if (!st) return;
      if (e.target.type === 'checkbox') st.on = e.target.checked;
      else if (e.target.classList.contains('ex-option')) { st.option = e.target.value; st.on = true; item.querySelector('input[type=checkbox]').checked = true; }
      else if (e.target.classList.contains('ex-qty')) st.qty = e.target.value;
      var ex = (EXTRAS.extras || []).filter(function (x) { return x.id === item.getAttribute('data-ex'); })[0];
      var pr = item.querySelector('.ex-price'); if (pr && ex) pr.textContent = exPriceText(ex, st);
      requote();
    });
  }

  /* ----------------------------------------------------- step 2 → step 3 */
  cards.addEventListener('click', function (e) {
    var b = e.target.closest('[data-unit]'); if (!b) return;
    var x = (cards.__list || []).filter(function (y) { return y.u.id === b.getAttribute('data-unit'); })[0];
    if (!x) return;
    chosen = x.u.id;
    form.elements.unit_id.value = chosen;
    if (!chosenX || chosenX.u.id !== x.u.id) exState = {};
    chosenX = x;
    var cap = x.house ? MAX_GUESTS : (Number(x.u.capacity) || 2), def = x.house ? HOUSE_GUESTS : DEFAULT_GUESTS;
    fGuests.max = cap;
    if (!fGuests.value || Number(fGuests.value) > cap || chosen !== lastChosen) fGuests.value = Math.min(def, cap);
    lastChosen = chosen;
    clearFieldError('guests');
    renderExtras(x.u);
    setSummary(x.quote);
    requote();
    show(3);
  });

  /* ------------------------------------------------------------- step 3 */
  function validate(v) {
    var errs = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = T.err.email;
    if (v.guest_name.length < 2) errs.guest_name = T.err.guest_name;
    else if (v.guest_name.length > 120) errs.guest_name = T.err.guest_name_long;
    if (v.phone.length > 40) errs.phone = T.err.phone;
    if (v.message.length > 2000) errs.message = T.err.message;
    if (v.extras_note.length > 500) errs.extras_note = T.err.extras_note;
    var cap = Number(fGuests.max) || MAX_GUESTS;
    if (fGuests.value !== '' && !(Math.floor(v.guests) === v.guests && v.guests >= 1 && v.guests <= cap)) errs.guests = T.err.guests(cap);
    return errs;
  }
  // Server messages are English; show the page-language string for known cases.
  function serverError(res) {
    var f = res && res.data && res.data.field, m = (res && res.message) || '';
    if (res && res.data && res.data.unit_ids && res.data.unit_ids.length) { show(2, false); fieldError('unit_id', T.houseTaken); return; }
    if (res && res.error === 'forbidden') return general(T.closed);
    if (f) {
      var text = T.err[f];
      if (f === 'check_in' && /past/i.test(m)) text = T.err.check_in_past;
      if (f === 'check_out' && /longer/i.test(m)) text = T.err.check_out_long;
      if (f === 'guest_name' && /too long/i.test(m)) text = T.err.guest_name_long;
      if (f === 'guests') { var mg = /1 to (\d+)/.exec(m); text = T.err.guests(mg ? +mg[1] : MAX_GUESTS); }
      var mm = /Minimum stay[^0-9]*(\d+)/i.exec(m); if (f === 'check_out' && mm) text = T.minStay(+mm[1]);
      if (FIELD_STEP[f]) show(FIELD_STEP[f], false);
      fieldError(f, typeof text === 'string' ? text : m);
      if (!FIELD_STEP[f]) general(T.checkFields);
      focusField(f);
      return;
    }
    if (/very quick/i.test(m)) return general(T.quick);
    if (/already have this request/i.test(m)) return general(T.duplicate);
    if (/more requests/i.test(m)) return general(T.cap);
    if (/reload the page/i.test(m)) return general(T.reload);
    if (/by email instead/i.test(m)) return general(T.blocked);
    general(LANG === 'en' && m ? m : T.network);
  }

  var btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (current === 1) return search();
    if (current !== 3 || !chosen || !sel) return;
    clearAll();
    var v = {
      guest_name: form.elements.guest_name.value.replace(/\s+/g, ' ').trim(),
      email: form.elements.email.value.trim(), phone: form.elements.phone.value.trim(),
      message: form.elements.message.value.trim(),
      extras_note: form.elements.extras_note ? form.elements.extras_note.value.replace(/\s+/g, ' ').trim() : '',
      guests: Number(fGuests.value)
    };
    var errs = validate(v), keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach(function (k) { fieldError(k, errs[k]); });
      general(T.checkFields); focusField(keys[0]);
      return;
    }
    var payload = {
      unit_id: chosen, check_in: sel.a, check_out: sel.b, guests: guestsNow(),
      guest_name: v.guest_name, email: v.email, phone: v.phone, message: v.message,
      lang: LANG, hp: form.elements.hp.value, t: OPENED, extras: exSelection()
    };
    if (v.extras_note) payload.extras_note = v.extras_note;
    btn.disabled = true; btn.textContent = T.sending;
    var wait = Math.max(0, MIN_FILL_MS + 300 - (Date.now() - OPENED));   // stay clear of the backend's 4 s rule
    setTimeout(function () {
      call('requestStay', payload).then(function (res) {
        if (res && res.ok) return done(v.email);
        serverError(res);
      }).catch(function () { general(T.network); })
        .then(function () { btn.disabled = false; btn.textContent = T.send; });
    }, wait);
  });

  function done(email) {
    var ok = document.getElementById('request-ok');
    ok.querySelector('[data-email]').textContent = email;
    var ps = ok.querySelectorAll('p');
    if (chosen === 'ALL' && ps[1]) ps[1].textContent = T.okHouse;
    form.hidden = true;
    ok.hidden = false;
    ok.focus();
    ok.scrollIntoView({ block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#request-ok');
  }

  // Booking page: the list of extras with their prices (#extras-overview), from the same `extras` call.
  function renderOverview() {
    var box = document.getElementById('extras-overview');
    if (!box || !EXTRAS || !(EXTRAS.extras || []).length) return;
    var cur = EXTRAS.currency, html = '';
    [['paid', T.exPaid], ['request', T.exRequest], ['quote', T.exQuote]].forEach(function (g) {
      var items = EXTRAS.extras.filter(function (e) { return (e.category || 'paid') === g[0]; });
      if (!items.length) return;
      html += '<li class="ex-group-h">' + esc(g[1]) + '</li>';
      items.forEach(function (e) {
        var price = '';
        if (g[0] === 'quote') price = T.exOnRequest;
        else if (g[0] === 'paid') {
          var ps = (e.options || []).map(function (o) { return Number(o.price); }).filter(function (v) { return v > 0; });
          if (!ps.length) ps = [Number(e.price) || 0];
          var lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
          price = T.exPer(e.kind, lo === hi ? money(lo, cur) : money(lo, cur) + '–' + money(hi, cur));
        }
        var opts = (e.options || []).map(function (o) { return o.label; }).join(', ');
        html += '<li><span>' + esc(exName(e)) + (opts ? ' <span class="ex-opts">(' + esc(opts) + ')</span>' : '') + '</span>' +
          (price ? '<span class="ex-price">' + esc(price) + '</span>' : '') + '</li>';
      });
    });
    box.innerHTML = html;
    box.hidden = false;
  }

  /* ------------------------------------------------------------------ load */
  show(1, false);
  if (API) {
    call('extras', { lang: LANG }).then(function (r) { if (r && r.ok && r.data) { EXTRAS = r.data; renderOverview(); } }).catch(function () {});
    availP = call('availability', {}).then(function (res) {
      if (!res || !res.ok || !res.data || !res.data.units) throw new Error('availability');
      avail = res.data;
      if (cal) { cal.hidden = false; render(); announce(T.hint); }
    }).catch(function () { /* calendar stays hidden; cards use the fallback units without availability */ });
  }
})();
