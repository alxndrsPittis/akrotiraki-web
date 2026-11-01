// Akrotiraki — request to stay: availability calendar + request form (public actions of the ops API).
// The backend URL lives in one place: the data-api attribute of #booking (index.html and el/index.html).
// Contract: akrotiraki-ops/docs/API.md, "Public actions (no token)".
(function () {
  'use strict';
  var root = document.getElementById('booking');
  var form = document.getElementById('stay-form');
  if (!root || !form) return;

  var API = root.getAttribute('data-api');
  var T = window.AKRO_T || {};
  var LANG = (document.documentElement.lang || 'en').slice(0, 2);
  var LOCALE = { en: 'en-GB', el: 'el-GR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' }[LANG] || 'en-GB';
  var OPENED = Date.now();                     // `t`: when the form was opened
  var MIN_FILL_MS = 4000;                       // backend rejects faster submissions

  // Fallback units if `availability` is unreachable (ids as seeded by the backend's setup).
  var FALLBACK = (root.getAttribute('data-fallback-units') || '').split(',').filter(Boolean).map(function (s) {
    var p = s.split(':'); return { id: p[0], type: p[1], capacity: Number(p[2]) || 2 };
  });

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

  /* ------------------------------------------------------------------ api */
  function call(action, payload) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
      body: JSON.stringify({ action: action, payload: payload || {} })
    }).then(function (r) { return r.json(); });
  }

  /* ----------------------------------------------------------------- rates */
  // Seasonal rates table (#rates) from the public `rates` action. While loading the box shows a
  // skeleton; on any failure the box is removed and only the footnote under it stays.
  (function loadRates() {
    var box = document.getElementById('rates-box');
    if (!box || !API) return;
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var fmtDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
    var day = function (s) { return fmtDay.format(parse(s)); };
    var range = function (a, b) { return a === b ? day(a) : day(a) + ' – ' + day(b); };
    function fail() { box.remove(); }
    function discountLine(d, cur) {
      var p = Number(d.percent);
      if (!p) return d.name ? esc(d.name) : '';
      var line;
      if (Number(d.min_nights) > 0) line = T.rDiscStay(p, Number(d.min_nights));
      else if (Number(d.days_before) > 0) line = T.rDiscEarly(p, Number(d.days_before));
      else if (d.from && d.to) line = T.rDiscDates(p, day(d.from), day(d.to));
      else return d.name ? esc(d.name) : '';
      if (d.unit_type && T.rForType && T.rForType[d.unit_type]) line += T.rForType[d.unit_type];
      return esc(line) + '.';
    }
    call('rates', {}).then(function (res) {
      if (!res || !res.ok || !res.data || !(res.data.seasons || []).length) return fail();
      var r = res.data, cur = r.currency || 'EUR';
      // one row per date range; columns maisonette / studio
      var rows = {}, keys = [];
      r.seasons.forEach(function (s) {
        var k = s.from + '|' + s.to;
        if (!rows[k]) { rows[k] = { from: s.from, to: s.to }; keys.push(k); }
        rows[k][s.unit_type] = s;
      });
      keys.sort();
      var cell = function (s) {
        if (!s) return '<td>–</td>';
        var min = Number(s.min_nights) > 1 ? '<span class="rates-min">' + esc(T.rMin(Number(s.min_nights))) + '</span>' : '';
        return '<td>' + esc(T.rPerNight(money(Number(s.price_per_night), cur))) + min + '</td>';
      };
      var html = '<table class="rates-table"><caption>' + esc(T.rCaption(r.year)) + '</caption>' +
        '<thead><tr><th scope="col">' + esc(T.rDates) + '</th><th scope="col">' + esc(T.maisonette) + '</th><th scope="col">' + esc(T.studio) + '</th></tr></thead><tbody>';
      keys.forEach(function (k) {
        var row = rows[k];
        html += '<tr><th scope="row">' + esc(range(row.from, row.to)) + '</th>' + cell(row.maisonette) + cell(row.studio) + '</tr>';
      });
      html += '</tbody></table>';
      var notes = [];
      var cf = r.cleaning_fee || {};
      if (Number(cf.maisonette) > 0 || Number(cf.studio) > 0) {
        notes.push(esc(T.rCleaning(money(Number(cf.maisonette) || 0, cur), money(Number(cf.studio) || 0, cur))));
      }
      (r.discounts || []).forEach(function (d) { var l = discountLine(d, cur); if (l) notes.push(l); });
      if (notes.length) html += '<ul class="rates-notes">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>';
      box.innerHTML = html;
      box.removeAttribute('aria-busy');
    }).catch(fail);
  })();

  /* ---------------------------------------------------- availability data */
  var avail = null;           // {units, taken, pending}, cached for the page
  function units(type) {
    var list = (avail && avail.units && avail.units.length) ? avail.units : FALLBACK;
    return list.filter(function (u) { return !type || type === 'any' || u.type === type; });
  }
  function overlaps(list, unitId, a, b) {   // any stay of unitId overlapping [a, b)
    return (list || []).some(function (s) { return s.unit_id === unitId && s.check_in < b && a < s.check_out; });
  }
  // State of the night starting on `day` for a filter: free if any unit is free, else on request, else taken.
  function nightState(day, type) {
    if (day < TODAY) return 'past';
    if (!avail) return 'free';
    var next = addDays(day, 1), anyPending = false, list = units(type);
    if (!list.length) return 'taken';
    for (var i = 0; i < list.length; i++) {
      var id = list[i].id;
      if (overlaps(avail.taken, id, day, next)) continue;
      if (overlaps(avail.pending, id, day, next)) { anyPending = true; continue; }
      return 'free';
    }
    return anyPending ? 'pending' : 'taken';
  }

  /* -------------------------------------------------------------- calendar */
  var cal = document.getElementById('cal');
  var monthsEl = document.getElementById('cal-months');
  var statusEl = document.getElementById('cal-status');
  var seg = cal ? cal.querySelectorAll('[data-type]') : [];
  var fIn = form.elements.check_in, fOut = form.elements.check_out;
  var filter = 'any', first = new Date(), focusDay = null;
  first.setDate(1);
  var LAST = new Date(); LAST.setDate(1); LAST.setMonth(LAST.getMonth() + 11);   // 12 months shown
  var wide = window.matchMedia('(min-width: 720px)');

  function sel() { return { a: fIn.value, b: fOut.value }; }

  function render() {
    if (!cal || cal.hidden) return;
    var count = wide.matches ? 2 : 1, html = '', s = sel();
    for (var m = 0; m < count; m++) {
      var mDate = new Date(first.getFullYear(), first.getMonth() + m, 1);
      if (mDate > LAST) break;
      html += '<div class="cal-month"><h4 class="cal-month-title">' + fmtMonth.format(mDate) + '</h4>' +
        '<div class="cal-grid" role="group" aria-label="' + fmtMonth.format(mDate) + '">';
      for (var w = 0; w < 7; w++) {   // Monday first
        html += '<span class="cal-wd" aria-hidden="true">' + fmtWd.format(new Date(2024, 0, 1 + w)) + '</span>';
      }
      var lead = (mDate.getDay() + 6) % 7;
      for (var i = 0; i < lead; i++) html += '<span class="cal-pad" aria-hidden="true"></span>';
      var dim = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate();
      for (var d = 1; d <= dim; d++) {
        var day = iso(new Date(mDate.getFullYear(), mDate.getMonth(), d));
        var st = nightState(day, filter);
        var cls = 'cal-day is-' + st, extra = '';
        if (s.a && day === s.a) { cls += ' is-start'; extra = ', ' + T.selArrival; }
        else if (s.b && day === s.b) { cls += ' is-end'; extra = ', ' + T.selDeparture; }
        else if (s.a && s.b && day > s.a && day < s.b) { cls += ' is-in'; extra = ', ' + T.selStay; }
        var label = fmtLong.format(parse(day)) + ', ' + ({ free: T.free, pending: T.onRequest, taken: T.taken, past: T.past }[st]) + extra;
        var inert = st === 'past' || (st === 'taken' && !canEnd(day));
        html += '<button type="button" class="' + cls + '" data-day="' + day + '" tabindex="-1" aria-label="' + label + '"' +
          (inert ? ' aria-disabled="true"' : '') + (s.a === day || s.b === day ? ' aria-pressed="true"' : '') + '>' + d + '</button>';
      }
      html += '</div></div>';
    }
    monthsEl.innerHTML = html;
    var prev = cal.querySelector('.cal-prev'), next = cal.querySelector('.cal-next');
    var now = new Date(); now.setDate(1);
    prev.disabled = first <= now;
    next.disabled = new Date(first.getFullYear(), first.getMonth() + count, 1) > LAST;
    // roving tabindex: one day in the tab order
    var target = (focusDay && monthsEl.querySelector('[data-day="' + focusDay + '"]')) ||
      monthsEl.querySelector('[data-day="' + s.a + '"]') ||
      monthsEl.querySelector('.cal-day:not([aria-disabled])') || monthsEl.querySelector('.cal-day');
    if (target) target.tabIndex = 0;
  }

  // A taken day can still be a departure day if every night before it, from the arrival, is not taken.
  function canEnd(day) {
    var a = fIn.value;
    if (!a || fOut.value || day <= a) return false;
    for (var d = a; d < day; d = addDays(d, 1)) if (nightState(d, filter) === 'taken') return false;
    return true;
  }

  function announce(text) { if (statusEl) statusEl.textContent = text; }

  function pick(day) {
    var a = fIn.value, b = fOut.value, st = nightState(day, filter);
    if (a && !b && day > a && canEnd(day)) {
      fOut.value = day;
      announce(T.pickedRange(nights(a, day), fmtShort.format(parse(a)), fmtShort.format(parse(day))));
    } else if (st === 'free' || st === 'pending') {
      fIn.value = day; fOut.value = '';
      announce(T.pickedArrival(fmtShort.format(parse(day))));
    } else {
      return;   // taken or past: nothing happens
    }
    clearFieldError('check_in'); clearFieldError('check_out');
    syncMin();
    focusDay = day;
    render();
    if (typeof scheduleQuote === 'function') scheduleQuote();
    var btn = monthsEl.querySelector('[data-day="' + day + '"]'); if (btn) btn.focus();
  }

  if (cal) {
    monthsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.cal-day'); if (b) pick(b.getAttribute('data-day'));
    });
    monthsEl.addEventListener('keydown', function (e) {
      var b = e.target.closest('.cal-day'); if (!b) return;
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      var day = addDays(b.getAttribute('data-day'), step);
      if (day < TODAY) return;
      var target = monthsEl.querySelector('[data-day="' + day + '"]');
      focusDay = day;
      if (!target) {   // move the visible months
        var d = parse(day); first = new Date(d.getFullYear(), d.getMonth() - (step > 0 && wide.matches ? 1 : 0), 1);
        var now = new Date(); now.setDate(1); if (first < now) first = now;
        render(); target = monthsEl.querySelector('[data-day="' + day + '"]');
      }
      if (target) { monthsEl.querySelectorAll('.cal-day').forEach(function (x) { x.tabIndex = -1; }); target.tabIndex = 0; target.focus(); }
    });
    cal.querySelector('.cal-prev').addEventListener('click', function () { first.setMonth(first.getMonth() - 1); focusDay = null; render(); });
    cal.querySelector('.cal-next').addEventListener('click', function () { first.setMonth(first.getMonth() + 1); focusDay = null; render(); });
    Array.prototype.forEach.call(seg, function (b) {
      b.addEventListener('click', function () { setFilter(b.getAttribute('data-type'), true); });
    });
    wide.addEventListener('change', render);
  }

  function setFilter(type, fromCalendar) {
    filter = type;
    Array.prototype.forEach.call(seg, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-type') === type)); });
    if (fromCalendar && type !== 'any') {
      var r = form.querySelector('input[name="type"][value="' + type + '"]'); if (r) { r.checked = true; onType(); }
    }
    render();
  }

  /* ------------------------------------------------------------------ form */
  function capacity(type) {
    var list = units(type);
    return list.length ? Math.max.apply(null, list.map(function (u) { return Number(u.capacity) || 1; })) : (type === 'studio' ? 2 : 4);
  }
  function chosenType() { var r = form.querySelector('input[name="type"]:checked'); return r ? r.value : ''; }
  function onType() {
    var t = chosenType(), g = form.elements.guests;
    g.max = capacity(t);
    if (Number(g.value) > Number(g.max)) g.value = g.max;
    clearFieldError('unit_id'); clearFieldError('guests');
  }
  Array.prototype.forEach.call(form.querySelectorAll('input[name="type"]'), function (r) {
    r.addEventListener('change', function () { onType(); if (cal && !cal.hidden) setFilter(chosenType(), false); });
  });

  function syncMin() {
    fIn.min = TODAY;
    fOut.min = fIn.value ? addDays(fIn.value, 1) : addDays(TODAY, 1);
  }
  fIn.addEventListener('change', function () {
    if (fOut.value && fOut.value <= fIn.value) fOut.value = '';
    syncMin(); focusDay = fIn.value || null;
    if (fIn.value) { var d = parse(fIn.value); first = new Date(d.getFullYear(), d.getMonth(), 1); }
    render();
  });
  fOut.addEventListener('change', render);
  syncMin();

  var errBox = document.getElementById('form-error');
  var FIELD_INPUT = { unit_id: 'type', check_in: 'check_in', check_out: 'check_out', guests: 'guests',
    email: 'email', guest_name: 'guest_name', phone: 'phone', message: 'message' };
  function fieldError(field, text) {
    var p = document.getElementById('err-' + field); if (p) { p.textContent = text; p.hidden = false; }
    var name = FIELD_INPUT[field];
    Array.prototype.forEach.call(form.querySelectorAll('[name="' + name + '"]'), function (el) { el.setAttribute('aria-invalid', 'true'); });
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

  function validate(v) {
    var errs = {};
    if (!v.type) errs.unit_id = T.err.unit_id;
    if (!v.check_in) errs.check_in = T.err.check_in;
    else if (v.check_in < TODAY) errs.check_in = T.err.check_in_past;
    if (!v.check_out || (v.check_in && v.check_out <= v.check_in)) errs.check_out = T.err.check_out;
    else if (v.check_in && nights(v.check_in, v.check_out) > 60) errs.check_out = T.err.check_out_long;
    var cap = capacity(v.type);
    if (!(Math.floor(v.guests) === v.guests && v.guests >= 1 && v.guests <= cap)) errs.guests = T.err.guests(cap);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = T.err.email;
    if (v.guest_name.length < 2) errs.guest_name = T.err.guest_name;
    else if (v.guest_name.length > 120) errs.guest_name = T.err.guest_name_long;
    if (v.phone.length > 40) errs.phone = T.err.phone;
    if (v.message.length > 2000) errs.message = T.err.message;
    return errs;
  }

  // The backend wants a unit id: the first unit of the type with no stay on those dates,
  // then one with only pending stays, else the first of that type.
  function chooseUnit(type, a, b) {
    var list = units(type);
    if (!list.length) return '';
    if (avail) {
      for (var i = 0; i < list.length; i++) if (!overlaps(avail.taken, list[i].id, a, b) && !overlaps(avail.pending, list[i].id, a, b)) return list[i].id;
      for (var j = 0; j < list.length; j++) if (!overlaps(avail.taken, list[j].id, a, b)) return list[j].id;
    }
    return list[0].id;
  }

  // Server messages are English; show the page-language string for known cases.
  function serverError(res) {
    var f = res && res.data && res.data.field, m = (res && res.message) || '';
    if (res && res.error === 'forbidden') return general(T.closed);
    if (f) {
      var text = T.err[f];
      if (f === 'check_in' && /past/i.test(m)) text = T.err.check_in_past;
      if (f === 'check_out' && /longer/i.test(m)) text = T.err.check_out_long;
      if (f === 'guest_name' && /too long/i.test(m)) text = T.err.guest_name_long;
      if (f === 'guests') text = T.err.guests(capacity(chosenType()));
      var mm = /Minimum stay[^0-9]*(\d+)/i.exec(m); if (f === 'check_out' && mm) text = T.minStay(+mm[1]);
      fieldError(f, typeof text === 'string' ? text : m);
      general(T.checkFields);
      var el = form.querySelector('[name="' + FIELD_INPUT[f] + '"]'); if (el) el.focus();
      return;
    }
    if (/very quick/i.test(m)) return general(T.quick);
    if (/already have this request/i.test(m)) return general(T.duplicate);
    if (/more requests/i.test(m)) return general(T.cap);
    if (/reload the page/i.test(m)) return general(T.reload);
    if (/by email instead/i.test(m)) return general(T.blocked);
    general(LANG === 'en' && m ? m : T.network);
  }

  /* ----------------------------------------------------------------- quote */
  // Indicative price from the public `quote` action; any failure just hides the line.
  var quoteEl = document.getElementById('quote'), quoteTimer = null, quoteSeq = 0, minStayShown = false;
  function money(v, cur) {
    try {
      // Full locales so grouping follows each country ("1.240 €" in es/de/el, "1 240 €" in fr, "€1,240" in en).
      // useGrouping 'always' (true in older engines) so Spanish also groups four-digit amounts.
      return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur || 'EUR', useGrouping: 'always',
        minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
    } catch (e) { return v + ' ' + (cur || 'EUR'); }
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hideQuote() { if (quoteEl) { quoteEl.hidden = true; quoteEl.innerHTML = ''; } }
  function clearMinStay() { if (minStayShown) { clearFieldError('check_out'); minStayShown = false; } }
  function scheduleQuote() {
    clearTimeout(quoteTimer);
    var type = chosenType(), a = fIn.value, b = fOut.value, seq = ++quoteSeq;
    if (!quoteEl || !API || !type || !a || !b || b <= a || a < TODAY || nights(a, b) > 60) { hideQuote(); clearMinStay(); return; }
    quoteTimer = setTimeout(function () {
      call('quote', { unit_id: chooseUnit(type, a, b), check_in: a, check_out: b }).then(function (res) {
        if (seq !== quoteSeq) return;                       // a newer selection is on its way
        if (!res || !res.ok || !res.data) { hideQuote(); return; }
        showQuote(res.data);
      }).catch(function () { if (seq === quoteSeq) hideQuote(); });
    }, 300);
  }
  function showQuote(q) {
    clearMinStay();
    if (q.below_min && q.min_nights) { fieldError('check_out', T.minStay(q.min_nights)); minStayShown = true; }
    var n = T.nightsN(q.nights);
    if (q.incomplete) { quoteEl.innerHTML = '<p>' + esc(T.quoteIncomplete) + '</p>'; quoteEl.hidden = false; return; }
    var fee = Number(q.cleaning_fee) || 0;
    var line = fee ? T.quote(money(q.total, q.currency), n) : T.quoteNoFee(money(q.total, q.currency), n);
    var groups = [], byPrice = {};
    (q.nightly || []).forEach(function (x) {
      var k = String(x.price);
      if (!byPrice[k]) { byPrice[k] = { price: x.price, count: 0 }; groups.push(byPrice[k]); }
      byPrice[k].count++;
    });
    var parts = groups.map(function (g) { return T.quoteRate(T.nightsN(g.count), money(g.price, q.currency)); });
    if (fee) parts.push(T.quoteCleaning(money(fee, q.currency)));
    quoteEl.innerHTML = '<p>' + esc(line) + '</p>' +
      (parts.length ? '<details><summary>' + esc(T.quoteHow) + '</summary><p>' + esc(parts.join(', ')) + '</p></details>' : '');
    quoteEl.hidden = false;
  }
  fIn.addEventListener('change', scheduleQuote);
  fOut.addEventListener('change', scheduleQuote);
  Array.prototype.forEach.call(form.querySelectorAll('input[name="type"]'), function (r) { r.addEventListener('change', scheduleQuote); });

  var btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearAll();
    var v = {
      type: chosenType(), check_in: fIn.value, check_out: fOut.value,
      guest_name: form.elements.guest_name.value.replace(/\s+/g, ' ').trim(),
      email: form.elements.email.value.trim(), phone: form.elements.phone.value.trim(),
      guests: Number(form.elements.guests.value), message: form.elements.message.value.trim()
    };
    var errs = validate(v), keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach(function (k) { fieldError(k, errs[k]); });
      general(T.checkFields);
      var el = form.querySelector('[name="' + FIELD_INPUT[keys[0]] + '"]'); if (el) el.focus();
      return;
    }
    var payload = {
      unit_id: chooseUnit(v.type, v.check_in, v.check_out), check_in: v.check_in, check_out: v.check_out,
      guest_name: v.guest_name, email: v.email, phone: v.phone, guests: v.guests, message: v.message,
      lang: LANG, hp: form.elements.hp.value, t: OPENED
    };
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
    form.hidden = true;
    if (cal) cal.hidden = true;
    ok.hidden = false;
    ok.focus();
    ok.scrollIntoView({ block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#request-ok');
  }

  /* ------------------------------------------------------------------ load */
  onType();
  if (cal && API) {
    call('availability', {}).then(function (res) {
      if (!res || !res.ok || !res.data || !res.data.units) throw new Error('availability');
      avail = res.data;
      cal.hidden = false;
      onType();
      setFilter(chosenType() || 'any', false);
      announce(T.hint);
      scheduleQuote();
    }).catch(function () {
      // Calendar stays hidden; the form still works with the fallback units.
    });
  }
})();
