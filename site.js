// Akrotiraki — small enhancements: mobile nav, gallery lightbox, mailto request form.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // Interface strings by page language (<html lang="en|el">). English is the fallback.
  var LANG = (document.documentElement.getAttribute('data-lang') || document.documentElement.lang || 'en').slice(0, 2);
  var STR = {
    en: {
      photo: function (i, n) { return 'Photograph ' + i + ' of ' + n; },
      check: 'Please check: ', order: 'Departure must be after arrival',
      subject: function (a, d) { return 'Request to stay: ' + a + ' to ' + d; },
      name: 'Name', email: 'Email', arrival: 'Arrival', departure: 'Departure', house: 'Apartment', guests: 'Guests'
    },
    el: {
      photo: function (i, n) { return 'Φωτογραφία ' + i + ' από ' + n; },
      check: 'Ελέγξτε: ', order: 'Η αναχώρηση πρέπει να είναι μετά την άφιξη',
      subject: function (a, d) { return 'Αίτημα διαμονής: ' + a + ' έως ' + d; },
      name: 'Ονοματεπώνυμο', email: 'Email', arrival: 'Άφιξη', departure: 'Αναχώρηση', house: 'Διαμέρισμα', guests: 'Άτομα'
    }
  };
  var T = STR[LANG] || STR.en;

  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  // Mobile nav
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.hidden = false;
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
    };
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
    });
  }

  // Lightbox (native <dialog>; Esc closes natively)
  var dlg = document.getElementById('lightbox');
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  if (dlg && typeof dlg.showModal === 'function' && links.length) {
    var img = document.getElementById('lightbox-img');
    var idx = 0, opener = null;
    var show = function (i) {
      idx = (i + links.length) % links.length;
      var thumb = links[idx].querySelector('img');
      img.src = links[idx].getAttribute('href');
      img.alt = links[idx].getAttribute('data-alt') || (thumb ? thumb.alt : '');
      dlg.setAttribute('aria-label', T.photo(idx + 1, links.length));
    };
    if (links.length < 2) {
      Array.prototype.forEach.call(dlg.querySelectorAll('[data-lb=prev],[data-lb=next]'), function (b) { b.hidden = true; });
    }
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        opener = a;
        show(i);
        dlg.showModal();
      });
    });
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-lb]');
      if (b) {
        var act = b.getAttribute('data-lb');
        if (act === 'close') dlg.close();
        else show(idx + (act === 'next' ? 1 : -1));
      } else if (e.target === dlg || e.target.tagName === 'FIGURE') {
        dlg.close();
      }
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'ArrowLeft') show(idx - 1);
    });
    dlg.addEventListener('close', function () { if (opener) opener.focus(); });
  }

  // Request form → mailto:
  // TODO: later POST this to the ops API (akrotiraki-ops) as a pending request instead of mailto.
  var TO = 'stay@akrotiraki.gr'; // TODO: confirm address
  var form = document.getElementById('stay-form');
  if (form) {
    var err = document.getElementById('form-error');
    var from = form.elements.arrival, to = form.elements.departure;
    var today = new Date().toISOString().slice(0, 10);
    from.min = today; to.min = today;
    from.addEventListener('change', function () { if (from.value) to.min = from.value; });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var problems = [];
      ['name', 'email', 'arrival', 'departure'].forEach(function (n) {
        var el = form.elements[n];
        var bad = !el.value.trim() || !el.checkValidity();
        el.setAttribute('aria-invalid', String(bad));
        if (bad) problems.push(form.querySelector('label[for="' + el.id + '"]').textContent.trim());
      });
      if (!problems.length && to.value <= from.value) {
        to.setAttribute('aria-invalid', 'true');
        problems.push(T.order);
      }
      if (problems.length) {
        err.textContent = T.check + problems.join(', ') + '.';
        err.hidden = false;
        return;
      }
      err.hidden = true;
      var f = form.elements;
      var subject = T.subject(f.arrival.value, f.departure.value);
      var body = [
        T.name + ': ' + f.name.value.trim(),
        T.email + ': ' + f.email.value.trim(),
        T.arrival + ': ' + f.arrival.value,
        T.departure + ': ' + f.departure.value,
        T.house + ': ' + f.house.options[f.house.selectedIndex].text,
        T.guests + ': ' + f.guests.value,
        '',
        f.message.value.trim()
      ].join('\n');
      window.location.href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    });
  }
})();
