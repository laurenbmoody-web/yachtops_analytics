-- ─────────────────────────────────────────────────────────────────────────────
-- 20260523000001_widen_rota_approval_events_event_type.sql
--
-- WHAT: Widens public.rota_approval_events.event_type CHECK to also allow
--       'mlc_override' and 'circadian_acknowledged'. These are written by
--       the apply-template flow when an actor proceeds past an MLC breach
--       (mandatory reason captured in `note`, affected shift ids and rule
--       breaches in `context`) or acknowledges a soft circadian flag.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS, then re-add with the widened set.
--             Safe to re-run; safe to apply on an environment that already
--             has the widened constraint.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.rota_approval_events
  DROP CONSTRAINT IF EXISTS rota_approval_events_event_type_check;

ALTER TABLE public.rota_approval_events
  ADD CONSTRAINT rota_approval_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'submitted'::text,
    'approved'::text,
    'rejected'::text,
    'published_direct'::text,
    'mlc_override'::text,
    'circadian_acknowledged'::text
  ]));
