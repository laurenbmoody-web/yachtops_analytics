-- Sprint 9c.1a — provisioning_lists.board_type
--
-- Adds the structural classifier for a board: charter / owner trip / yard
-- period / etc. The codebase has been writing to a `board_type` field on
-- insert (provisioning/index.jsx; provisioning-management-dashboard) for a
-- while but the column never existed — those writes were silently dropped.
-- This migration adds the column, applies a CHECK constraint matching the
-- canonical enum, defaults to 'other', and best-effort backfills existing
-- rows from their titles.
--
-- Display labels are NOT stored; consumers derive them at render time:
--   charter      → "charter"
--   owner_trip   → "owner trip"
--   yard_period  → "yard period"
--   crossing     → "crossing"
--   crew_change  → "crew change"
--   shipyard     → "shipyard"
--   standby      → "standby"
--   other        → "list"
--
-- Sprint 9c.1 Commit 3 will use this column for the editorial headline
-- qualifier (e.g. "Smiths, *charter*."). Filtering/grouping is deferred.

ALTER TABLE public.provisioning_lists
  ADD COLUMN IF NOT EXISTS board_type text
    CHECK (board_type IN (
      'charter',
      'owner_trip',
      'yard_period',
      'crossing',
      'crew_change',
      'shipyard',
      'standby',
      'other'
    ))
    DEFAULT 'other';

-- Best-effort backfill from existing titles. Order matters — first match
-- wins, so charter beats charter-and-owner edge cases. Titles aren't
-- stripped of the matched word — users can tidy via Edit Board.
UPDATE public.provisioning_lists
   SET board_type = 'charter'
 WHERE board_type IS NULL
   AND title ~* 'charter';

UPDATE public.provisioning_lists
   SET board_type = 'owner_trip'
 WHERE board_type IS NULL
   AND title ~* 'owner';

UPDATE public.provisioning_lists
   SET board_type = 'yard_period'
 WHERE board_type IS NULL
   AND title ~* 'yard';

UPDATE public.provisioning_lists
   SET board_type = 'crossing'
 WHERE board_type IS NULL
   AND title ~* '(crossing|delivery|passage)';

UPDATE public.provisioning_lists
   SET board_type = 'crew_change'
 WHERE board_type IS NULL
   AND title ~* '(crew change|crew swap)';

-- Anything left untyped picks up the column default.
UPDATE public.provisioning_lists
   SET board_type = 'other'
 WHERE board_type IS NULL;

CREATE INDEX IF NOT EXISTS provisioning_lists_board_type_idx
  ON public.provisioning_lists(board_type);

COMMENT ON COLUMN public.provisioning_lists.board_type IS
  'Structural classifier for the board (charter, owner_trip, yard_period, crossing, crew_change, shipyard, standby, other). Used by the editorial headline qualifier and the template picker. Display labels derived at render — values stored as snake_case.';
