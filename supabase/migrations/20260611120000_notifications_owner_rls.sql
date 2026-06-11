-- ─────────────────────────────────────────────────────────────────────────────
-- 20260611120000_notifications_owner_rls.sql
--
-- WHAT: Owner-scoped RLS on public.notifications so the nav-bar bell can read
--       and manage a user's own notifications cross-device. The table already
--       exists (written to by ReturnConfirmPage and now by rota decisions) but
--       was effectively write-only from the client's perspective — nothing
--       read it, and no policy let a user SELECT their own rows. This adds:
--         * SELECT  own rows            (bell list + unread badge)
--         * UPDATE  own rows            (mark read)
--         * DELETE  own rows            (clear read)
--         * INSERT  rows addressed to anyone in scope (a reviewer notifying a
--           submitter writes user_id = the submitter, not themselves), gated
--           to authenticated users — server-side writers use the service role
--           and bypass RLS regardless.
--
-- NOT A RECOVERY MIGRATION: additive RLS on a live table.
--
-- IDEMPOTENCY: ENABLE RLS is a no-op if already on; DROP POLICY IF EXISTS
--       before each CREATE. Safe to re-apply.
--
-- NOTE: assumes the live shape has columns user_id (uuid) and read (bool),
--       matching every existing caller. If a column name differs in prod,
--       adjust the predicates — the policy names are stable.
-- ─────────────────────────────────────────────────────────────────────────────

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
-- another user — e.g. a reviewer notifying the submitter). Source-side
-- correctness is the caller's responsibility; server-side writers use the
-- service role and bypass RLS anyway.
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.notifications;
CREATE POLICY "notifications_authenticated_insert" ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
