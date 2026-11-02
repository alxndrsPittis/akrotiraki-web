# Akrotiraki — web

Public website and the internal management app (`/app`) for Akrotiraki, Platys Gialos, Sifnos.
Static files served by GitHub Pages. Contains no secrets: the backend verifies every request.

## Cache busting

Every page links `site.css?v=…`, `themes.css?v=…`, `site.js?v=…` and `mark.js?v=…`; the booking pages (`book.html`) also `booking.js?v=…`, and the fr/es/de
pages their `strings.js?v=…` (currently `?v=20261103a`). When you change any of these files, bump the `?v=`
value on every page (`*.html` at the root and in `el/`, `fr/`, `es/`, `de/`); a comment at the top of each
`<head>` marks the spot.

## Request to stay

The three-step request (calendar, apartments with prices, details and extras) is on `book.html` in each language;
`booking.js` is loaded only there. The home pages keep a short "Request to stay" block with a button to it, and
every other page shows a small floating "Check availability" button (built by `site.js`, not on `book.html`).

## Colour and type switcher (development only)

The "Aa" button next to the language menu (in the phone menu: at the bottom) opens a panel with colour schemes
(Paper = default, Stone, Schist, Olive, Terracotta, Dusk) and type pairings (A Fos-like: Newsreader + Comfortaa 300;
B Classic, the default: Gentium Plus + Inter; C Modern: Manrope; D Didone: GFS Didot + Inter). The choice is kept in
`localStorage` (`akro-theme`, `akro-fonts`) and applied before first paint by the small inline script in each
`<head>`; `?theme=stone` or `?fonts=a|c|d` in a URL preselects. Tokens and pairings: `themes.css`. Fonts of A, C, D
are fetched only when selected. Everything the switcher adds carries `data-dev` and a `dev-*` class.

To remove it for launch: delete the `devSwitcher();` line in `site.js` (and, optionally, the "DEV" block at the end
of `site.css`). If a scheme or pairing is chosen for good, move its tokens into `site.css` `:root`.

## Hero video

The home pages have a hidden `<video class="hero-video">` over the hero photo, with its sources commented out.
To use a muted looping video: put `photos/hero.webm` and/or `photos/hero.mp4` (short, no audio track, ideally
under ~4 MB, 1600–1920 px wide, first frame close to `deckchairs-dusk.webp`) in `photos/`, then uncomment the
`<source>` lines on the five home pages (`index.html`, `el/`, `fr/`, `es/`, `de/`). `site.js` starts it only when
a source exists and the visitor has not asked for reduced motion; otherwise, or if it fails, the photo stays.
