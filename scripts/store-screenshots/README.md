# App Store screenshots

Run **Actions → App Store screenshots → Run workflow** (or push a change here on
a `claude/**` branch). It signs in to the app as the App Review demo captain
(`appreview@example.com`, password in the `DEMO_PASSWORD` repo secret), captures
each screen in `shots.config.mjs` at the iPhone 6.9" and iPad 13" sizes, frames
them, and commits the results to the `store-screenshots` branch:

- `iphone/`, `ipad/` — upload-ready framed PNGs
- `raw/` — the bare captures (plus `_full` tall versions for tuning scroll)
- `contact-sheet.png` — every product photo on the demo vessel
