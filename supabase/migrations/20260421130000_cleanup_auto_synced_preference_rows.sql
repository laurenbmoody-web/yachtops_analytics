-- Cleanup: remove the synthetic aggregate "auto-synced" preference rows that
-- the legacy forward-sync effect on the preferences page was inserting, and
-- re-compute the structured guests.* columns so any pollution introduced by
-- those rows is repaired.
--
-- Background. Until this sprint, guest-preference-profile/index.jsx had a
-- useEffect that read guests.allergies / guests.health_conditions and wrote
-- a single aggregate preference row back into guest_preferences with
-- source='guest_profile' and tags=['auto-synced']. Once the reverse sync
-- (preferencesSync.js) started maintaining the structured column from the
-- individual preference rows, the forward sync began feeding off its own
-- output: on every page load it saw the now-populated column and re-inserted
-- the aggregate row. On the next mutation, the reverse sync re-aggregated
-- across both the individuals AND the aggregate, compounding values
-- (e.g. "Peanuts, Shellfish" became "Peanuts, Shellfish, Peanuts, Shellfish").
--
-- The forward sync has been removed in code. This migration cleans the data.
--
-- Scope: only guests with remaining non-Allergies-source pref rows are
-- re-aggregated. Legacy guests whose allergies live only in guests.allergies
-- (from AddGuestModal, never as individual prefs) are untouched — the
-- forward-sync phantom row is deleted but their legitimate column data is
-- preserved. A separate migration can later seed individual pref rows from
-- those column-only guests when we decide the right UX for that gap.

-- ── Step 1 · Delete the synthetic aggregate rows ─────────────────────────────
-- Narrow predicate: only the pattern the legacy forward-sync produced.
DELETE FROM public.guest_preferences
WHERE category = 'Allergies'
  AND source   = 'guest_profile';

-- ── Step 2 · Re-aggregate guests.allergies from the remaining clean rows ─────
-- INNER JOIN via `FROM computed` — only touches guests that still have
-- individual non-health Allergies prefs. Column-only legacy data is preserved.
WITH computed AS (
  SELECT gp.guest_id,
         string_agg(trim(gp.value), ', ' ORDER BY gp.created_at)
           FILTER (WHERE trim(COALESCE(gp.value, '')) <> '') AS next_val
  FROM public.guest_preferences gp
  WHERE gp.category = 'Allergies'
    AND gp.key <> 'Health Conditions'
  GROUP BY gp.guest_id
)
UPDATE public.guests g
SET allergies = COALESCE(computed.next_val, ''),
    history_log = COALESCE(g.history_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id',          'cleanup-' || g.id::text || '-allergies-' || extract(epoch from now())::bigint::text,
      'at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action',      'allergies_changed',
      'actorUserId', null,
      'changes',     jsonb_build_object(
        'allergies', jsonb_build_object(
          'from', CASE WHEN COALESCE(g.allergies, '') = '' THEN null ELSE g.allergies END,
          'to',   CASE WHEN COALESCE(computed.next_val, '') = '' THEN null ELSE computed.next_val END
        ),
        'source', 'cleanup_auto_synced_rows'
      )
    ))
FROM computed
WHERE g.id = computed.guest_id
  AND COALESCE(g.allergies, '') IS DISTINCT FROM COALESCE(computed.next_val, '');

-- ── Step 3 · Re-aggregate guests.health_conditions ───────────────────────────
WITH computed AS (
  SELECT gp.guest_id,
         string_agg(trim(gp.value), ', ' ORDER BY gp.created_at)
           FILTER (WHERE trim(COALESCE(gp.value, '')) <> '') AS next_val
  FROM public.guest_preferences gp
  WHERE gp.category = 'Allergies'
    AND gp.key = 'Health Conditions'
  GROUP BY gp.guest_id
)
UPDATE public.guests g
SET health_conditions = COALESCE(computed.next_val, ''),
    history_log = COALESCE(g.history_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id',          'cleanup-' || g.id::text || '-health-' || extract(epoch from now())::bigint::text,
      'at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action',      'health_conditions_changed',
      'actorUserId', null,
      'changes',     jsonb_build_object(
        'health_conditions', jsonb_build_object(
          'from', CASE WHEN COALESCE(g.health_conditions, '') = '' THEN null ELSE g.health_conditions END,
          'to',   CASE WHEN COALESCE(computed.next_val, '') = '' THEN null ELSE computed.next_val END
        ),
        'source', 'cleanup_auto_synced_rows'
      )
    ))
FROM computed
WHERE g.id = computed.guest_id
  AND COALESCE(g.health_conditions, '') IS DISTINCT FROM COALESCE(computed.next_val, '');
