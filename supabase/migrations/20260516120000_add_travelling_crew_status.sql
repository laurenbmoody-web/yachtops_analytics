-- Migration A: Add `travelling` crew status
-- Date: 2026-05-16
--
-- Adds the `travelling` value to the crew status vocabulary.
-- Semantics: a PAID WORK day where the crew member is travelling to or
-- from the vessel (off-vessel, but an active operational state — NOT a
-- leave state). UI colour family: teal/green.
--
-- crew_status_history.new_status / old_status are plain TEXT with NO
-- CHECK constraint or enum (see 20260417200000_crew_status_history.sql),
-- so there is NO schema change required to permit the new value — this
-- migration is documentation + a sanity notice only. The application
-- vocabulary lives in src/utils/crewStatus.js (CREW_STATUSES /
-- STATUS_CONFIG), which already includes `travelling` (teal).
--
-- No data backfill: `travelling` is a forward-only status applied via
-- the normal status-change flow.

DO $$
BEGIN
  RAISE NOTICE 'crew status vocabulary: ''travelling'' is permitted (TEXT column, no constraint). No DDL applied.';
END $$;
