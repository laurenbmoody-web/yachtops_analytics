# Privacy Policy — Cargo → PYA Autofill

_Last updated: 2026-07-07_

> **Canonical version:** the hosted policy at
> **https://cargotechnology.netlify.app/privacy** (the URL on the Chrome Web
> Store listing). This file is a summary kept in the repo for convenience —
> if they ever differ, the hosted page wins. The page source lives at
> `src/marketing/pages/PrivacyPolicyPage.jsx`; update both together.

The **Cargo → PYA Autofill** extension helps a yacht crew member fill the PYA
Sea Service Testimonial (SST) form from data they have already prepared in Cargo.

## What it does

- It runs **only** on `https://member.pya.org/*`.
- When you click **Fill from Cargo** (or the toolbar icon), it reads the text you
  copied to your clipboard in Cargo (via the app's "Copy for PYA" button) and
  types it into the PYA form fields in your browser.

## Data handling

- **No data is collected, stored, or transmitted anywhere.** The clipboard
  content is read only at the moment you click Fill, used only to populate the
  form on the page in front of you, and then discarded.
- The extension has **no servers, no analytics, and no tracking**. It makes no
  network requests of its own.
- It does not read the clipboard, the page, or anything else except when you
  explicitly trigger a fill on the PYA page.

## Permissions and why they're needed

- **Clipboard read** — to read the record you copied from Cargo.
- **Scripting / access to `member.pya.org`** — to place the values into the PYA
  form fields.

## Contact

Questions: lauren.moody@hotmail.co.uk
