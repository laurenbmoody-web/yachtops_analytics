-- Add 'travelling' status (added in crewStatus.js but missing from DB constraint)
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_status_check;

ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_status_check
  CHECK (status IN (
    'active',
    'on_leave',
    'rotational_leave',
    'medical_leave',
    'training',
    'travelling',
    'invited'
  ));
