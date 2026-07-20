# Inventory — Schema & Competitive Review

_Prepared 20/07/2026 · covers the `enhanced-4-level-inventory-navigation` page, the
`inventory_items` / `inventory_locations` / `vessel_locations` / `inventory_movements`
schema, and how Cargo compares to Sortly, IDEA Yacht and Pinpoint Works._

## Verdict in one line

Cargo already has a **richer item model and deeper yacht-specific tooling than Sortly**
(the mass-market benchmark), but three foundations are unfinished: the **location
hierarchy is modelled three different ways**, the **stock-movement audit ledger isn't
wired to manual changes**, and **low-stock / expiry alerting is schema-only and dormant**.
Close those three and Cargo is competitive with IDEA on the inventory axis while keeping
its editorial UX edge.

---

## 1. What we have today

The core item table `inventory_items` is genuinely rich (57 columns). An item can carry:

- **Quantity** — `quantity` / `total_qty`, plus per-location `stock_locations` (jsonb) and
  a `partial_bottle` fraction for open bottles (a nice yacht/F&B touch).
- **Units & pack maths** — `unit` (stocking), `purchase_unit` + `units_per_pack` (buy a
  case of 24, stock in bottles).
- **Cost / valuation fields** — `unit_cost`, `purchase_price`, `currency`, `value_method`.
- **Identifiers** — `barcode`, `cargo_item_id` (human-friendly, trigger-assigned), `expiry_date`.
- **Extensibility** — `custom_fields` (jsonb, GIN-indexed), `tags` (text[]),
  `variants` (jsonb).
- **Appearance** — `icon`, `color`, single `image_url`.
- **Alcohol/wine specifics** — `is_alcohol`, `year`, `brand`, `tasting_notes`, partial-bottle.
- **Governance** — `tenant_id` scoping, `usage_department`, folder-level visibility tiers,
  role-tier RLS (COMMAND / CHIEF / HOD / department).

Live data (349 items, 1 tenant): **341 have barcodes, 341 have expiry dates, 340 have
custom fields** — but only **6 use multi-location stock** and **0 have `restock_enabled`**.
So the advanced fields exist but are barely exercised in practice.

Genuine strengths vs. the field:

- **Import/export** — Azure-PDF & spreadsheet import with automatic hierarchy detection,
  PDF & XLSX export. Sortly only does CSV.
- **Purchasing depth** — a real provisioning module (`supplier_profiles`, catalogue +
  price book, requisition→PO→receive). This is IDEA-tier and well beyond Sortly.
- **Yacht-native model** — departments, command/chief/HOD visibility tiers, `vessel_locations`
  with deck-plan coordinates, laundry & uniform item types, alcohol handling.
- **Bulk actions** — bulk delete/move by id, drag-and-drop reordering (dnd-kit).

---

## 2. The structural finding: three location models

There are **three coexisting ways an item's location is modelled**, and they are not unified:

1. **Active — materialized path strings.** `inventory_locations` rows plus `location` /
   `sub_location` strings on the item (path joined by `' > '`). This is what the nav renders.
   Renames/moves rewrite every descendant row with `LIKE 'path > %'` cascades. Despite the
   "4-level" page name, depth is actually unbounded.
2. **Legacy — denormalized `l1_id..l4_id` / `l1_name..l4_name`** columns on the item.
   Explicitly "kept for backward compat"; still read for category labels.
3. **Physical — `vessel_locations`** (a true adjacency-list tree via `parent_id`, with
   deck-plan `plan_x/plan_y/plan_shape`). Items reference it only softly via
   `default_location_id` and the `vesselLocationId` inside `stock_locations`.

No closure table; string-path + adjacency-list + legacy columns living side by side. This is
the single highest-leverage thing to rationalise — it's the root of the fragile multi-location
behaviour and the category ambiguity.

---

## 3. Gaps vs. table-stakes

| Area | State in Cargo | Note |
|---|---|---|
| **Stock movement / audit trail** | Ledger exists, not wired | `inventory_movements` is a proper append-only ledger, but **only the provisioning "receive delivery" flow writes to it**. Manual +/- edits, bulk moves and deletes overwrite quantity in place with **no ledger row** — so day-to-day stock changes have no history. |
| **Low-stock / par alerts** | Schema-only, dormant | Three overlapping columns (`par_level`, `reorder_point`, `restock_level`+`restock_enabled`); `restock_enabled = 0` on every live row. No notifications, no reorder surface. |
| **Expiry alerts** | Stored, not alerted | 341/349 items have `expiry_date` but nothing warns on approaching expiry — critical for provisions, medical and safety gear. |
| **Barcode scanning** | Column only | `barcode` is populated by import, but there's no scan-to-find / scan-to-count in the item UI. Sortly's phone-camera scan + label printing is its headline feature. |
| **Inventory valuation** | Fields, no roll-up | Cost fields exist; `value_method` defaults to `'unknown'`; no total-value report. Sortly ships this as a standard summary report. |
| **Multi-location stock** | Fragile | Denormalized jsonb the client normalizes across ~5 historical key spellings; only 6 items use it; no per-location ledger tie-in. |
| **Photos** | Single image | One `image_url`; Sortly allows up to 8 per item. |
| **Check-in / check-out** | Missing | No tool/equipment loan flow. |
| **Units of measure** | Free text | No UoM master / conversion entity. |

