-- team_jobs was missing two columns the app has always written.
--
-- Every insert the Jobs page builds carries `priority` (quick add and Create
-- job both set it, and the job card reads it back) and `board_id` (which board
-- column the job belongs to; fetchJobsFromSupabase maps it straight to
-- card.board). Neither column existed, and PostgREST rejects an insert naming
-- an unknown column outright — so no job created through the UI has ever
-- reached the database. The optimistic card stayed in localStorage, the insert
-- failed, and the job vanished on the next device or the next clear of site
-- data. Adding the columns is what makes a created job real.
--
-- Nullable with no default: a job with no priority set and no board is the
-- normal case, and that is exactly what the UI sends today.

alter table public.team_jobs
  add column if not exists priority text,
  add column if not exists board_id uuid;

-- Jobs are read per board on every render of the boards row.
create index if not exists team_jobs_board_idx
  on public.team_jobs (tenant_id, board_id)
  where board_id is not null;
