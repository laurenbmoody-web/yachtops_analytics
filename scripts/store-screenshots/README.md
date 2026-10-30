# App Store screenshots

Run **Actions → App Store screenshots → Run workflow** (or push a change here on
a `claude/**` branch). It signs in to the app as the App Review demo captain
(`appreview@example.com`, password in the `DEMO_PASSWORD` repo secret), captures
each screen in `shots.config.mjs` at the iPhone 6.9" and iPad 13" sizes, frames
them, and commits the results to the `store-screenshots` branch:

- `iphone/`, `ipad/` — upload-ready framed PNGs
- `raw/` — the bare captures (plus `_full` tall versions for tuning scroll)
- `promo/header.jpg` (3840×1646) and `promo/search.jpg` (3840×2560) — product page header and search results image
- `contact-sheet.png` — every product photo on the demo vessel

For the 6.3" iPhone slot (1206 × 2622), the raw `film_*` captures can be framed at that size — see the session notes for the Jobs / Inventory / Crew set.
