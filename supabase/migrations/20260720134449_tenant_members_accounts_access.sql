-- Per-member capability: access the Accounts area.
-- COMMAND always has access; CHIEF only when this toggle is on; CREW never.
-- Mirrors the existing can_* capability flags on tenant_members
-- (can_view_crew_docs, can_edit_rota, can_order_without_approval, …).
alter table public.tenant_members
  add column if not exists can_access_accounts boolean not null default false;

comment on column public.tenant_members.can_access_accounts is
  'Grants a CHIEF-tier member access to the Accounts area. COMMAND always has access; CREW never. Default false.';
