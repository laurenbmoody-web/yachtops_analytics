# Cargo — roadmap

Future work that's been scoped but deliberately deferred. Add items here as they
come up so they aren't lost.

## Gangway presence — native NFC / Apple Wallet pass

**Goal:** a crew member taps their phone (or a fob) on the entry-door iPad and it
flips their aboard/ashore status, based on their last state.

**Why it's deferred:** a web app running on the iPad **cannot read NFC**. iOS only
exposes NFC reading to native apps with the Core NFC entitlement (and Wallet
passes need the pass/NFC entitlements). A Safari/PWA kiosk has no NFC access, so
the true "tap your phone" experience requires a native iOS app.

**Interim (shipped):** QR "gangway pass".
- Each crew member has a personal pass at `/door-pass` — a QR encoding
  `cargo-pass:<userId>` (add to Home Screen for one-tap access).
- The door quick-board has a **Scan pass** button that opens the camera
  (`DoorScanModal`, jsQR fallback for iOS Safari), reads the pass, and flips that
  person's status with a confirmation toast.

**Native path (planned):**
- Build the gangway board as (or inside) a native iOS app → read real Apple
  Wallet passes / NFC fobs via Core NFC.
- Issue signed Wallet passes per crew member (serial = a server-side token, not
  the raw user id) so taps are authenticated, not forgeable.
- Server endpoint to resolve a pass token → user and toggle presence
  (reuse `crew_presence` + `setPresence`).
- Consider an external USB/BLE NFC reader as a no-app-store stopgap (acts as a
  keyboard "typing" the token into the board).

**Security note on the interim QR:** the pass encodes a raw `userId` (a UUID), so
it's a low-security convenience for a physical door, not an authenticated action.
The native version with signed pass tokens is the hardening step.
