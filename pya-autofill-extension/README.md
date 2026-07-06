# Cargo → PYA Autofill (Chrome extension)

Fills the PYA **Verify Sea Service Testimonial (SST)** form from a crew member's
Cargo record. Replaces the "Fill PYA form" bookmarklet — no bookmark to re-drag,
and it fills PYA's custom controls (radios, the flag picker, checkboxes) more
reliably because it can wait for and retry them.

## Install (one time, no store needed)

1. Download this `pya-autofill-extension` folder (Code ▸ Download ZIP on GitHub,
   then unzip — keep `manifest.json` and `content.js` together).
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `pya-autofill-extension` folder.
5. Done — a "Cargo → PYA Autofill" card appears in the list.

## Use

1. In Cargo, open the crew member's **Hand your record to PYA** step and click
   **Copy for PYA** on the captain's record.
2. Go to the PYA `.../sst-request/create` page.
3. Trigger the fill either way:
   - click the floating **⚓ Fill from Cargo** button (bottom-right of the page), **or**
   - click the **Cargo → PYA** icon in the Chrome toolbar.
4. It fills the form and shows a toast + a console summary of what filled and what
   to finish by hand. **Nothing is submitted** — always review before you submit.

If nothing happens, open the Console (View ▸ Developer ▸ JavaScript Console) and
look for a green `[Cargo→PYA] extension active` line — that confirms the script is
running on the page.

## Updating

When a new version is published, re-download the folder (overwrite it) and click
the **↻ reload** icon on the extension card in `chrome://extensions`. No re-drag.

## Notes

- The flag country-picker and area checkboxes are driven automatically; anything
  Cargo has no data for (engine type, propulsion kW, night watch hours) is left
  for you and listed in the console summary.
- If a radio (Capacity / Vessel Type) doesn't fill, open the browser Console
  (View ▸ Developer ▸ JavaScript Console) — the extension logs the option's markup
  under `[Cargo→PYA]`; send that to us and we'll wire it exactly.
