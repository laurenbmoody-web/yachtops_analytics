-- Audit trail for high-risk payroll data: who last edited / viewed banking.
alter table public.crew_banking
  add column if not exists last_edited_by      uuid,
  add column if not exists last_edited_by_name text,
  add column if not exists last_viewed_by      uuid,
  add column if not exists last_viewed_by_name text,
  add column if not exists last_viewed_at      timestamptz;
