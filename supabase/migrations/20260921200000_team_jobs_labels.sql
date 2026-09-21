-- Labels that survive a refresh.
--
-- The job detail has had a Labels section for a long time. It wrote to
-- editedLabels in React state and sent `labels` up with the save — to a table
-- with no labels column, so PostgREST dropped it and the next load came back
-- empty. The section also only offered its "Add a label" field inside edit
-- mode, so from the detail drawer it read "No labels." with no way to add one.
--
-- text[] rather than a join table: a label here is a free word someone types
-- on a job, not an entity with its own life, and GIN makes "every job tagged
-- deep clean" a single index scan when that view is wanted.
alter table public.team_jobs add column if not exists labels text[] not null default '{}';

create index if not exists team_jobs_labels_idx on public.team_jobs using gin (labels);
