# Cargo native app (iOS + Android)

The app is the existing web app wrapped with [Capacitor 8](https://capacitorjs.com).
One codebase: every web feature ships to the app too. The native projects live in
`ios/` and `android/`; app-only behaviour lives in `src/lib/native/`.

| | |
|---|---|
| Bundle / package id | `uk.co.cargotechnology.app` |
| Public site (links, QR codes, auth emails) | `https://cargotechnology.netlify.app` (`VITE_PUBLIC_APP_URL` overrides) |
| Universal / app links | `public/.well-known/apple-app-site-association`, `public/.well-known/assetlinks.json` |
| Icons & splash source | `resources/logo.png` → `npx capacitor-assets generate --assetPath resources …` |

## Run it locally

Needs Node 22+, the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as the web
build (in `.env`), and Xcode (iOS, macOS only) or Android Studio.

```
npm install
npm run app:ios       # build web → sync → open Xcode, then Run
npm run app:android   # build web → sync → open Android Studio, then Run
npm run app:sync      # after any web change, to refresh both projects
```

CI (`.github/workflows/native-build.yml`) compiles both on PRs that touch native
code and uploads a sideloadable Android debug APK.

## How the web app adapts inside the shell (`src/lib/native/`)

Everything checks `isNative()` first, so the browser build is unchanged.

| Web behaviour | In the app | File |
|---|---|---|
| `<a download>` / file-saver / `jsPDF.save()` exports | written to cache → native share sheet | `files.js` |
| `window.open('')` print windows (labels, QR, reports) | in-app viewer sheet; Print → native print dialog (`CargoPrint` plugin) | `windows.js` |
| `window.print()` on a page | native print dialog | `windows.js` |
| `window.open(url)` / `target="_blank"` | same-app path → in-app route; external → in-app browser | `windows.js` |
| `fetch('/api/…')`, `fetch('/.netlify/functions/…')` | native HTTP to the public site (no CORS) | `net.js` |
| Links, QR codes, auth `redirectTo` | `publicOrigin()` — never `window.location.origin` | `platform.js` |
| Web push (service worker) | APNs / FCM, same `push_subscriptions` table | `push.js` |
| Universal links, auth links from email, push taps, Android back | routed in-app | `NativeBridge.jsx` |
| Stripe checkout / billing portal, `/pricing` link | hidden (App Store / Play payment rules) | `membership`, `settings`, `login` |
| Marketing site (`/`) | redirects to `/login` | `NativeBridge.jsx` |

iOS keeps the web view inside the safe area natively
(`ios/App/App/MainViewController.swift`), and Android does the same through
Capacitor's SystemBars insets handling — so pages need no `env(safe-area-inset-*)`
CSS.

## Offline

**Layer 1 — reads (done).** `src/lib/offline/` wraps the Supabase client's fetch:
every read (PostgREST `GET`/`HEAD`, read-only RPCs, storage sign/list) is saved in
IndexedDB per user, and served when the network fails, returns a gateway 5xx, or
stalls for 6s on a slow link. A write to a table marks its saved reads stale (still
shown offline, never for a merely slow link). An expired token offline is kept
alive locally (`authFallback.js`) so crew stay signed in at sea. The pill at the
bottom (`components/offline/OfflineBar.jsx`) says when data is from the device and
how old it is. Saved reads are cleared on sign-out. Works on the web too.

Limits: only screens opened online before have saved data; images not yet viewed
won't load; saves fail offline (layer 2).

**Layer 2 — recording work offline.** `outbox.js` (+ `queue.js`) is a persistent
outbox of table writes. Online a write runs immediately and a real rejection still
throws; with no network it is saved on the device and the save counts as done. The
latest edit per row (`key`) wins. Pending edits are laid over every read of their
table (`overlay.js`, matched on the query's filters), so they stay visible across
reloads and aren't "reverted" by older saved copies. Sync runs on reconnect, app
resume, a successful request, and every 30s while anything waits; a change the
server rejects on sync (e.g. a month locked meanwhile) is dropped with a toast.
Ops are per user and survive sign-out. The pill shows "N changes saved on this
device" / "Syncing".

| Workflow | Status |
|---|---|
| Hours of rest — logging / clearing a day (`horWorkEntries.js`) | ✅ offline |
| Hours of rest — submit month, breach reasons, sign-off | needs a connection |
| Jobs — create, complete, status, edit, reject, notes, steps (`jobWrites.js`, `jobSteps.js`) | ✅ offline |
| Defects — log (photos ride in the row), update, assign, claim, accept/decline, close/reopen, comments, history, promote to maintenance (`defectsStorage.js`) | ✅ offline |
| Notifications raised offline (`dbNotifications.js`) | ✅ delivered on reconnect |
| Defect quote approval decision (RPC) | needs a connection |
| Laundry — add (with photos), status, edit, notes, split/move, bulk deliver/archive/restore, delete (`laundryStorage.js`) | ✅ offline |
| Laundry photos — queued uploads, shown from the device until uploaded (`laundryPhotos.js`) | ✅ offline |
| Wardrobes & cases — create, edit, pack/unpack, case photos, remove (`laundryWardrobes.js`, `laundryCases.js`) | ✅ offline |
| Laundry vessel settings, "reset day" (chief), case share links | needs a connection |
| Inventory & provisioning | next |

## Push

Every signed-in phone is enrolled (topic `general` → job reminders etc.); the
profile's "Laundry alerts" switch moves it to topic `laundry`. Sign-out detaches the
phone. Delivery: `supabase/functions/_shared/push.ts`, used by `laundry-push` and
`job-reminder-push`. A channel without secrets is skipped.

## One-time setup (accounts, keys, signing)

**Apple**
1. Apple Developer Program membership.
2. Register App ID `uk.co.cargotechnology.app` with Push Notifications and
   Associated Domains.
3. Replace `APPLE_TEAM_ID` in `public/.well-known/apple-app-site-association` with
   the 10-character Team ID; set the team in Xcode (Signing & Capabilities).
4. Create an APNs auth key (.p8). Supabase → Edge Functions → Secrets:
   `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the .p8 file contents),
   optionally `APNS_BUNDLE_ID`.

**Android / Firebase**
1. Google Play Console account.
2. Firebase project → add Android app `uk.co.cargotechnology.app` → download
   `google-services.json` into `android/app/` (not committed to the repo).
3. Firebase → Project settings → Service accounts → generate key. Supabase secret
   `FCM_SERVICE_ACCOUNT` = the whole JSON.
4. Replace `ANDROID_RELEASE_SIGNING_SHA256` in `public/.well-known/assetlinks.json`
   with the release (Play App Signing) SHA-256 fingerprint.

**Store listings**: privacy labels / data-safety form, screenshots, and a demo
login for app review. In-app account deletion already exists (Settings →
`delete-my-account`).

## Before store submission

- Icons are upscaled from a 512px mark. Supply a 1024×1024 master as
  `resources/logo.png` and regenerate.
- Android shows the launcher icon as the notification status-bar icon; add a white
  monochrome `ic_stat_cargo` drawable and point
  `com.google.firebase.messaging.default_notification_icon` at it.
- Go through every screen at phone width: wide editorial tables, drawers and
  modals are the likeliest to need mobile layout work.
