-- Per-edit change log: each 'edited' event records which fields changed and
-- their before/after values, so history reads "Size 2-3yrs → 3-4yrs" instead of
-- a bare "Details updated". Stored as an array of {field, from, to} objects.
alter table public.laundry_item_events
  add column if not exists changes jsonb not null default '[]'::jsonb;
