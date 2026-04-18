-- Add 'travelling' status (added in crewStatus.js but missing from DB constraint)

-- Drop the existing constraint first
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_status_check;

-- Normalise any remaining non-conforming status values before re-adding constraint
UPDATE public.tenant_members
SET status = CASE
  WHEN status = 'ACTIVE'   THEN 'active'
  WHEN status = 'INACTIVE' THEN 'active'
  WHEN status = 'INVITED'  THEN 'invited'
  WHEN status IS NULL       THEN 'active'
  ELSE 'active'
END
WHERE status NOT IN (
  'active', 'on_leave', 'rotational_leave',
  'medical_leave', 'training', 'travelling', 'invited'
);

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
