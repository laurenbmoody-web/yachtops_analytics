-- Give the bridge team the whole vessel's inventory.
--
-- THE PROBLEM
-- Inventory reads were scoped by tier OR department: COMMAND and CHIEF saw
-- everything, and everybody else saw only items whose usage_department matched
-- their own. Bridge is a department, not a tier, so a Bridge officer below Chief
-- was scoped to a folder named "Bridge" — and the things the bridge team are
-- actually responsible for (LSA/FFE, medical stores, charts and publications)
-- live under Deck and Medical. On Horizon that left the Bridge HOD with one
-- folder and nothing in it.
--
-- THE RULE, now in one place
-- has_whole_vessel_inventory() says who is not department-scoped: the COMMAND
-- and CHIEF tiers as before, plus anyone in the Bridge department whatever their
-- tier. The four inventory_items policies all go through can_reach_inventory(),
-- so the rule is stated once instead of four times.
--
-- It is mirrored in src/services/inventoryScope.js, which decides the root
-- folders the page offers. The two must agree: if the UI is wider, folders open
-- empty; if RLS is wider, crew never see stock they are entitled to. Change one,
-- change the other — both files say so.
--
-- SCOPE OF THE GRANT
-- Full read AND write, matching what COMMAND and CHIEF already have, because the
-- bridge team need to count and sign off safety gear rather than just look at
-- it. Deletes still land in Trash with 30-day recovery.
--
-- DELIBERATELY NOT CHANGED
-- permission_tier is read on its own, with no fallback to tenant_members.role,
-- exactly as the policies being replaced did. Those two columns disagree on live
-- rows — there are members with permission_tier 'CREW' and role 'CHIEF' — so
-- adding a coalesce here would quietly widen access well beyond the bridge.
-- Likewise `active is not false` is kept rather than `active = true`, to match
-- the replaced policies rather than silently re-scoping anyone.
--
-- KNOWN SEPARATE BUG, not fixed here
-- Every inventory_items row on this project carries usage_department 'INTERIOR'
-- (1,010 of 1,010), because that is the hardcoded fallback in
-- inventoryStorage.js. So the department branch below currently matches nothing
-- for non-Interior crew, and Deck / Engineering / Galley crew see no items at
-- all. That is its own fix and its own change; this migration only moves Bridge
-- out of the scoped branch.

-- ── the rule ────────────────────────────────────────────────────────────────
create or replace function public.has_whole_vessel_inventory(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.tenant_members tm
      left join public.departments d on d.id = tm.department_id
     where tm.tenant_id = p_tenant
       and tm.user_id = auth.uid()
       and tm.active is not false
       and (
         tm.permission_tier = any (array['COMMAND', 'CHIEF'])
         or upper(d.name) = 'BRIDGE'
       )
  );
$$;

comment on function public.has_whole_vessel_inventory is
  'True when this member reads and writes inventory across every department: the COMMAND and CHIEF tiers, plus anyone in the Bridge department. Mirrored by hasWholeVesselInventory in src/services/inventoryScope.js.';

-- ── what the policies ask ───────────────────────────────────────────────────
-- Whole-vessel scope, or the member's own department. Both branches require
-- tenant membership, so this never widens access beyond the vessel.
create or replace function public.can_reach_inventory(p_tenant uuid, p_usage_department text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_whole_vessel_inventory(p_tenant)
     or exists (
       select 1
         from public.tenant_members tm
         join public.departments d on d.id = tm.department_id
        where tm.tenant_id = p_tenant
          and tm.user_id = auth.uid()
          and tm.active is not false
          and upper(d.name) = p_usage_department
     );
$$;

comment on function public.can_reach_inventory is
  'Row gate for inventory_items: whole-vessel scope, or the row belongs to the member''s own department.';

-- ── the policies ────────────────────────────────────────────────────────────
-- Each is dropped first because Postgres has no CREATE POLICY IF NOT EXISTS;
-- without the guard this migration aborts the moment a policy already exists,
-- which is exactly what happens when the schema was applied ahead of the deploy.

drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items
  for select using (
    public.can_reach_inventory(tenant_id, usage_department)
  );

drop policy if exists inventory_items_insert on public.inventory_items;
create policy inventory_items_insert on public.inventory_items
  for insert with check (
    public.can_reach_inventory(tenant_id, usage_department)
  );

drop policy if exists inventory_items_update on public.inventory_items;
create policy inventory_items_update on public.inventory_items
  for update using (
    public.can_reach_inventory(tenant_id, usage_department)
  ) with check (
    public.can_reach_inventory(tenant_id, usage_department)
  );

drop policy if exists inventory_items_delete on public.inventory_items;
create policy inventory_items_delete on public.inventory_items
  for delete using (
    public.can_reach_inventory(tenant_id, usage_department)
  );
