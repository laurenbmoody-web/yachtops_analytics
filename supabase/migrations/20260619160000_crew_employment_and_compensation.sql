-- Contract / employment data for the profile section.
-- Two tables so pay can be COMMAND-only (RLS is row-level, not column-level):
--   crew_employment   — contract terms; readable by the owner + COMMAND
--   crew_compensation — salary / day rate; COMMAND only

CREATE TABLE IF NOT EXISTS public.crew_employment (
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_type        text,
  start_date           date,
  end_date             date,
  probation_end_date   date,
  rotation_pattern     text,
  leave_entitlement_days integer,
  notice_period        text,
  sea_reference        text,
  flag_state           text,
  governing_law        text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.crew_compensation (
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  salary_amount    numeric(12,2),
  salary_currency  text,
  day_rate         numeric(12,2),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE public.crew_employment   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_compensation ENABLE ROW LEVEL SECURITY;

-- COMMAND of the row's tenant (explicit tier or override).
-- crew_employment: owner may read; COMMAND may read + write.
DROP POLICY IF EXISTS crew_employment_select ON public.crew_employment;
CREATE POLICY crew_employment_select ON public.crew_employment FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.tenant_members tm
             WHERE tm.tenant_id = crew_employment.tenant_id AND tm.user_id = auth.uid()
               AND tm.active = true
               AND (tm.permission_tier = 'COMMAND' OR tm.permission_tier_override = 'COMMAND'))
);
DROP POLICY IF EXISTS crew_employment_write ON public.crew_employment;
CREATE POLICY crew_employment_write ON public.crew_employment FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = crew_employment.tenant_id AND tm.user_id = auth.uid()
            AND tm.active = true
            AND (tm.permission_tier = 'COMMAND' OR tm.permission_tier_override = 'COMMAND'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = crew_employment.tenant_id AND tm.user_id = auth.uid()
            AND tm.active = true
            AND (tm.permission_tier = 'COMMAND' OR tm.permission_tier_override = 'COMMAND'))
);

-- crew_compensation: COMMAND only for read + write.
DROP POLICY IF EXISTS crew_compensation_all ON public.crew_compensation;
CREATE POLICY crew_compensation_all ON public.crew_compensation FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = crew_compensation.tenant_id AND tm.user_id = auth.uid()
            AND tm.active = true
            AND (tm.permission_tier = 'COMMAND' OR tm.permission_tier_override = 'COMMAND'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = crew_compensation.tenant_id AND tm.user_id = auth.uid()
            AND tm.active = true
            AND (tm.permission_tier = 'COMMAND' OR tm.permission_tier_override = 'COMMAND'))
);

GRANT SELECT, INSERT, UPDATE ON public.crew_employment   TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crew_compensation TO authenticated;
