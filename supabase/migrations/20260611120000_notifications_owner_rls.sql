-- ─────────────────────────────────────────────────────────────────────────────
-- 20260611120000_notifications_owner_rls.sql
--
-- WHAT: Create public.notifications (the table never existed) + owner-scoped
--       RLS so the nav-bar bell works cross-device.
--
-- BACKGROUND: Two client callers already INSERT into `notifications`
--       (ReturnConfirmPage return-confirmed; now rota decisions via
--       sendDbNotification) but the table was never created — those inserts
--       silently failed (errors swallowed). This migration creates it with the
--       exact column shape both callers use, then adds:
--         * SELECT own rows  (bell list + unread badge)
--         * UPDATE own rows  (mark read)
--         * DELETE own rows  (clear read)
--         * INSERT addressed to anyone, gated to authenticated users (a
--           reviewer notifies the submitter → user_id = the submitter).
--           Server-side writers use the service role and bypass RLS.
--
-- COLUMNS (must match ReturnConfirmPage.jsx + src/lib/dbNotifications.js):
--       user_id, type, title, message, severity, action_url, read, created_at.
--
-- IDEMPOTENCY: CREATE TABLE/INDEX IF NOT EXISTS; ENABLE RLS is a no-op if on;
--       DROP POLICY IF EXISTS before each CREATE. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text,
  title       text,
  message     text,
  severity    text NOT NULL DEFAULT 'info',
  action_url  text,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Bell queries: unread badge (user_id + read) and feed list (user_id, newest).
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_owner_select" ON public.notifications;
CREATE POLICY "notifications_owner_select" ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update" ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_owner_delete" ON public.notifications;
CREATE POLICY "notifications_owner_delete" ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- INSERT: any authenticated user may write a notification (addressed to
-- another user — e.g. a reviewer notifying the submitter). Server-side
-- writers use the service role and bypass RLS anyway.
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.notifications;
CREATE POLICY "notifications_authenticated_insert" ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
