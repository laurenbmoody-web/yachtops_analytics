-- Contractor induction: capture why a visitor is aboard and that they've had the
-- safety briefing, on each visit record.
alter table public.contractor_visits
  add column if not exists reason text,
  add column if not exists inducted boolean not null default false,
  add column if not exists inducted_at timestamptz;
