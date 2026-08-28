-- Let crew add and remove inventory items in their own department.
--
-- Background: inventory_items SELECT and UPDATE already allow COMMAND/CHIEF
-- globally OR any member whose department matches the item's usage_department
-- (so interior crew can view and edit — incl. qty — interior stock). But the
-- INSERT and DELETE policies only allowed COMMAND, or CHIEF/HOD with a matching
-- department — crew had no branch at all, so adding an item raised
-- "new row violates row-level security policy" and removing was blocked.
--
-- Fix: make INSERT (with check) and DELETE (using) mirror the SELECT/UPDATE
-- predicate exactly, so whoever can see and edit an item in their department can
-- also add and remove it there. COMMAND/CHIEF keep tenant-wide reach; HOD/CREW
-- are scoped to their own department via usage_department. New items default to
-- usage_department = 'INTERIOR' in the app, matching the interior crew.

drop policy if exists inventory_items_insert on public.inventory_items;
create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (
    exists (
      select 1
      from tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = inventory_items.tenant_id
        and tm.active is not false
        and (
          tm.permission_tier = any (array['COMMAND'::text, 'CHIEF'::text])
          or exists (
            select 1
            from departments d
            where d.id = tm.department_id
              and upper(d.name) = inventory_items.usage_department
          )
        )
    )
  );

drop policy if exists inventory_items_delete on public.inventory_items;
create policy inventory_items_delete on public.inventory_items
  for delete to authenticated
  using (
    exists (
      select 1
      from tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = inventory_items.tenant_id
        and tm.active is not false
        and (
          tm.permission_tier = any (array['COMMAND'::text, 'CHIEF'::text])
          or exists (
            select 1
            from departments d
            where d.id = tm.department_id
              and upper(d.name) = inventory_items.usage_department
          )
        )
    )
  );
