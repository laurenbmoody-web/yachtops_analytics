-- Add 'travelling' status (added in crewStatus.js but missing from DB constraint)

-- Drop the existing constraint first
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_status_check;

-- Normalise any remaining non-conforming status values before re-adding constraint
-- NULL NOT IN (...) evaluates to NULL in SQL, so IS NULL must be checked explicitly
UPDATE public.tenant_members
SET status = 'active'
WHERE status IS NULL
   OR status NOT IN (
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
