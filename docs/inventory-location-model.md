# Inventory location model — the canonical guide

**Read this before building anything that touches inventory, provisioning, pantry mode,
or the vessel map.** There are historically three location models in the code; only one
organises inventory. This doc says which, and marks the rest as off-limits.

---

## The one model that organises inventory: folder paths

Inventory is a **free-form, infinitely-nested folder tree**, entirely user-defined
(same idea as Sortly). Departments at the top, then folders inside folders, as deep as
the user wants.

It's stored as **materialized path strings**, not IDs:

- Folders are rows in **`inventory_locations`**:
  - `location` = the root/department name (e.g. `Interior`)
  - `sub_location` = `NULL` for a root, else the rest of the path joined by `' > '`
    (e.g. `Guest > Cabins > Cold Storage`)
- An **item** (`inventory_items`) is placed in a folder by carrying the **same two
  strings**: `location` + `sub_location`. There is no folder-id foreign key.
- The nested tree the UI shows is rebuilt in JS by splitting `sub_location` on `' > '`
  (`inventoryStorage.js → getFolderTree`).
- Moving/renaming a folder rewrites every descendant row via a `LIKE '<path> > %'`
  cascade on both tables.

**If you need "where does this item live?", read `location` + `sub_location`.** That's it.

> The page is historically called *4-level* / *enhanced-4-level-inventory-navigation*.
> Ignore the "4" — depth is unbounded. It's just an old name.

---

## Everything else references THAT model

| Surface | How it links | Uses the folder path? |
|---|---|---|
| **Provisioning** | `provisioning_items.inventory_item_id` → `inventory_items.id` (real FK). When a provisioning line is pushed to stock it writes `location` = department, `sub_location` = `Cat > SubCat > …` (`ItemDrawer.jsx`). | ✅ Yes — same path model |
| **Pantry mode** (`src/pages/pantry/*`) | Reads the same `inventory_items` rows. | ✅ Yes |
| **Receive delivery** | Matches/links to `inventory_items` by id and writes `inventory_movements`. | ✅ Yes |

So the whole system already flows through one model. Keep it that way: **new inventory
links should join on `inventory_items.id` and/or read the folder path** — never invent a
parallel structure.

---

## ⚠️ Do NOT build on these (deprecated / not-for-inventory-org)

**1. Legacy `l1..l4` taxonomy** — `l1_id..l4_id` / `l1_name..l4_name` columns on
`inventory_items`, plus `taxonomyStorage.js`.
- Status: **DEPRECATED, semi-alive.** Its *only* remaining visible job is drawing the
  small category label on item cards (`l3Name || l2Name || l1Name`).
- Rule: **do not read or write l1..l4 in new code.** When we retire it, the category
  label moves to being derived from the folder path, then the columns get dropped in one
  migration. Until then it's write-through dead weight — marked `DEPRECATED` in
  `inventoryStorage.js` and `taxonomyStorage.js`.

**2. `vessel_locations`** — this one is **NOT deprecated**, but it is a *different thing*.
- It's the **physical vessel/deck-plan tree** (a proper adjacency list via `parent_id`,
  with deck-plan coordinates). It powers the GA / vessel map, not the inventory folders.
- Inventory only touches it softly (`inventory_items.default_location_id`, and
  `vesselLocationId` inside the `stock_locations` jsonb).
- Rule: use it for **physical/where-on-the-boat** questions and map pinning. Use the
  **folder path** for **how the user organised their stock**. They are deliberately
  separate today; tightening the link between them is a future project, not an assumption
  to build on now.

---

## One-line summary for each question

- *"How is this item organised / what folder is it in?"* → `location` + `sub_location` (folder path).
- *"How do provisions / pantry find an item?"* → `inventory_item_id` FK to `inventory_items.id`.
- *"Where is it physically on the yacht / on the map?"* → `vessel_locations` (separate tree).
- *"What about l1..l4?"* → **Deprecated. Don't touch it in new work.**
