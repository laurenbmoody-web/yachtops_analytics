-- ─────────────────────────────────────────────────────────────────────────────
-- 20260522000001_set_template_default_times.sql
--
-- WHAT: Backfills indicative `start_time` and `end_time` on every
--       rota_shift_templates row whose body jsonb is missing them ("no
--       fixed hours" templates). After this migration every template
--       carries times; the UI removes the no-fixed-hours toggle in the
--       same pass.
--
-- WHY: As of 2026-05-22, "no fixed hours" is no longer a valid template
--       shape — every shift template carries indicative times (crew
--       adjust on the day). The seed migration
--       20260518000007_seed_default_templates.sql is updated in the same
--       commit so fresh applies don't recreate the old shape.
--
-- REPRESENTATION: there is no boolean column. "No fixed hours" was
--       expressed as a body jsonb without start_time/end_time keys. This
--       migration patches the keys onto those bodies in place.
--
-- DEFAULTS BY TYPE:
--   * shift_type='standby'   → 08:00 – 20:00   (covers e.g. On-call standby)
--   * shift_type='training'  → 09:00 – 17:00   (covers e.g. Training)
--   * any other no-times row → 09:00 – 17:00   (safe catch-all; report flagged
--                                               this for review — no seed row
--                                               falls into this bucket)
--
-- IDEMPOTENT: each UPDATE is guarded by `(body->>'start_time') IS NULL
--       OR (body->>'end_time') IS NULL`, so a second run patches nothing.
--       jsonb_build_object + `||` set the missing key without clobbering
--       any partial values that may already be present (COALESCE).
--
-- ROLLBACK: there is none — the previous "no fixed hours" shape is being
--       retired. If a specific row should genuinely have no times, edit
--       its body directly post-migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- Standby templates → 08:00–20:00
UPDATE public.rota_shift_templates
SET body = body || jsonb_build_object(
  'start_time', COALESCE(body->>'start_time', '08:00'),
  'end_time',   COALESCE(body->>'end_time',   '20:00')
)
WHERE (body->>'shift_type') = 'standby'
  AND ((body->>'start_time') IS NULL OR (body->>'end_time') IS NULL);

-- Training templates → 09:00–17:00
UPDATE public.rota_shift_templates
SET body = body || jsonb_build_object(
  'start_time', COALESCE(body->>'start_time', '09:00'),
  'end_time',   COALESCE(body->>'end_time',   '17:00')
)
WHERE (body->>'shift_type') = 'training'
  AND ((body->>'start_time') IS NULL OR (body->>'end_time') IS NULL);

-- Catch-all for any remaining type (user-created edge cases) → 09:00–17:00.
UPDATE public.rota_shift_templates
SET body = body || jsonb_build_object(
  'start_time', COALESCE(body->>'start_time', '09:00'),
  'end_time',   COALESCE(body->>'end_time',   '17:00')
)
WHERE ((body->>'start_time') IS NULL OR (body->>'end_time') IS NULL);
