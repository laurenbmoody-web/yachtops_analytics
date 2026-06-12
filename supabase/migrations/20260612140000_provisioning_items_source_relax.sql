-- provisioning_items.source — relax CHECK to include Quick-Add provenance
--
-- The original enum (20260325110000):
--   manual, guest_preference, low_stock, invoice_pattern,
--   smart_suggestion, location_aware
--
-- Quick Add apply paths (Past Orders, Favourites, Templates, Frequent
-- Items) added in Sprint 9c.4 currently OMIT the source column because
-- the natural provenance values for those flows ('history', 'template',
-- 'favourite') aren't in the enum — passing them would fail the CHECK.
-- Dropping the column on insert silently throws away provenance.
--
-- This migration extends the enum so the apply paths can write honest
-- source values. Down-stream queries gain "where did this item come
-- from?" answers for free.
--
-- New values added:
--   suggestion  — SmartSuggestionsPanel apply path (was using
--                 'smart_suggestion' which is semantically different;
--                 'suggestion' covers the panel's generic apply, the
--                 panel itself can opt into smart_suggestion when
--                 specifically that source is meant)
--   history     — Quick Add Past Orders apply
--   template    — Quick Add Templates apply (also covered by the
--                 wizard's "From past activity" → Boards tab)
--   favourite   — Quick Add Favourites apply / starred orders
--
-- Existing values retained verbatim. No backfill needed — existing rows
-- still satisfy the relaxed CHECK.

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
    'favourite'
  ));
