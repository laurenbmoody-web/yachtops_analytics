-- Free-position org chart: org_row is a vertical "level" (any integer, gaps
-- allowed), org_order (existing) is the horizontal position within that row.
-- Both nullable — unset falls back to a role-seniority default. Set purely by
-- dragging on the Hierarchy view (COMMAND only).
alter table public.tenant_members
  add column if not exists org_row integer;
