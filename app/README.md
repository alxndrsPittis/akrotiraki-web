# Akrotiraki management app (PWA)

Small installable web app for the family: reservations calendar, expenses with receipt photos, and yearly totals.
Plain HTML/CSS/JS (ES modules), no build step, no dependencies. Talks to the Apps Script backend described in
`akrotiraki-ops/docs/API.md`.

Live at `https://alxndrspittis.github.io/akrotiraki-web/app/` (GitHub Pages). All paths are relative, so it works under that subpath.

## Run locally

```sh
cd akrotiraki-web
python3 -m http.server 8080
```

- Demo with sample data: <http://localhost:8080/app/?mock=1> (no backend, nothing is saved; pick "Owner (demo)" or "Manager (demo)").
- With an empty `API_URL` in `config.js` the app always runs in demo mode.

The service worker caches the app shell (stale-while-revalidate). While developing, use DevTools → Application →
"Update on reload", or a private window, to avoid seeing an older cached copy.

## Configure

Edit `config.js`:

| Key | Value |
|---|---|
| `API_URL` | The Apps Script web-app URL (`https://script.google.com/macros/s/…/exec`). |
| `CLIENT_ID` | OAuth 2.0 *Web* client ID from Google Cloud Console. Must equal `client_id` in the Settings tab. Add `https://alxndrspittis.github.io` (and `http://localhost:8080` for testing) as authorised JavaScript origins. |
| `MOCK` | `true` forces demo mode. `?mock=1` in the URL does the same. |

`config.js` is public; it contains no secrets. Access is controlled by the backend (Users tab).

## Deploying a new version

1. Commit and push; GitHub Pages serves the files as they are.
2. Bump `VERSION` in `sw.js` (and add any new file to its `SHELL` list) so installed apps pick up the change.

## How it works

- **Sign-in**: Google Identity Services. The ID token and its expiry are kept in `localStorage`; within 5 minutes of
  expiry the app asks GIS for a new one silently, otherwise it shows the sign-in screen. An `unauthorized` reply
  from the API also signs you out.
- **Data**: every call is `POST API_URL` with `Content-Type: text/plain` and `{token, action, payload}`.
  The last `bootstrap` is cached in `localStorage`, so the app opens instantly and shows the last data offline.
  Writes update local state from the object the server returns.
- **Roles**: managers can add and edit everything but cannot confirm reservations; owners can, and can
  "Confirm anyway" over an overlap (`force: true`).
- **Requests** (tab with a badge; also the "Pending (n)" chip on the calendar): every pending reservation as a card
  with contact, message, price breakdown (accommodation + cleaning − discount = total, deposit on the total) and overlaps. Approve (owners)
  asks for a price first when it is 0, then confirms with `setReservationStatus` and a "Send email" switch
  (`notify`); Decline does the same with status `cancelled`. "Email guest" opens a `mailto:` in your own mail app.
- **Prices**: the reservation form quotes from the price list with `quoteFor` (automatically for new reservations
  until you type a price; "Recalculate price" any time). `saveReservation` always sends `autoprice` explicitly.
  `price` is what the guest pays (accommodation + cleaning − `discount`). Typing a discount while a quote is loaded
  sets price = quote total − discount; a price typed by hand is kept and the discount stays as entered.
- **Discount rules**: when the server autoprices a new stay and no discount was typed, `discount` is omitted so the
  backend applies the best Discounts rule; an empty Discount field in the form means "the quote's rule" (shown as a
  placeholder with its label), a typed amount (0 included) overrides it. `discount_label` is shown next to the
  discount line in the form, the request cards and the approve dialog.
- **Totals** are computed on the device from loaded data; when the `totals` action answers, its numbers are used.
- **Statistics** (tab): KPI row and SVG charts (occupancy per apartment, revenue vs `plan`, sources, stay length and
  lead time, expenses by category), computed on the device like Totals; each chart has a data table. Bootstrap's
  optional `plan` rows and `settings.sheet_url` are used when present.
- **Prices** (owners; side rail on desktop, Account menu or the Totals header on phones): seasonal rates, cleaning
  fees and discount rules via `getPricing` / `savePrices` / `saveCleaningFees` / `saveDiscounts`. Each card saves on
  its own and replaces the whole tab; server `data.row` / `data.field` errors are marked on the cell.

## Files

```
index.html, app.css, app.js     shell, routing, sign-in flow
config.js                       API_URL / CLIENT_ID / MOCK
api.js, auth.js, state.js       API client, Google sign-in, state + cache
actions.js                      writes (save/cancel/confirm, expenses, receipts)
lib.js, calc.js, ui.js          dates/formatting/overlap, totals maths, DOM helpers
mock.js                         in-memory fake backend for demo mode
views/                          calendar, requests, reservation form, expenses, totals, stats, prices
sw.js, manifest.webmanifest     PWA
icons/                          icon.svg + PNGs (regenerate: node tools/make-icons.js)
```
