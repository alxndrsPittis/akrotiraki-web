// Akrotiraki — Spanish interface strings (lightbox, request form, calendar, price quote).
// Loaded before ../site.js, which merges window.AKRO_STRINGS.es over the English defaults.
window.AKRO_STRINGS = window.AKRO_STRINGS || {};
window.AKRO_STRINGS.es = {
  // tabla de precios (booking.js)
  rDates: 'Fechas',
  rCaption: function (y) { return 'Precios por noche para ' + y; },
  rPerNight: function (m) { return m + ' / noche'; },
  rMin: function (n) { return 'mínimo ' + n + ' noches'; },
  rCleaning: function (m, s) { return 'Limpieza por estancia: ' + m + ' el dúplex, ' + s + ' el estudio.'; },
  rDiscStay: function (p, n) { return p + ' % de descuento para estancias de ' + n + ' noches o más'; },
  rDiscEarly: function (p, d) { return p + ' % de descuento para reservas hechas con ' + d + ' días de antelación'; },
  rDiscDates: function (p, a, b) { return p + ' % de descuento para estancias del ' + a + ' al ' + b; },
  rForType: { maisonette: ' (dúplex)', studio: ' (estudios)' },
  photo: function (i, n) { return 'Fotografía ' + i + ' de ' + n; },
  // booking.js (request to stay)
  name: 'Nombre', email: 'Correo electrónico', arrival: 'Llegada', departure: 'Salida', house: 'Apartamento', guests: 'Personas',
  any: 'Cualquier apartamento', maisonette: 'Dúplex', studio: 'Estudio',
  prevMonth: 'Mes anterior', nextMonth: 'Mes siguiente',
  free: 'libre', onRequest: 'a consultar', taken: 'ocupado', past: 'no disponible',
  selArrival: 'su llegada', selDeparture: 'su salida', selStay: 'dentro de su estancia',
  hint: 'Elija un día de llegada y después uno de salida.',
  pickedArrival: function (d) { return 'Llegada: ' + d + '. Ahora elija el día de salida.'; },
  pickedRange: function (n, a, d) { return n + (n === 1 ? ' noche' : ' noches') + ', del ' + a + ' al ' + d + '.'; },
  calError: 'No se ha podido cargar el calendario. Aun así, puede enviarnos una solicitud más abajo.',
  err: {
    unit_id: 'Elija un apartamento.',
    check_in: 'Elija una fecha de llegada.',
    check_in_past: 'La fecha de llegada ya ha pasado.',
    check_out: 'Elija una fecha de salida posterior a la de llegada.',
    check_out_long: 'Para estancias de más de 60 noches, llámenos.',
    guests: function (n) { return 'Indique entre 1 y ' + n + ' personas para este apartamento.'; },
    email: 'Escriba una dirección de correo electrónico válida.',
    guest_name: 'Escriba su nombre.',
    guest_name_long: 'El nombre es demasiado largo.',
    phone: 'El número de teléfono es demasiado largo (40 caracteres como máximo).',
    message: 'El mensaje es demasiado largo (2.000 caracteres como máximo).'
  },
  checkFields: 'Revise los campos marcados más abajo.',
  sending: 'Enviando…', send: 'Enviar solicitud',
  network: 'No hemos podido enviar su solicitud. Inténtelo de nuevo dentro de un momento o llámenos.',
  quick: 'Ha sido muy rápido. Revise sus datos y vuelva a enviar la solicitud.',
  duplicate: 'Ya tenemos esta solicitud y le responderemos pronto. No hace falta que la vuelva a enviar.',
  cap: 'En este momento no podemos aceptar más solicitudes. Inténtelo más tarde o llámenos.',
  reload: 'No se ha podido enviar su solicitud. Vuelva a cargar la página e inténtelo de nuevo.',
  blocked: 'No se ha podido enviar su solicitud. Llámenos, por favor.',
  closed: 'Ahora mismo no se admiten solicitudes por internet. Llámenos, por favor.',
  // indicative price (quote)
  nightsN: function (n) { return n + (n === 1 ? ' noche' : ' noches'); },
  quote: function (total, n) { return 'Precio orientativo: ' + total + ' por ' + n + ', limpieza incluida. Se lo confirmaremos en nuestra respuesta.'; },
  quoteNoFee: function (total, n) { return 'Precio orientativo: ' + total + ' por ' + n + '. Se lo confirmaremos en nuestra respuesta.'; },
  quoteIncomplete: 'Le enviaremos el precio por correo electrónico.',
  quoteHow: 'Cómo se calcula',
  quoteRate: function (n, price) { return n + ' × ' + price; },
  quoteCleaning: function (fee) { return 'limpieza ' + fee; },
  minStay: function (n) { return 'Estancia mínima para estas fechas: ' + n + ' noches.'; }
};
