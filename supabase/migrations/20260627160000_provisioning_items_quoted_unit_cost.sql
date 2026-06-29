-- ─────────────────────────────────────────────────────────────────────────────
-- 20260627160000_provisioning_items_quoted_unit_cost.sql
--
-- Data richness for manual supplier quotes: keep the supplier's quoted
-- price SEPARATE from the chief's original estimate, so variance
-- (estimate → quote) is preserved instead of being overwritten.
--
-- Before this, applyQuotedPrices wrote the AI-extracted quote price
-- straight into estimated_unit_cost, clobbering the estimate. Now:
--
--   estimated_unit_cost  — the chief's pre-quote estimate (unchanged).
--   quoted_unit_cost     — the supplier's quoted unit price (manual
--                          quote flow). NULL until a quote is applied.
--
-- The effective cost the board / totals / KPIs use becomes
--   supplier-confirmed price  ??  quoted_unit_cost  ??  estimated_unit_cost
-- so the quote drives the money while the estimate stays on the row for
-- comparison. Vessel-side only — never mirrored to supplier_order_items
-- (the supplier never sees the vessel's costing), same as
-- estimated_unit_cost.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_items
  ADD COLUMN IF NOT EXISTS quoted_unit_cost numeric(10,2);

COMMENT ON COLUMN public.provisioning_items.quoted_unit_cost IS
  'Supplier-quoted unit price from a manually-uploaded quote (AI-
   extracted, chief-reviewed). Kept separate from estimated_unit_cost
   so estimate→quote variance survives. Effective cost preference:
   supplier-confirmed price > quoted_unit_cost > estimated_unit_cost.';
