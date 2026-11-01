# Akrotiraki — web

Public website and the internal management app (`/app`) for Akrotiraki, Platys Gialos, Sifnos.
Static files served by GitHub Pages. Contains no secrets: the backend verifies every request.

## Cache busting

Every page links `site.css?v=…` and `site.js?v=…`; the home pages also `booking.js?v=…`, every page `mark.js?v=…`, and the fr/es/de
pages their `strings.js?v=…` (currently `?v=20261102h`). When you change any of these files, bump the `?v=`
value on every page (`*.html` at the root and in `el/`, `fr/`, `es/`, `de/`); a comment at the top of each
`<head>` marks the spot.
