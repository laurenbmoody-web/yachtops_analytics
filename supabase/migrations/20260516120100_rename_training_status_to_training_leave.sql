-- Migration B: Rename crew status `training` -> `training_leave`
-- Date: 2026-05-16
--
-- Disambiguates the crew_status_history status `training` (a multi-day
-- OFF-VESSEL leave-type state — crew away on a training course) from the
-- rota_shifts.shift_type `training` (a single-day ON-VESSEL learning
-- shift, which counts as on-duty). The shift_type is unchanged; only the
-- crew STATUS value is renamed.
--
-- crew_status_history.{new,old}_status are plain TEXT (no CHECK / enum),
-- so this is a pure data rename — idempotent via the WHERE clauses.
--
-- The initial-status trigger (log_crew_status_initial) inserts
-- COALESCE(NEW.status, 'active') from tenant_members.status and contains
-- no literal 'training' reference, so no trigger change is required.

UPDATE public.crew_status_history
  SET new_status = 'training_leave'
  WHERE new_status = 'training';

UPDATE public.crew_status_history
  SET old_status = 'training_leave'
  WHERE old_status = 'training';

-- tenant_members.status may also carry 'training' for crew currently in
-- that state; align it so the live status matches the history vocabulary.
UPDATE public.tenant_members
  SET status = 'training_leave'
  WHERE status = 'training';