---

## 4. Competitor landscape (how to read it)

- **Sortly** — the real inventory benchmark. Mobile-first, best-in-class barcode/QR scanning +
  in-app label printing, 12 custom-field types, min-qty & date alerts, offline mobile,
  inventory-valuation reports. Weakness: everything is "folders" — no true locations,
  categories or purchasing; not yacht-aware.
- **IDEA Yacht** — the yacht-domain heavyweight (ISM/PMS suite). Equipment-linked spare parts,
  storages you move stock between with full traceability, ISM-grade audit trail, PO approval
  workflows into accounting, offline-first onboard. This is the bar for a serious yacht
  inventory. Cargo's provisioning module already reaches toward it.
- **Pinpoint Works** — **not an inventory system.** A work-list/project tool that pins tasks
  to the yacht's General Arrangement; "inventory" appears only as a calendar reminder type.
  Include it as adjacent inspiration (its GA-pinning is the aspirational version of our
  `vessel_locations` deck-plan), not as a stock competitor.

### Feature matrix

Legend: ● full · ◐ partial / present-but-unfinished · ○ none

| Feature | Cargo | Sortly | IDEA | Pinpoint |
|---|:--:|:--:|:--:|:--:|
| Rich item / quantity model | ● | ● | ● | ○ |
| Unified location hierarchy | ◐ | ◐ | ● | ◐ |
| Multi-location stock | ◐ | ◐ | ● | ○ |
| Categories (first-class) | ◐ | ◐ | ● | ◐ |
| Custom fields | ● | ● | ● | ● |
| Units of measure | ◐ | ● | ● | ○ |
| Item variants | ● | ● | ◐ | ○ |
| Barcode / QR scanning | ◐ | ● | ● | ○ |
| Label printing | ○ | ● | ● | ○ |
| Low-stock / reorder alerts | ◐ | ● | ● | ○ |
| Expiry / date alerts | ◐ | ● | ● | ◐ |
| Stock movement / audit history | ◐ | ● | ● | ◐ |
| Inventory valuation report | ○ | ● | ● | ○ |
| Photos on items | ◐ | ● | ● | ● |
| Check-in / check-out | ○ | ● | ◐ | ○ |
| Bulk actions | ● | ● | ● | ● |
| Import / export | ● | ◐ | ● | ◐ |
| Purchasing / PO workflow | ● | ◐ | ● | ◐ |
| Offline mobile | ○ | ● | ● | ◐ |
| Yacht-specific depth | ● | ○ | ● | ● |
| Location-on-deck-plan mapping | ◐ | ○ | ◐ | ● |

Where Cargo already leads Sortly: purchasing depth, import intelligence, yacht-native
governance, item richness. Where Sortly still leads Cargo: scanning + labels, alerting,
valuation, mobile/offline.

---

## 5. Recommended roadmap

**Now — finish what's already half-built (high value, low new surface):**

1. **Wire the movement ledger into every stock change.** Have `QuickQtyControl`,
   bulk-move, edit and delete write `inventory_movements` rows (reason: `adjusted` /
   `moved` / `removed`). This turns an existing table into a full audit trail — the single
   biggest credibility gap vs. IDEA.
2. **Activate low-stock + expiry alerts.** Collapse the three par columns to one
   (`restock_level` + `restock_enabled`), surface a "needs attention" view, and notify.
   The data is already there (341 expiry dates) — it just isn't watched.
3. **Inventory valuation roll-up.** Compute total value from `unit_cost × quantity` per
   folder/department; default `value_method` sensibly. Cheap, and a standard expectation.

**Next — parity features:**

4. **Barcode scan-to-find / scan-to-count** in the item UI (mobile camera), plus QR/label
   generation. This is Sortly's headline; we already store the barcodes.
5. **Rationalise the location model** — pick materialized-path or the `vessel_locations`
   adjacency tree as the single source of truth, migrate the legacy L1–L4 columns, and make
   multi-location stock normalized rows rather than jsonb.

**Later — differentiation:**

6. **Deck-plan stock mapping** — lean into `vessel_locations` plan coordinates so stock can
   be pinned to cabins/compartments (the Pinpoint GA idea, applied to inventory).
7. **Offline mobile** for at-sea counting.

---

_UI note: the 4-level inventory navigation page has been rebuilt on the editorial (Cargo)
design system in this change — cool `#F8FAFC` canvas, DM Serif headings, terracotta accent,
hairline cards, full-width layout, `dd/mm/yyyy` dates — replacing the boxed/beige theme-token
look._
