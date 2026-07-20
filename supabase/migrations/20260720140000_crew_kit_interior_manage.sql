-- ─────────────────────────────────────────────────────────────────────────────
-- 20260720140000_crew_kit_interior_manage.sql
--
-- WHAT: Broaden who can issue/manage crew kit. The interior runs uniform from
--       the wardrobe-management "Crew" folder, but they aren't necessarily
--       COMMAND — and crucially they should manage kit WITHOUT crew-profile
--       access. So management (issue / edit / delete / return) is opened to:
--         • any COMMAND-tier member (unchanged), OR
--         • any member of the Interior department
--       …who shares an active tenant with the crew member the kit belongs to.
--
--       The crew member's own SELECT + ack UPDATE policies are untouched (they
--       still only see/acknowledge their own kit). Departments are global, so
--       matching by name = 'Interior' works across tenants.
--
-- IDEMPOTENCY: DROP POLICY IF EXISTS + CREATE POLICY.
-- ─────────────────────────────────────────────────────────────────────────────

-- Replaces the COMMAND-only management policy with a COMMAND-or-Interior one.
drop policy if exists crew_kit_command_all on public.crew_issued_kit;
drop policy if exists crew_kit_manage on public.crew_issued_kit;

create policy crew_kit_manage
  on public.crew_issued_kit for all
  using (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      left join public.departments d on d.id = viewer.department_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and subject.user_id = crew_issued_kit.user_id
        and (viewer.permission_tier = 'COMMAND' or d.name = 'Interior')
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      left join public.departments d on d.id = viewer.department_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and subject.user_id = crew_issued_kit.user_id
        and (viewer.permission_tier = 'COMMAND' or d.name = 'Interior')
    )
  );
