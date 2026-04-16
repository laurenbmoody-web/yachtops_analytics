-- Track per-tenant onboarding state for the dashboard "Next up" card.
--
-- skipped_invite_crew — set by the onboarding flow when the admin clicks
--   "Do this later" on the invite-crew step. Still stored for reference but
--   the dashboard now uses dismissed_tasks for hiding cards.
--
-- dismissed_tasks — array of task keys (see onboardingTasks.js) the admin has
--   clicked "Skip" on. The NextUp card advances to the next non-dismissed task.
--   Cleared when the admin clicks "Show all tasks".
--
-- IMPORTANT: this migration is NOT auto-applied by Netlify.
-- Run in the Supabase SQL Editor (Database → SQL Editor → New query → Run).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS skipped_invite_crew boolean DEFAULT false;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS dismissed_tasks text[] DEFAULT '{}';
