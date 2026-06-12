# Cool-tone unification — handoff

**Branch:** `claude/practical-pasteur-6Bnih`
**Date:** 2026-06-12

## The problem
Two editorial palettes coexist in the app:

| Palette | Page background | Used by |
|---|---|---|
| **Cool** (target) | `#F8FAFC` | Provisioning **Boards** dashboard (`.pv-dashboard` / `.cargo-editorial`, tokens in `src/styles/editorial-tokens.css`) |
| **Warm** (cream) | `#F5F1EA` | `EditorialPageShell` pages (Orders, Pantry, Crew-Rota, Reviews, Trip-detail) + per-page warm tokens |

The Boards page is cool; the **Orders** page (`provisioning/SupplierOrderPage.jsx`) and other provisioning surfaces were still warm — that's the discrepancy in the screenshots.

## What I changed (DONE — provisioning section unified to cool)
All commits on the branch above. Build passes (`npx vite build`).

Neutral **warm surfaces → cool**, applied only inside `src/pages/provisioning/`:

| Warm (old) | Cool (new) | Meaning |
|---|---|---|
| `#F5F1EA`, `#FDF8F4`, `#FCFAF5`, `#FBF8F1`, `#FCFAF6` | `#F8FAFC` | page/body + near-white bands |
| `#F4EEE4`, `#FAF7F0`, `#FBF7EF`, `#FAF7EE`, `#F8F4EA`, `#F1F0EB` | `#F1F5F9` | soft fills / hover states |
| `#F1ECDF` | `#EEF0F4` | sand-soft rule |

Files touched: `SupplierOrderPage.jsx`, `ReturnConfirmPage.jsx`, `components/BoardDrawer.jsx`, `components/SendToSupplierModal.jsx`, `delivery-inbox.css`, `provisioning-board.css`, `supplier-detail/supplier-detail.css`, `suppliers/suppliers-directory.css`.

### Deliberately LEFT alone (not discrepancies)
- **Orange/amber accents** — `#C65A1A`, `#FEF3E8`, `#FCE6D2`, `#FEF3C7`, `#FFFBEB`, `#FB923C`, `#F59E0B`. These are the shared brand accent / `--d-warn`; they exist in the cool palette too.
- **Semantic colours** — reds (`#FEF2F2`/`#FCEBEB` danger), greens (`#F0FDF4` success).
- **`#FAEEDA`** — this is the cool palette's *own* documented warm chip (`--d-cream-warm` / `--d-status-partial-bg`). Intentional.
- **User-pickable swatches** — `BoardColumn.jsx` "Warm grey" `#F0EBE0`; `SupplierDetailPage.jsx` tag-colour options (`#F1EFE8` etc.). These are palette choices, not surface tone.
- A `#FFFEFB` example inside a code comment (`Drawer.jsx`).

## What REMAINS (if you want the WHOLE app cooled, not just provisioning)
The warm cream still lives in the rest of the app via the shared shell and per-page tokens. **Decide first** whether Pantry/Rota/Reviews/Trip-detail should also go cool — those surfaces were *designed* warm, so flipping them is a real design call, not a bug-fix. If yes, the holdouts are:

- **`src/components/editorial/EditorialPageShell.jsx:44`** — `const EDITORIAL_BG = '#F5F1EA'`. This single line forces the cream body bg on every shell page (Pantry, etc.). Change to `#F8FAFC` to flip them all at once. **Highest-leverage knob.**
- `src/pages/pantry/pantry.css` — multiple `#F5F1EA` + `#FAF7F0`
- `src/pages/crew-rota/crew-rota.css` (+ `index.jsx`, `ApplyTemplateModal.jsx`, `RotationTemplateEditor.jsx`)
- `src/pages/reviews/reviews.css`
- `src/pages/trip-detail-view-with-guest-allocation/index.jsx` + `sections/SectionAboard.jsx`
- `src/pages/pantry/widgets/NowAndDutyStack.jsx`

Audit command to re-list holdouts:
```
grep -rlniE "#F5F1EA" src --include=*.jsx --include=*.js --include=*.css | grep -v "/provisioning/"
```
Same warm→cool mapping table above applies. Verify each isn't an intentional accent before flipping (use the "left alone" list as the guard).

## Source of truth
- Cool tokens: `src/styles/editorial-tokens.css` (`--d-bg #F8FAFC`, `--d-card #FFFFFF`, `--d-border-soft #EEF0F4`, etc.). Prefer wiring surfaces to these tokens rather than re-hardcoding hexes.

---
## Unrelated in-flight thread (HOR phases — for context)
Separate from the tone work. On the same branch: **Phase 0** (unified MLC compliance engine) and **Phase 1** (rota-derived HOR baseline) are committed/pushed. **Phases 3–5** (Supabase tables for confirmation workflow, breach sign-off, unified IMO/ILO PDF) are the remaining heavy lift and were not started. See earlier commits.
