// Akrotiraki — small enhancements: mobile nav, gallery lightbox, and the interface strings shared with booking.js.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // Interface strings by page language (<html lang="en|el">). English is the fallback.
  var LANG = (document.documentElement.getAttribute('data-lang') || document.documentElement.lang || 'en').slice(0, 2);
  var STR = {
    en: {
      photo: function (i, n) { return 'Photograph ' + i + ' of ' + n; },
      // booking.js (request to stay)
      name: 'Name', email: 'Email', arrival: 'Arrival', departure: 'Departure', house: 'Apartment', guests: 'Guests',
      any: 'Any apartment', maisonette: 'Maisonette', studio: 'Studio',
      prevMonth: 'Previous month', nextMonth: 'Next month',
      free: 'free', onRequest: 'on request', taken: 'taken', past: 'not available',
      selArrival: 'your arrival', selDeparture: 'your departure', selStay: 'in your stay',
      hint: 'Choose an arrival day, then a departure day.',
      pickedArrival: function (d) { return 'Arrival ' + d + '. Now choose a departure day.'; },
      pickedRange: function (n, a, d) { return n + (n === 1 ? ' night' : ' nights') + ', ' + a + ' to ' + d + '.'; },
      calError: 'The calendar could not be loaded. You can still send a request below.',
      err: {
        unit_id: 'Please choose an apartment.',
        check_in: 'Please choose an arrival date.',
        check_in_past: 'The arrival date is in the past.',
        check_out: 'Please choose a departure date after the arrival.',
        check_out_long: 'For stays longer than 60 nights, please write to us by email.',
        guests: function (n) { return 'Please enter between 1 and ' + n + ' guests for this apartment.'; },
        email: 'Please enter a valid email address.',
        guest_name: 'Please enter your name.',
        guest_name_long: 'Your name is too long.',
        phone: 'The phone number is too long (40 characters at most).',
        message: 'Your message is too long (2,000 characters at most).'
      },
      checkFields: 'Please check the fields marked below.',
      sending: 'Sending…', send: 'Send request',
      network: 'We could not send your request. Please try again in a moment, or write to us by email.',
      quick: 'That was very quick. Please check your details and send the request again.',
      duplicate: 'We already have this request and will reply soon. There is no need to send it again.',
      cap: 'We cannot take more requests right now. Please try again later or write to us by email.',
      reload: 'Your request could not be sent. Please reload the page and try again.',
      blocked: 'Your request could not be sent. Please write to us by email instead.',
      closed: 'Online requests are closed at the moment. Please write to us by email.'
    },
    el: {
      photo: function (i, n) { return 'Φωτογραφία ' + i + ' από ' + n; },
      name: 'Ονοματεπώνυμο', email: 'Email', arrival: 'Άφιξη', departure: 'Αναχώρηση', house: 'Διαμέρισμα', guests: 'Άτομα',
      any: 'Οποιοδήποτε', maisonette: 'Μεζονέτα', studio: 'Στούντιο',
      prevMonth: 'Προηγούμενος μήνας', nextMonth: 'Επόμενος μήνας',
      free: 'ελεύθερο', onRequest: 'κατόπιν αιτήματος', taken: 'κλεισμένο', past: 'μη διαθέσιμο',
      selArrival: 'η άφιξή σας', selDeparture: 'η αναχώρησή σας', selStay: 'μέσα στη διαμονή σας',
      hint: 'Διαλέξτε ημέρα άφιξης και μετά ημέρα αναχώρησης.',
      pickedArrival: function (d) { return 'Άφιξη ' + d + '. Διαλέξτε τώρα ημέρα αναχώρησης.'; },
      pickedRange: function (n, a, d) { return n + (n === 1 ? ' διανυκτέρευση' : ' διανυκτερεύσεις') + ', ' + a + ' έως ' + d + '.'; },
      calError: 'Δεν ήταν δυνατό να φορτωθεί το ημερολόγιο. Μπορείτε πάντως να στείλετε αίτημα παρακάτω.',
      err: {
        unit_id: 'Διαλέξτε διαμέρισμα.',
        check_in: 'Διαλέξτε ημερομηνία άφιξης.',
        check_in_past: 'Η ημερομηνία άφιξης έχει περάσει.',
        check_out: 'Διαλέξτε ημερομηνία αναχώρησης μετά την άφιξη.',
        check_out_long: 'Για διαμονή πάνω από 60 διανυκτερεύσεις, γράψτε μας με email.',
        guests: function (n) { return 'Γράψτε από 1 έως ' + n + ' άτομα για αυτό το διαμέρισμα.'; },
        email: 'Γράψτε μια έγκυρη διεύθυνση email.',
        guest_name: 'Γράψτε το όνομά σας.',
        guest_name_long: 'Το όνομα είναι πολύ μεγάλο.',
        phone: 'Το τηλέφωνο είναι πολύ μεγάλο (έως 40 χαρακτήρες).',
        message: 'Το μήνυμα είναι πολύ μεγάλο (έως 2.000 χαρακτήρες).'
      },
      checkFields: 'Ελέγξτε τα πεδία που σημειώνονται παρακάτω.',
      sending: 'Αποστολή…', send: 'Αποστολή αιτήματος',
      network: 'Δεν ήταν δυνατό να σταλεί το αίτημα. Δοκιμάστε ξανά σε λίγο ή γράψτε μας με email.',
      quick: 'Ήταν πολύ γρήγορο. Ελέγξτε τα στοιχεία σας και στείλτε ξανά το αίτημα.',
      duplicate: 'Έχουμε ήδη αυτό το αίτημα και θα σας απαντήσουμε σύντομα. Δεν χρειάζεται να το ξαναστείλετε.',
      cap: 'Δεν μπορούμε να δεχτούμε άλλα αιτήματα αυτή τη στιγμή. Δοκιμάστε αργότερα ή γράψτε μας με email.',
      reload: 'Το αίτημα δεν στάλθηκε. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.',
      blocked: 'Το αίτημα δεν στάλθηκε. Γράψτε μας καλύτερα με email.',
      closed: 'Τα αιτήματα μέσω της σελίδας είναι προσωρινά κλειστά. Γράψτε μας με email.'
    }
  };
  var T = STR[LANG] || STR.en;
  window.AKRO_LANG = LANG; window.AKRO_T = T; // used by booking.js

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

})();
