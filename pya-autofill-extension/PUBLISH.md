# Publishing "Cargo → PYA Autofill" so crew can one-click install

Goal: crew click **Add to Chrome** from a link — no developer mode, no folders,
and it auto-updates when we push fixes. We do this by publishing to the Chrome
Web Store as **Unlisted** (private to people with the link; not in public search).

## One-time setup (you)

1. Go to the **Chrome Web Store Developer Dashboard**:
   https://chrome.google.com/webstore/devconsole
2. Sign in with the Google account you want to own the listing.
3. Pay the **one-time US$5** developer registration fee (Google's, not ours).

## Package the extension

Zip the **contents** of the `pya-autofill-extension` folder (so `manifest.json`
is at the top level of the zip, not inside a subfolder):

```
cd pya-autofill-extension
zip -r ../cargo-pya-autofill.zip . -x ".*"
```

The zip must contain: `manifest.json`, `background.js`, `content.js`, `icons/`.
(`README.md`, `PRIVACY.md`, `PUBLISH.md` can stay in the zip — harmless.)

## Create the listing

1. Dashboard → **+ New item** → upload `cargo-pya-autofill.zip`.
2. **Store listing** tab:
   - **Description**: see `store-listing.txt`.
   - **Category**: Productivity (or Workflow & Planning).
   - **Icon**: picked up automatically from the manifest (the Cargo "C").
   - **Screenshots**: at least one 1280×800 or 640×400 PNG — a screenshot of the
     PYA form after a fill, with the "Fill from Cargo" button visible, works well.
3. **Privacy practices** tab:
   - **Single purpose**: "Fills the PYA Sea Service Testimonial form from data the
     user copied in the Cargo app."
   - **Permission justifications**:
     - `clipboardRead` — "Read the record the user copied from Cargo, to fill the form."
     - `scripting` — "Inject the form-filler into the PYA page on user action."
     - Host `member.pya.org` — "The only site the extension fills."
   - **Data usage**: tick that you do **not** collect or sell user data.
   - **Privacy policy URL**: `https://cargotechnology.netlify.app/privacy`
     (the in-depth hosted policy page — this is what the reviewer checks; a raw
     markdown file or GitHub link gets rejected. Note: the URL goes in the
     **account/item privacy fields in the dashboard**, so fixing a
     privacy-policy rejection does not require uploading a new zip — just set
     the URL and resubmit).
4. **Distribution** tab → **Visibility: Unlisted**.
5. **Submit for review** (usually approved in ~1–3 business days).

## Share it

Once approved, copy the item's Web Store URL and share it with crew. They click
**Add to Chrome** and they're done — no developer mode, ever.

## Updating later

When we ship a fix:
1. Bump `"version"` in `manifest.json` (e.g. `1.0.1`).
2. Re-zip and upload the new package in the Dashboard → **Package** tab.
3. Submit. Everyone's extension auto-updates within a few hours — **no re-install**.

---

### Zero-install fallback

Anyone who can't/won't install the extension can still use the **"Fill PYA form"
bookmarklet** from Cargo's "Hand your record to PYA" step (drag it to the
bookmarks bar once). It's less robust on PYA's custom controls than the
extension, but needs no install.
