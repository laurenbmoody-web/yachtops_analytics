-- crew_personal_details RLS honoured only the raw permission_tier, so a user
-- granted COMMAND via permission_tier_override (e.g. a chief stew acting up)
-- could not read or write another crew member's personal details — including
-- the uniform sizes surfaced on the Issued Kit tab, which then showed empty.
--
-- Honour the effective tier: coalesce(permission_tier_override, permission_tier).
alter policy crew_personal_details_access on public.crew_personal_details
  using (
    (user_id = auth.uid()) OR (EXISTS (
      SELECT 1
      FROM tenant_members v
      JOIN tenant_members s ON s.tenant_id = v.tenant_id
      WHERE v.user_id = auth.uid()
        AND v.active = true
        AND COALESCE(v.permission_tier_override, v.permission_tier) = 'COMMAND'
        AND s.user_id = crew_personal_details.user_id
    ))
  )
  with check (
    (user_id = auth.uid()) OR (EXISTS (
      SELECT 1
      FROM tenant_members v
      JOIN tenant_members s ON s.tenant_id = v.tenant_id
      WHERE v.user_id = auth.uid()
        AND v.active = true
        AND COALESCE(v.permission_tier_override, v.permission_tier) = 'COMMAND'
        AND s.user_id = crew_personal_details.user_id
    ))
  );
