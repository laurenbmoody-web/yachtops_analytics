-- Migration: Add post-signup onboarding flow columns
-- Purpose: Support the 3-step /onboarding flow that runs between
--          /set-password and /dashboard for brand-new vessels.
-- Date: 2026-04-14

-- ─── tenants: onboarding completion flag ───────────────────────────────────
-- Used by the /onboarding route guard and the dashboard welcome tutorial.
-- NULL = onboarding not yet complete; non-null = complete at that timestamp.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

COMMENT ON COLUMN public.tenants.onboarding_completed_at IS
  'Set when the vessel admin finishes the 3-step onboarding flow. '
  'NULL means onboarding still needs to be completed.';

-- ─── profiles: per-user custom departments ─────────────────────────────────
-- Each user can add "Other" departments during onboarding step 2. These are
-- user-local only — they MUST NEVER be written to the tenant-wide departments
-- table or to tenants.departments_in_use.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_departments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.custom_departments IS
  'User-local custom departments added during onboarding. Shape: '
  '[{id, name}]. Never persisted tenant-wide.';

-- ─── profiles: dashboard welcome-tutorial state ────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dashboard_tutorial_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_tutorial_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.dashboard_tutorial_dismissed_at IS
  'Set when the user dismisses the post-onboarding welcome tutorial '
  'on /dashboard. NULL = still visible.';

COMMENT ON COLUMN public.profiles.onboarding_tutorial_state IS
  'Progress state for the dashboard welcome tutorial. Shape: '
  '{locations_done: bool, folders_done: bool, upload_done: bool}.';
