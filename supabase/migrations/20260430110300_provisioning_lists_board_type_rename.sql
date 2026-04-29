-- Sprint 9c.1a.1 — provisioning_lists.board_type enum rename
--
-- Corrective follow-up to 9c.1a. The original enum was over-engineered
-- with 8 values and snake_case compounds (owner_trip, yard_period,
-- crew_change). This migration simplifies to a 7-value set with single-
-- word values that double as their display labels:
--
--   Old value      → New value
--   charter           charter      (no change)
--   owner_trip        owner
--   yard_period       yard
--   shipyard          yard         (merged — yard period and shipyard are the same concept)
--   crew_change       crew
--   crossing          crossing     (no change)
--   standby           standby      (no change)
--   other             general
--
-- DEFAULT updated from 'other' → 'general'. CHECK constraint dropped and
-- recreated with the new 7-value set. Rows backfilled in the same
-- migration so the new constraint can be added cleanly.

ALTER TABLE public.provisioning_lists
  DROP CONSTRAINT IF EXISTS provisioning_lists_board_type_check;

UPDATE public.provisioning_lists
   SET board_type = CASE board_type
     WHEN 'owner_trip'  THEN 'owner'
     WHEN 'yard_period' THEN 'yard'
     WHEN 'shipyard'    THEN 'yard'
     WHEN 'crew_change' THEN 'crew'
     WHEN 'other'       THEN 'general'
     ELSE board_type
   END;

-- Anything outside the new set (shouldn't happen, but defence-in-depth)
-- gets pulled back to 'general' so the new CHECK can be added.
UPDATE public.provisioning_lists
   SET board_type = 'general'
 WHERE board_type IS NULL
    OR board_type NOT IN ('charter','owner','yard','crossing','crew','standby','general');

ALTER TABLE public.provisioning_lists
  ALTER COLUMN board_type SET DEFAULT 'general';

ALTER TABLE public.provisioning_lists
  ADD CONSTRAINT provisioning_lists_board_type_check
    CHECK (board_type IN (
      'charter',
      'owner',
      'yard',
      'crossing',
      'crew',
      'standby',
      'general'
    ));

COMMENT ON COLUMN public.provisioning_lists.board_type IS
  'Structural classifier for the board (charter, owner, yard, crossing, crew, standby, general). Used by the editorial headline qualifier and the template picker. Display labels match values (capitalised at render).';
