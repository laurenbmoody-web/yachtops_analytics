-- One-time backfill: rebuild guests.allergies, guests.health_conditions, and
-- guests.preferences_summary from the current set of guest_preferences rows.
--
-- The preferences page has been a write-only island: every category of
-- preference row was landing in guest_preferences but nothing was propagating
-- back to the structured columns that downstream widgets read (standby
-- AllergiesWidget reads guests.allergies directly; drawer's At-a-glance
-- reads guests.preferences_summary). Going forward, the preferencesStorage
-- mutation hooks handle this automatically. This migration fixes up the data
-- already in the system so existing guests aren't broken until someone edits
-- them by hand.
--
-- Column mapping (must match syncPreferencesForGuest in src/utils/preferencesSync.js):
--   'Allergies', key != 'Health Conditions'  -> guests.allergies           (comma-joined values)
--   'Allergies', key = 'Health Conditions'   -> guests.health_conditions   (comma-joined values)
--   any other category                       -> guests.preferences_summary (key: value sentences joined by ". ")
--
-- Each UPDATE only writes when the computed value is actually different from
-- the current column, so running this twice is a no-op the second time.
-- A single history_log entry per changed guest records the backfill with
-- actorUserId=null, so the audit trail shows what the migration did.

-- ── Allergies column ─────────────────────────────────────────────────────────
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
      'id',          'backfill-' || g.id::text || '-allergies-' || extract(epoch from now())::bigint::text,
      'at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action',      'allergies_changed',
      'actorUserId', null,
      'changes',     jsonb_build_object(
        'allergies', jsonb_build_object(
          'from', CASE WHEN COALESCE(g.allergies, '') = '' THEN null ELSE g.allergies END,
          'to',   CASE WHEN COALESCE(computed.next_val, '') = '' THEN null ELSE computed.next_val END
        ),
        'source', 'backfill_migration'
      )
    ))
FROM computed
WHERE g.id = computed.guest_id
  AND COALESCE(g.allergies, '') IS DISTINCT FROM COALESCE(computed.next_val, '');

-- ── Health conditions column ─────────────────────────────────────────────────
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
      'id',          'backfill-' || g.id::text || '-health-' || extract(epoch from now())::bigint::text,
      'at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action',      'health_conditions_changed',
      'actorUserId', null,
      'changes',     jsonb_build_object(
        'health_conditions', jsonb_build_object(
          'from', CASE WHEN COALESCE(g.health_conditions, '') = '' THEN null ELSE g.health_conditions END,
          'to',   CASE WHEN COALESCE(computed.next_val, '') = '' THEN null ELSE computed.next_val END
        ),
        'source', 'backfill_migration'
      )
    ))
FROM computed
WHERE g.id = computed.guest_id
  AND COALESCE(g.health_conditions, '') IS DISTINCT FROM COALESCE(computed.next_val, '');

-- ── Preferences summary column (all non-Allergies categories) ────────────────
-- Aggregation mirrors buildPreferencesSummary in preferencesSync.js:
--   fragment = "key: value"  when key non-empty
--   fragment = "value"       otherwise
-- joined with ". " and terminated with "." if not already.
WITH computed AS (
  SELECT gp.guest_id,
         string_agg(
           CASE
             WHEN trim(COALESCE(gp.key, '')) <> ''
               THEN trim(gp.key) || ': ' || trim(gp.value)
             ELSE trim(gp.value)
           END,
           '. ' ORDER BY gp.category, gp.created_at
         ) FILTER (WHERE trim(COALESCE(gp.value, '')) <> '') AS raw_summary
  FROM public.guest_preferences gp
  WHERE gp.category <> 'Allergies'
  GROUP BY gp.guest_id
),
normalised AS (
  SELECT guest_id,
         CASE
           WHEN raw_summary IS NULL OR raw_summary = '' THEN ''
           WHEN raw_summary ~ '[.!?]$' THEN raw_summary
           ELSE raw_summary || '.'
         END AS next_val
  FROM computed
)
UPDATE public.guests g
SET preferences_summary = normalised.next_val,
    history_log = COALESCE(g.history_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id',          'backfill-' || g.id::text || '-summary-' || extract(epoch from now())::bigint::text,
      'at',          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action',      'preferences_changed',
      'actorUserId', null,
      'changes',     jsonb_build_object(
        'preferences_summary', jsonb_build_object(
          'from', CASE WHEN COALESCE(g.preferences_summary, '') = '' THEN null ELSE g.preferences_summary END,
          'to',   CASE WHEN normalised.next_val = '' THEN null ELSE normalised.next_val END
        ),
        'source', 'backfill_migration'
      )
    ))
FROM normalised
WHERE g.id = normalised.guest_id
  AND COALESCE(g.preferences_summary, '') IS DISTINCT FROM normalised.next_val;
