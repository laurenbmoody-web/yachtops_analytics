-- Make usage_department mean something.
--
-- THE BUG
-- Every inventory_items row on this project carried usage_department
-- 'INTERIOR' — 1,010 of 1,010 — because that was the column default AND the
-- hardcoded fallback in inventoryStorage.js, and nothing in the UI ever set it.
-- RLS gates rows on that column, so the department gate was not scoping
-- anything: it was labelling the entire fleet's stock as Interior's.
--
-- Two consequences, in opposite directions:
--   * Interior crew could see every other department's stock, including 341
--     medical items on Belongers.
--   * Every other department-scoped crew member saw nothing at all, even in
--     folders holding their own gear.
--
-- THE FIX
-- The folder tree is already the single source of truth for where an item lives
-- (see CLAUDE.md: read location + sub_location for "where is this item"). So
-- usage_department is now DERIVED from the root folder rather than typed: an
-- item in the Medical folder belongs to Medical, full stop. A trigger keeps it
-- true on insert and on update, which matters because items get moved between
-- folders by drag, by bulk move and by import — patching one write path would
-- have left the rest to drift back out of step.
--
-- NON-DEPARTMENT FOLDERS ARE UNRESTRICTED
-- Some root folders are not departments: Archive, Unfiled, and rows with no
-- location at all (10 items today). Those derive NULL, and NULL reads as "not
-- department-restricted" — any member of the vessel can see them. The
-- alternative was to orphan them behind a department nobody is in, which would
-- have hidden real stock from everyone but Command. Failing open is the right
-- way round for a folder whose whole meaning is "not sorted yet".
--
-- WHY SECURITY DEFINER ON THE DERIVATION
-- It reads public.departments, which has RLS enabled. The policy is currently
-- `using (true)`, so any member can read it and the derivation would work
-- either way — but if that policy is ever tightened, a caller who could not see
-- a department row would derive NULL and silently turn its items unrestricted.
-- That is a privilege leak nobody would notice, so the function does not depend
-- on the caller's visibility.
--
-- WHAT THIS CHANGES FOR REAL CREW (measured, not estimated)
--   Belongers Medical CREW   0 -> 344   the 341 medical items they maintain
--   M/Y Aurora Deck CREW     0 ->   8
--   Belongers Deck/Security/Spa CREW   0 -> 3   (the unrestricted items)
--   Belongers Interior CREW  359 -> 17  loses the medical stores
--   Horizon   Interior CREW  596 -> 559 loses the Spa folder
--   M/Y Aurora Interior CREW  55 -> 49
--   Horizon Deck/Engineering/Galley    0 -> 0   no stock in those folders yet
-- Command, Chief and Bridge are unaffected: they read the whole vessel.
--
-- REVERSIBLE
-- The previous state was uniform, so undoing the backfill is one statement:
--   update public.inventory_items set usage_department = 'INTERIOR';
-- (after disabling the trigger). Nothing else here destroys information.

-- ── deriving a department from a folder name ─────────────────────────────────
create or replace function public.inventory_department_for_location(p_location text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select upper(d.name)
    from public.departments d
   where upper(d.name) = upper(btrim(p_location))
   limit 1;
$$;

comment on function public.inventory_department_for_location is
  'The department that owns a root inventory folder, uppercased, or NULL when the folder is not a department (Archive, Unfiled, unset) and its items are therefore not department-restricted.';

-- ── keeping it true ─────────────────────────────────────────────────────────
-- Always derives rather than honouring a supplied value: the folder is the
-- authority, and an item that has been moved must not keep its old department.
create or replace function public.inventory_items_sync_usage_department()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.usage_department := public.inventory_department_for_location(new.location);
  return new;
end;
$$;

comment on function public.inventory_items_sync_usage_department is
  'Derives inventory_items.usage_department from the item''s root folder on every write, so a moved item cannot keep the previous department.';

drop trigger if exists inventory_items_sync_usage_department on public.inventory_items;
create trigger inventory_items_sync_usage_department
  before insert or update on public.inventory_items
  for each row
  execute function public.inventory_items_sync_usage_department();

-- The old default labelled every new row Interior before anything else ran.
alter table public.inventory_items
  alter column usage_department set default null;

-- ── the gate ────────────────────────────────────────────────────────────────
-- Unchanged except that NULL now reads as unrestricted. Whole-vessel scope
-- (Command, Chief, Bridge) still comes from has_whole_vessel_inventory().
create or replace function public.can_reach_inventory(p_tenant uuid, p_usage_department text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_whole_vessel_inventory(p_tenant)
     or (
       -- Not department-restricted: a folder that is not a department.
       p_usage_department is null
       and public.is_tenant_member(p_tenant)
     )
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
  'Row gate for inventory_items: whole-vessel scope, an unrestricted row (no department), or a row belonging to the member''s own department.';

-- ── backfill ────────────────────────────────────────────────────────────────
-- Re-runnable: derives the same answer every time. The where clause keeps it a
-- genuine no-op once the data is correct rather than rewriting every row.
update public.inventory_items i
   set usage_department = public.inventory_department_for_location(i.location)
 where i.usage_department is distinct from
       public.inventory_department_for_location(i.location);
