# Akrotiraki — web

Public website and the internal management app (`/app`) for Akrotiraki, Platys Gialos, Sifnos.
Static files served by GitHub Pages. Contains no secrets: the backend verifies every request.

## Cache busting

Each page links `site.css?v=…` and `site.js?v=…` (currently `?v=20261101b`). When you change
`site.css` or `site.js`, bump the `?v=` value on both links in all four pages
(`index.html`, `archaeology.html`, `el/index.html`, `el/archaeology.html`); a comment at the top
of each `<head>` marks the spot.
