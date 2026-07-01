-- Backfill Role / Department / Permission onto tenant_members for crew who
-- accepted an invite BEFORE accept_crew_invite_v3 was fixed to carry
-- custom_role_id (migration 20260701150000). Those members joined with a blank
-- role (both role_id and custom_role_id NULL), so their profile Contract tab
-- shows Role / Department / Permission as "—".
--
-- For each such member, copy the values from the invite they accepted. Only
-- rows that are actually blank are touched (role_id IS NULL AND custom_role_id
-- IS NULL); COALESCE preserves any department_id / permission_tier already set.
-- distinct on picks the most recently accepted invite when a member somehow has
-- more than one.
update public.tenant_members tm
set department_id   = coalesce(tm.department_id, inv.department_id),
    role_id         = inv.role_id,
    custom_role_id  = inv.custom_role_id,
    permission_tier = coalesce(tm.permission_tier, inv.permission_tier)
from (
  select distinct on (accepted_by, tenant_id)
         accepted_by, tenant_id, department_id, role_id, custom_role_id, permission_tier
  from public.crew_invites
  where status = 'ACCEPTED'
    and accepted_by is not null
  order by accepted_by, tenant_id, accepted_at desc
) inv
where inv.accepted_by = tm.user_id
  and inv.tenant_id   = tm.tenant_id
  and tm.role_id       is null
  and tm.custom_role_id is null
  and (inv.role_id is not null or inv.custom_role_id is not null);
