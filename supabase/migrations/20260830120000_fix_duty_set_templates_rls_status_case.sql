-- Fix: duty_set_templates was unreadable and unwritable by every user.
--
-- All four policies on the table gated on `tenant_members.status = 'ACTIVE'`
-- (uppercase), but that column only ever holds lowercase 'active' (or
-- 'rotational_leave'). The comparison could never be true, so the policies
-- matched no rows for anyone: duty set templates could be inserted by a
-- service-role caller but never listed, edited or deleted from the app. The
-- Rotation page showed "0 templates" and the assign-duty-set modal showed
-- "No templates yet" even when rows existed.
--
-- duty_set_templates is the only table where this typo is fatal. The same
-- predicate appears on rotation_assignments, tenants and profiles, but each of
-- those has a working sibling policy (policies are OR'd), so they behave.
-- Those are left alone here; this migration fixes only the broken table.
--
-- The comparison is made case-insensitive rather than switched to lowercase so
-- the policies keep working whichever case a future write uses. Membership
-- rules are otherwise unchanged: read for any active member of the tenant,
-- write for COMMAND / CHIEF / HOD. 'rotational_leave' members remain excluded.

drop policy if exists duty_set_templates_select on public.duty_set_templates;
create policy duty_set_templates_select on public.duty_set_templates
  for select using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.active = true
        and upper(tm.status) = 'ACTIVE'
    )
  );

drop policy if exists duty_set_templates_insert on public.duty_set_templates;
create policy duty_set_templates_insert on public.duty_set_templates
  for insert with check (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.active = true
        and upper(tm.status) = 'ACTIVE'
        and tm.permission_tier = any (array['COMMAND','CHIEF','HOD'])
    )
  );

drop policy if exists duty_set_templates_update on public.duty_set_templates;
create policy duty_set_templates_update on public.duty_set_templates
  for update using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.active = true
        and upper(tm.status) = 'ACTIVE'
        and tm.permission_tier = any (array['COMMAND','CHIEF','HOD'])
    )
  );

drop policy if exists duty_set_templates_delete on public.duty_set_templates;
create policy duty_set_templates_delete on public.duty_set_templates
  for delete using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.active = true
        and upper(tm.status) = 'ACTIVE'
        and tm.permission_tier = any (array['COMMAND','CHIEF','HOD'])
    )
  );
