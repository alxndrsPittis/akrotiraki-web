// Akrotiraki — French interface strings (merged by site.js over the English defaults).
//   = no-break space,   = narrow no-break space (French typography).
window.AKRO_STRINGS = window.AKRO_STRINGS || {};
window.AKRO_STRINGS.fr = {
  // tableau des tarifs (booking.js)
  rDates: 'Dates',
  rCaption: function (y) { return 'Prix par nuit pour ' + y; },
  rPerNight: function (m) { return m + ' / nuit'; },
  rMin: function (n) { return 'minimum ' + n + ' nuits'; },
  rCleaning: function (m, s) { return 'Frais de ménage par séjour\u202f: ' + m + ' pour le duplex, ' + s + ' pour le studio.'; },
  rDiscStay: function (p, n) { return p + '\u202f% de réduction pour les séjours de ' + n + ' nuits ou plus'; },
  rDiscEarly: function (p, d) { return p + '\u202f% de réduction pour les réservations faites ' + d + ' jours à l’avance'; },
  rDiscDates: function (p, a, b) { return p + '\u202f% de réduction pour les séjours du ' + a + ' au ' + b; },
  rForType: { maisonette: ' (duplex)', studio: ' (studios)' },
  photo: function (i, n) { return 'Photo ' + i + ' sur ' + n; },
  // booking.js (demande de séjour)
  name: 'Nom', email: 'E-mail', arrival: 'Arrivée', departure: 'Départ', house: 'Appartement', guests: 'Personnes',
  any: 'Indifférent', maisonette: 'Duplex', studio: 'Studio',
  prevMonth: 'Mois précédent', nextMonth: 'Mois suivant',
  free: 'libre', onRequest: 'sur demande', taken: 'occupé', past: 'indisponible',
  selArrival: 'votre arrivée', selDeparture: 'votre départ', selStay: 'pendant votre séjour',
  hint: 'Choisissez un jour d’arrivée, puis un jour de départ.',
  // Short French months end with a full stop ("5 juil."): avoid a doubled stop.
  pickedArrival: function (d) { return 'Arrivée le ' + d + (/\.$/.test(d) ? '' : '.') + ' Choisissez maintenant un jour de départ.'; },
  pickedRange: function (n, a, d) { return n + (n === 1 ? ' nuit' : ' nuits') + ', du ' + a + ' au ' + d + (/\.$/.test(d) ? '' : '.'); },
  calError: 'Le calendrier n’a pas pu être chargé. Vous pouvez tout de même envoyer une demande ci-dessous.',
  err: {
    unit_id: 'Veuillez choisir un appartement.',
    check_in: 'Veuillez choisir une date d’arrivée.',
    check_in_past: 'La date d’arrivée est déjà passée.',
    check_out: 'Veuillez choisir une date de départ postérieure à l’arrivée.',
    check_out_long: 'Pour un séjour de plus de 60 nuits, merci de nous appeler.',
    guests: function (n) { return 'Veuillez indiquer entre 1 et ' + n + ' personnes pour cet appartement.'; },
    email: 'Veuillez saisir une adresse e-mail valide.',
    guest_name: 'Veuillez indiquer votre nom.',
    guest_name_long: 'Votre nom est trop long.',
    phone: 'Le numéro de téléphone est trop long (40 caractères au maximum).',
    message: 'Votre message est trop long (2 000 caractères au maximum).'
  },
  checkFields: 'Veuillez vérifier les champs signalés ci-dessous.',
  sending: 'Envoi…', send: 'Envoyer la demande',
  network: 'Nous n’avons pas pu envoyer votre demande. Réessayez dans un instant, ou appelez-nous.',
  quick: 'C’était très rapide. Vérifiez vos informations et renvoyez la demande.',
  duplicate: 'Nous avons déjà reçu cette demande et vous répondrons bientôt. Inutile de la renvoyer.',
  cap: 'Nous ne pouvons pas recevoir d’autres demandes pour le moment. Réessayez plus tard ou appelez-nous.',
  reload: 'Votre demande n’a pas pu être envoyée. Rechargez la page et réessayez.',
  blocked: 'Votre demande n’a pas pu être envoyée. Merci de nous appeler.',
  closed: 'Les demandes en ligne sont suspendues pour le moment. Merci de nous appeler.',
  // prix indicatif
  nightsN: function (n) { return n + (n === 1 ? ' nuit' : ' nuits'); },
  quote: function (total, n) { return 'Prix indicatif : ' + total + ' pour ' + n + ', ménage compris. Nous vous le confirmerons dans notre réponse.'; },
  quoteNoFee: function (total, n) { return 'Prix indicatif : ' + total + ' pour ' + n + '. Nous vous le confirmerons dans notre réponse.'; },
  quoteIncomplete: 'Nous vous enverrons le prix par e-mail.',
  quoteHow: 'Détail du calcul',
  quoteRate: function (n, price) { return n + ' × ' + price; },
  quoteCleaning: function (fee) { return 'ménage ' + fee; },
  minStay: function (n) { return 'Séjour minimum pour ces dates : ' + n + ' nuits.'; }
};
