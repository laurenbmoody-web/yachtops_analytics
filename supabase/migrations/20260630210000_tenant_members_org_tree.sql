-- Free-form org chart for the crew-management Hierarchy view.
--   org_is_lead  — this member sits at the top level of their department (a peer
--                  of the senior-most, e.g. ETO alongside Chief Engineer).
--   reports_to   — the user_id this member reports to (their manager within the
--                  department). Null = default (reports to the senior lead).
-- Combined with the existing org_order for sibling ordering. Set by drag-and-drop
-- (COMMAND only, enforced in-app + existing tenant_members RLS).
alter table public.tenant_members
  add column if not exists org_is_lead boolean not null default false,
  add column if not exists reports_to uuid;
