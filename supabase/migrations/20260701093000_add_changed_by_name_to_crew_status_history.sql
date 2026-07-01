-- The trg_crew_status_initial trigger (fires when a tenant_members row is first
-- created, e.g. on invite acceptance) inserts into crew_status_history including
-- a changed_by_name column that was never added to the table — so every crew
-- join failed with 'column "changed_by_name" ... does not exist'.
--
-- Add the column (nullable text) so the trigger's insert succeeds. It stores the
-- display name of whoever triggered the status change, for history readouts.
alter table public.crew_status_history add column if not exists changed_by_name text;
