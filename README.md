# Akrotiraki — web

Public website and the internal management app (`/app`) for Akrotiraki, Platys Gialos, Sifnos.
Static files served by GitHub Pages. Contains no secrets: the backend verifies every request.

## Cache busting

Each page links `site.css?v=…` and `site.js?v=…`, and the two home pages also `booking.js?v=…`
(currently `?v=20261101f`). When you change `site.css`, `site.js` or `booking.js`, bump the `?v=` value
on every page (`*.html` at the root and in `el/`); a comment at the top of each `<head>` marks the spot.
