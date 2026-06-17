-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617132100_provisioning_items_drop_bar_pseudo_dept.sql
--
-- "Bar" was never really a department — it crept into the model via a
-- catalogue group→department auto-assignment that wrote
-- `provisioning_items.department = 'Bar'` whenever someone added a
-- drinks item. Real departments correspond to vessel teams (Galley,
-- Interior, Deck, Bridge, …); `Bar` is just a catalogue browsing tab.
--
-- This migration:
--   1. Backfills every item that's currently `department = 'Bar'` to
--      the parent list's primary department (lists.department[1]).
--      Falls back to 'Galley' when the parent list has no
--      department array set (shouldn't happen on real boards but
--      handles legacy test data cleanly).
--   2. Deletes the Bar row from public.departments that the previous
--      repalette migration mistakenly seeded.
--
-- Idempotent: UPDATE is filtered to rows still on 'Bar'; DELETE only
-- fires if the row exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Backfill items
UPDATE public.provisioning_items pi
   SET department = COALESCE(
         NULLIF(btrim(pl.department[1]), ''),
         'Galley'
       )
  FROM public.provisioning_lists pl
 WHERE pi.list_id = pl.id
   AND pi.department = 'Bar';

-- 2. Drop the pseudo-department
DELETE FROM public.departments WHERE lower(name) = 'bar';
