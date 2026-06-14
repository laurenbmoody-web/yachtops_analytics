-- provisioning_items.source — extend CHECK enum for in-board Add-from picker
--
-- The current enum (last relaxed in 20260612140000):
--   manual, guest_preference, low_stock, invoice_pattern,
--   smart_suggestion, location_aware, suggestion, history,
--   template, favourite
--
-- The in-board "Add from…" modal added in Sprint 9c.5 surfaces three
-- more suggestion sources (Occasions, Expiring soon, Master history)
-- and a new Catalogue browser, all of which need their source values
-- to write cleanly. Without this extension the in-board apply path
-- fails with "violates check constraint" the first time the user
-- picks an Occasion or a Catalogue item.
--
-- New values added:
--   occasions       — guest birthday / anniversary suggestions inside
--                     the trip window (or ±7d either side)
--   expiring_soon   — inventory_items where expiry_date lands within
--                     the trip window
--   master_history  — aggregated items ordered ≥3× historically
--                     (renamed from the older 'history' bucket which
--                     stays in the enum for past-order item provenance)
--   catalogue       — items added from the Cargo Provisions catalogue
--                     (src/data/catalogue.js)
--
-- Existing values retained verbatim. No backfill — existing rows still
-- satisfy the relaxed CHECK.

ALTER TABLE public.provisioning_items
  DROP CONSTRAINT IF EXISTS provisioning_items_source_check;

ALTER TABLE public.provisioning_items
  ADD CONSTRAINT provisioning_items_source_check
  CHECK (source IS NULL OR source IN (
    'manual',
    'guest_preference',
    'low_stock',
    'invoice_pattern',
    'smart_suggestion',
    'location_aware',
    'suggestion',
    'history',
    'template',
    'favourite',
    'occasions',
    'expiring_soon',
    'master_history',
    'catalogue'
  ));
