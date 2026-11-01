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
- Replay real-shaped data (dev only): `?mock=1&fixture=<url>` (or `?fixture=<url>` alone) loads that JSON as the
  `bootstrap` payload (or a whole `{ok, data}` reply) into the demo backend; `getPricing` is derived from it with the
  cleaning fees kept as Settings strings, unless the JSON has its own `getPricing` key. The URL must be same-origin or
  serve CORS headers. Writes stay in memory.

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
- **Profile** (`#profile`; Account menu on phones, bottom of the side rail on desktop): name, email and role, and
  per-device display options in `localStorage` `ak.prefs` (code in `ui.js`, applied at once): colour scheme (System,
  Light, Dark; Akrotiraki: Paper, Grey, Dusk; Personal: Graphene; Classics: Material Darker/Lighter, Nord,
  Solarized Light/Dark, Gruvbox Dark, Catppuccin Latte/Mocha), default calendar view, start screen (used when the URL
  has no `#…`), density (Compact ≈ 10% smaller type and spacing) and currency display (cents when an amount has them,
  or whole euros). Schemes are `[data-scheme="…"]` token blocks in `app.css`; an inline script in `index.html` sets
  `data-scheme`/`data-density` and `theme-color` before first paint (keep its list in sync with `SCHEMES` in `ui.js`).
  Every scheme sets the same roles, text contrast ≥ 4.5:1 (some classic accents are darkened or lightened for that).
- **Calendar views** (opens in the Profile's default view; a switch lasts until reload): Month (day timeline), 3 months
  (compressed; names on wide screens only), Season (`season_start`..`season_end`), Year, and List (stays grouped by
  month, from today in the current period). Prev/next move by a month, three months or a year. Bars in the
  compressed views show a label on hover, or on the first tap on phones. A source filter applies to every view.
  Month and 3 months zoom horizontally: pinch, ctrl/cmd + wheel, or the − Fit + control in the top-left cell
  (day width 14–64 px, or less when "Fit" needs it; guest names from 28 px). Remembered per view in `ak.cal.dayw.<view>`.
  Dev knob: `?mock=1&many=1` adds ~300 stays to the demo data for performance checks.
- **Whole-house requests** (`group_id`): the Requests tab shows the group as one card (apartments, total guests, group
  total and deposit, extras from the first); Approve all / Decline all call `setReservationStatus` with
  `apply_to_group: true` on the first id. Group bars carry a link glyph; the form lists the other apartments.
  The pending badge counts a group once.
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
- **Extras** (API.md "Extras"): bootstrap `extras` (all rows; the app shows `name_en`). The reservation form has an
  Extras block (paid / requests / on request) with quantity, option and, for on-request items, the agreed amount;
  price = accommodation + cleaning − discount + extras. A price from the list is re-quoted with `quoteFor`
  (`extras`, `guests`) and saved with `autoprice`; otherwise the lines are sent with `unit_price`/`amount` (only when
  changed) and the price moves by the difference in the extras total. Request cards list the extras; Approve is
  blocked until every on-request item has an amount. Prices has a fourth card for the Extras tab (`saveExtras`).
- **Totals** are computed on the device from loaded data; when the `totals` action answers, its numbers are used.
- **Statistics** (tab): KPI row and SVG charts (occupancy per apartment, revenue vs `plan`, sources, stay length and
  lead time, expenses by category), computed on the device like Totals; each chart has a data table. Bootstrap's
  optional `plan` rows and `settings.sheet_url` are used when present.
- **Price quick actions**: Copy year, Adjust by % (preview table, then the draft is changed; Save rates writes it),
  Last-minute discount (updates the first `last_minute` rule or adds one, sets `from` = today and `to` = the
  "until" date, turns it on and saves). Discount kinds include `gap` (`max_gap_nights`, `touching`); unknown kinds
  are kept and saved back unchanged.
- **Monthly rates** (first Prices card): year selector (years in `getPricing.monthly` plus the next), 12 rows with
  maisonette/studio €/night, min nights and a Closed switch. Edited rows are marked; Save sends only those to
  `saveMonthlyRates` (both prices empty = no rate) and, when closed months changed, the whole Closed tab to
  `saveClosed`. Closed on = a whole-month row for all apartments (merged with touching ones); off cuts the month out
  of all-apartment rows. Months whose rates vary (`partial`) show "varies → see rows" (opens Advanced at that year);
  "Raise/lower all by %" skips them; "Copy to <year+1>" copies the shown values. **Closed periods** edits the
  Closed tab row by row. The old seasonal-rates card is now **Advanced: rate rows**, collapsed by default; saving
  either rates card reloads the other (they write the same tab; a confirm guards unsaved changes in the other).
- **Prices** (owners; side rail on desktop, Account menu or the Totals header on phones): seasonal rates, cleaning
  fees, discount rules and extras via `getPricing` / `savePrices` / `saveCleaningFees` / `saveDiscounts` / `saveExtras`. Each card saves on
  its own and replaces the whole tab; server `data.row` / `data.field` errors are marked on the cell.

## Files

```
index.html, app.css, app.js     shell, routing, sign-in flow, Profile screen
config.js                       API_URL / CLIENT_ID / MOCK
api.js, auth.js, state.js       API client, Google sign-in, state + cache
actions.js                      writes (save/cancel/confirm, expenses, receipts)
lib.js, calc.js, ui.js          dates/formatting/overlap, totals maths, DOM helpers + device preferences
mock.js                         in-memory fake backend for demo mode
views/                          calendar, requests, reservation form, expenses, totals, stats, prices
sw.js, manifest.webmanifest     PWA
icons/                          icon.svg + PNGs (regenerate: node tools/make-icons.js)
```
