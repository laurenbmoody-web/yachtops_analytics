-- Backfill skipped_invite_crew for tenants that completed onboarding before
-- the column existed (added in 20260415120000_add_skipped_invite_crew.sql).
--
-- Logic: if a tenant finished onboarding and still has ≤ 1 active crew member
-- (the admin themselves), they either clicked "Do this later" or their invitees
-- never joined. Either way the dashboard "Invite your crew" card should surface.
--
-- Tenants where the admin DID send invites and crew joined (count > 1) are
-- correctly left at the default (false) and won't see the card.

UPDATE public.tenants t
SET skipped_invite_crew = true
WHERE t.onboarding_completed_at IS NOT NULL
  AND t.skipped_invite_crew = false
  AND (
    SELECT COUNT(*)
    FROM public.tenant_members tm
    WHERE tm.tenant_id = t.id
      AND tm.active = true
  ) <= 1;
