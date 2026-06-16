-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616160000_hor_reminders_email_grant.sql
--
-- Support for the hor-reminders edge function (the email escalation layer):
--   • pg_net  — lets the daily cron POST to the edge function from SQL.
--   • GRANT   — the edge function authenticates as service_role and calls the
--               engine RPC, so service_role needs EXECUTE (the function had it
--               revoked from PUBLIC).
--
-- The daily EMAIL cron itself is added separately, only after a verified test
-- send, so no crew email goes out before the template is approved.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_net;

grant execute on function public.hor_run_daily_reminders(date, boolean) to service_role;
