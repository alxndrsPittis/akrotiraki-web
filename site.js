// Akrotiraki — small enhancements: mobile nav, gallery lightbox, and the interface strings shared with booking.js.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // Theme previews (English home page only, where themes.css is loaded): ?theme=dusk|aegean|terracotta|olive|schist|teal|noir
  if (document.querySelector('link[href^="themes.css"]')) {
    var theme = (location.search.match(/[?&]theme=(dusk|aegean|terracotta|olive|schist|teal|noir)\b/) || [])[1];
    if (theme) document.documentElement.setAttribute('data-theme', theme);
  }

  // Interface strings by page language (<html lang="en|el">). English is the fallback.
  var LANG = (document.documentElement.getAttribute('data-lang') || document.documentElement.lang || 'en').slice(0, 2);
  var STR = {
    en: {
      photo: function (i, n) { return 'Photograph ' + i + ' of ' + n; },
      exPaid: 'Extras', exRequest: 'Requests', exQuote: 'On request', exOnRequest: 'price on request',
      exNote: 'Anything else?', exOptional: '(optional)', exQty: 'Quantity', exOption: 'Choice',
      exIncl: function (m) { return 'incl. extras ' + m; },
      exPer: function (k, m) { return m + ' ' + ({ per_stay: 'per stay', per_night: 'per night', per_person_night: 'per person per night' }[k] || ''); },
      // three-step request: apartment cards (booking.js)
      guestsN: function (n) { return n + (n === 1 ? ' guest' : ' guests'); },
      sqm: function (n) { return n + ' m²'; },
      cardSleeps: function (a, b) { return 'sleeps ' + (a === b ? b : a + '–' + b); },
      cardUpTo: function (n) { return 'Sleeps up to ' + n + '.'; },
      descMaisonette: 'Upstairs, a bedroom with a double bed and a balcony; below, a living room with a sofa bed, the kitchen and the bathroom.',
      descStudio: 'One open-plan room for sleeping and living, with a kitchen and a bathroom.',
      cardTaken: 'Not available for these dates.',
      cardFree: function (r) { return 'Free ' + r + '.'; },
      cardPending: 'Another request is pending for these dates; we will confirm quickly.',
      cardOnRequest: 'Price on request',
      cardTotal: function (t, n) { return t + ' for ' + n; },
      cardNights: function (s, n) { return s + (n === 1 ? ' night' : ' nights'); },
      cardRequest: 'Request this apartment',
      cardLoading: 'Looking up prices for your dates…',
      cardNone: 'No apartment is free for these dates. Try other dates, or call us.',
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
        check_out_long: 'For stays longer than 60 nights, please call us.',
        guests: function (n) { return 'Please enter between 1 and ' + n + ' guests for this apartment.'; },
        email: 'Please enter a valid email address.',
        guest_name: 'Please enter your name.',
        guest_name_long: 'Your name is too long.',
        phone: 'The phone number is too long (40 characters at most).',
        message: 'Your message is too long (2,000 characters at most).',
        extras_note: 'The note is too long (500 characters at most).'
      },
      checkFields: 'Please check the fields marked below.',
      sending: 'Sending…', send: 'Send request',
      network: 'We could not send your request. Please try again in a moment, or call us.',
      quick: 'That was very quick. Please check your details and send the request again.',
      duplicate: 'We already have this request and will reply soon. There is no need to send it again.',
      cap: 'We cannot take more requests right now. Please try again later or call us.',
      reload: 'Your request could not be sent. Please reload the page and try again.',
      blocked: 'Your request could not be sent. Please call us instead.',
      closed: 'Online requests are closed at the moment. Please call us.',
      // indicative price (quote)
      nightsN: function (n) { return n + (n === 1 ? ' night' : ' nights'); },
      quote: function (total, n) { return 'Indicative price: ' + total + ' for ' + n + ', including the cleaning fee. We confirm it in our reply.'; },
      quoteNoFee: function (total, n) { return 'Indicative price: ' + total + ' for ' + n + '. We confirm it in our reply.'; },
      quoteIncomplete: 'We will send you the price by email.',
      quoteDiscount: function (p, n, a) { return 'Includes ' + (p ? p + '% ' : '') + 'discount' + (n ? ' “' + n + '”' : '') + ' (−' + a + ').'; },
      quoteDiscountPart: function (n, a) { return (n || 'discount') + ' −' + a; },
      quoteHow: 'How it is calculated',
      quoteRate: function (n, price) { return n + ' × ' + price; },
      quoteCleaning: function (fee) { return 'cleaning ' + fee; },
      minStay: function (n) { return 'Minimum stay for these dates: ' + n + ' nights.'; }
    },
    el: {
      photo: function (i, n) { return 'Φωτογραφία ' + i + ' από ' + n; },
      exPaid: 'Επιπλέον', exRequest: 'Αιτήματα', exQuote: 'Κατόπιν συνεννόησης', exOnRequest: 'τιμή κατόπιν συνεννόησης',
      exNote: 'Κάτι άλλο;', exOptional: '(προαιρετικό)', exQty: 'Ποσότητα', exOption: 'Επιλογή',
      exIncl: function (m) { return 'μαζί με τα επιπλέον ' + m; },
      exPer: function (k, m) { return m + ' ' + ({ per_stay: 'ανά διαμονή', per_night: 'ανά νύχτα', per_person_night: 'ανά άτομο ανά νύχτα' }[k] || ''); },
      guestsN: function (n) { return n + (n === 1 ? ' άτομο' : ' άτομα'); },
      sqm: function (n) { return n + ' τ.μ.'; },
      cardSleeps: function (a, b) { return (a === b ? b : a + '–' + b) + ' άτομα'; },
      cardUpTo: function (n) { return 'Έως ' + n + ' άτομα.'; },
      descMaisonette: 'Επάνω υπνοδωμάτιο με διπλό κρεβάτι και μπαλκόνι· κάτω καθιστικό με καναπέ-κρεβάτι, κουζίνα και μπάνιο.',
      descStudio: 'Ενιαίος χώρος ύπνου και καθιστικού, με κουζίνα και μπάνιο.',
      cardTaken: 'Δεν είναι διαθέσιμο αυτές τις ημερομηνίες.',
      cardFree: function (r) { return 'Ελεύθερο ' + r + '.'; },
      cardPending: 'Υπάρχει ήδη άλλο αίτημα για αυτές τις ημερομηνίες· θα σας απαντήσουμε γρήγορα.',
      cardOnRequest: 'Τιμή κατόπιν αιτήματος',
      cardTotal: function (t, n) { return t + ' για ' + n; },
      cardNights: function (s, n) { return s + (n === 1 ? ' νύχτα' : ' νύχτες'); },
      cardRequest: 'Αίτημα για αυτό το διαμέρισμα',
      cardLoading: 'Αναζητούμε τις τιμές για τις ημερομηνίες σας…',
      cardNone: 'Κανένα διαμέρισμα δεν είναι ελεύθερο αυτές τις ημερομηνίες. Δοκιμάστε άλλες ή τηλεφωνήστε μας.',
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
        check_out_long: 'Για διαμονή πάνω από 60 διανυκτερεύσεις, τηλεφωνήστε μας.',
        guests: function (n) { return 'Γράψτε από 1 έως ' + n + ' άτομα για αυτό το διαμέρισμα.'; },
        email: 'Γράψτε μια έγκυρη διεύθυνση email.',
        guest_name: 'Γράψτε το όνομά σας.',
        guest_name_long: 'Το όνομα είναι πολύ μεγάλο.',
        phone: 'Το τηλέφωνο είναι πολύ μεγάλο (έως 40 χαρακτήρες).',
        message: 'Το μήνυμα είναι πολύ μεγάλο (έως 2.000 χαρακτήρες).',
        extras_note: 'Η σημείωση είναι πολύ μεγάλη (έως 500 χαρακτήρες).'
      },
      checkFields: 'Ελέγξτε τα πεδία που σημειώνονται παρακάτω.',
      sending: 'Αποστολή…', send: 'Αποστολή αιτήματος',
      network: 'Δεν ήταν δυνατό να σταλεί το αίτημα. Δοκιμάστε ξανά σε λίγο ή τηλεφωνήστε μας.',
      quick: 'Ήταν πολύ γρήγορο. Ελέγξτε τα στοιχεία σας και στείλτε ξανά το αίτημα.',
      duplicate: 'Έχουμε ήδη αυτό το αίτημα και θα σας απαντήσουμε σύντομα. Δεν χρειάζεται να το ξαναστείλετε.',
      cap: 'Δεν μπορούμε να δεχτούμε άλλα αιτήματα αυτή τη στιγμή. Δοκιμάστε αργότερα ή τηλεφωνήστε μας.',
      reload: 'Το αίτημα δεν στάλθηκε. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.',
      blocked: 'Το αίτημα δεν στάλθηκε. Παρακαλούμε τηλεφωνήστε μας.',
      closed: 'Τα αιτήματα μέσω της σελίδας είναι προσωρινά κλειστά. Τηλεφωνήστε μας.',
      nightsN: function (n) { return n + (n === 1 ? ' νύχτα' : ' νύχτες'); },
      quote: function (total, n) { return 'Ενδεικτική τιμή: ' + total + ' για ' + n + ', με το κόστος καθαριότητας. Θα την επιβεβαιώσουμε στην απάντησή μας.'; },
      quoteNoFee: function (total, n) { return 'Ενδεικτική τιμή: ' + total + ' για ' + n + '. Θα την επιβεβαιώσουμε στην απάντησή μας.'; },
      quoteIncomplete: 'Θα σας στείλουμε την τιμή με email.',
      quoteDiscount: function (p, n, a) { return 'Περιλαμβάνει έκπτωση ' + (p ? p + '% ' : '') + (n ? '«' + n + '» ' : '') + '(−' + a + ').'; },
      quoteDiscountPart: function (n, a) { return (n || 'έκπτωση') + ' −' + a; },
      quoteHow: 'Πώς υπολογίζεται',
      quoteRate: function (n, price) { return n + ' × ' + price; },
      quoteCleaning: function (fee) { return 'καθαριότητα ' + fee; },
      minStay: function (n) { return 'Ελάχιστη διαμονή για αυτές τις ημερομηνίες: ' + n + ' νύχτες.'; }
    }
  };
  // Extra languages live in <lang>/strings.js (loaded before this file) as window.AKRO_STRINGS[lang].
  var BASE = STR[LANG] || {};
  var EXTRA = (window.AKRO_STRINGS || {})[LANG] || {};
  var T = Object.assign({}, STR.en, BASE, EXTRA);
  T.err = Object.assign({}, STR.en.err, BASE.err || {}, EXTRA.err || {});
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

  // Language menu (<details>): close on outside click and on Escape
  var langMenu = document.querySelector('.lang-menu');
  if (langMenu) {
    document.addEventListener('click', function (e) { if (langMenu.open && !langMenu.contains(e.target)) langMenu.open = false; });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && langMenu.open) { langMenu.open = false; langMenu.querySelector('summary').focus(); }
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
