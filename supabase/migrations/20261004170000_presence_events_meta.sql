-- Carry extra context on a presence event — for a visitor, their company and
-- phone, and whether a departure was temporary (stepped out) or permanent — so
-- the history reads fully without a join.
alter table public.presence_events
  add column if not exists meta jsonb not null default '{}'::jsonb;
