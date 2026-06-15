-- Close the anon read/write hole on four tables that had RLS disabled.
-- Policies preserve current authenticated in-app behaviour (tenant-scoped).
-- (No public share-link consumer exists, so authenticated-only is safe.)

-- ── job_notes (tenant-scoped notes on team jobs) ──────────────────────
alter table public.job_notes enable row level security;

drop policy if exists job_notes_select on public.job_notes;
create policy job_notes_select on public.job_notes for select
  using (exists (select 1 from public.tenant_members tm
    where tm.tenant_id = job_notes.tenant_id and tm.user_id = auth.uid() and tm.active));

drop policy if exists job_notes_insert on public.job_notes;
create policy job_notes_insert on public.job_notes for insert
  with check (created_by = auth.uid() and exists (select 1 from public.tenant_members tm
    where tm.tenant_id = job_notes.tenant_id and tm.user_id = auth.uid() and tm.active));

drop policy if exists job_notes_update on public.job_notes;
create policy job_notes_update on public.job_notes for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists job_notes_delete on public.job_notes;
create policy job_notes_delete on public.job_notes for delete
  using (created_by = auth.uid() or exists (select 1 from public.tenant_members tm
    where tm.tenant_id = job_notes.tenant_id and tm.user_id = auth.uid() and tm.active
      and tm.permission_tier = 'COMMAND'));

-- ── tenant_custom_roles (per-tenant custom roles) ─────────────────────
alter table public.tenant_custom_roles enable row level security;

drop policy if exists tenant_custom_roles_all on public.tenant_custom_roles;
create policy tenant_custom_roles_all on public.tenant_custom_roles for all
  using (exists (select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_custom_roles.tenant_id and tm.user_id = auth.uid() and tm.active))
  with check (exists (select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_custom_roles.tenant_id and tm.user_id = auth.uid() and tm.active));

-- ── provisioning_list_shares (share links; scoped via the list's tenant) ──
alter table public.provisioning_list_shares enable row level security;

drop policy if exists provisioning_list_shares_all on public.provisioning_list_shares;
create policy provisioning_list_shares_all on public.provisioning_list_shares for all
  using (exists (select 1 from public.provisioning_lists l
    join public.tenant_members tm on tm.tenant_id = l.tenant_id
    where l.id = provisioning_list_shares.list_id and tm.user_id = auth.uid() and tm.active))
  with check (exists (select 1 from public.provisioning_lists l
    join public.tenant_members tm on tm.tenant_id = l.tenant_id
    where l.id = provisioning_list_shares.list_id and tm.user_id = auth.uid() and tm.active));

-- ── provisioning_list_collaborators (board collaborators) ─────────────
alter table public.provisioning_list_collaborators enable row level security;

drop policy if exists provisioning_list_collaborators_select on public.provisioning_list_collaborators;
create policy provisioning_list_collaborators_select on public.provisioning_list_collaborators for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.provisioning_lists l
      join public.tenant_members tm on tm.tenant_id = l.tenant_id
      where l.id = provisioning_list_collaborators.list_id and tm.user_id = auth.uid() and tm.active)
  );

drop policy if exists provisioning_list_collaborators_write on public.provisioning_list_collaborators;
create policy provisioning_list_collaborators_write on public.provisioning_list_collaborators for all
  using (exists (select 1 from public.provisioning_lists l
    join public.tenant_members tm on tm.tenant_id = l.tenant_id
    where l.id = provisioning_list_collaborators.list_id and tm.user_id = auth.uid() and tm.active))
  with check (exists (select 1 from public.provisioning_lists l
    join public.tenant_members tm on tm.tenant_id = l.tenant_id
    where l.id = provisioning_list_collaborators.list_id and tm.user_id = auth.uid() and tm.active));
