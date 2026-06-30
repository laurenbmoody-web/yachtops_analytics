-- Manual hierarchy ordering for the crew-management org chart. A per-member
-- sort index within their department; null falls back to role seniority. Set by
-- drag-and-drop on the Hierarchy view (COMMAND only, enforced in the app +
-- existing tenant_members RLS).
alter table public.tenant_members
  add column if not exists org_order integer;
