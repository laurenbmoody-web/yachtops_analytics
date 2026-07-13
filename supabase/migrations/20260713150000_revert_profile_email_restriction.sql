-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713150000_revert_profile_email_restriction.sql
--
-- REVERT of 20260713130000_restrict_profile_email.sql.
--
-- That migration revoked authenticated's table-wide SELECT on profiles and
-- re-granted every column except email. It broke the app: the AuthContext
-- bootstrap fetches `email` from profiles on every sign-in, so the restriction
-- turned into "permission denied for table profiles" and locked users out at
-- "No active vessel access". The column-restriction approach needs exhaustive
-- coverage of every profiles read (contexts/services included) before it can be
-- re-attempted; until then, restore full read access.
--
-- crew_emails() is left in place — harmless, and useful if the restriction is
-- redone properly later.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT ON public.profiles TO authenticated;
