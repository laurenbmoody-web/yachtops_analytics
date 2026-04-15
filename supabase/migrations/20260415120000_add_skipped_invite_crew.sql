-- Track whether the vessel admin clicked "Do this later" on the invite-crew
-- onboarding step. Used by the dashboard to conditionally surface the
-- "Invite your crew" setup card until crew members join.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS skipped_invite_crew BOOLEAN NOT NULL DEFAULT FALSE;
