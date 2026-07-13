-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713110000_crew_requests_reviews.sql
--
-- WHAT: Move the crew notification-email request from the NOTIFICATIONS feed
--       into the REVIEWS inbox. Previously an AFTER INSERT trigger dropped a
--       bell notification on every COMMAND user pointing at a Vessel Settings
--       section. That surface is gone — the request now lives in the Reviews
--       inbox under "Crew requests", discovered the same way rota/order/sea-time
--       queues are (a scoped query + the inbox badge), NOT as a notification.
--
-- CHANGE: drop the trigger + its function. The request queue, its RLS, and the
--         COMMAND-only decide RPC (which still notifies the *requester* of the
--         outcome) are unchanged — a decision is a legitimate notification to
--         the crew member, who has no reviews inbox of their own.
--
-- IDEMPOTENT: DROP ... IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_notify_command_email_request ON public.notification_email_requests;
DROP FUNCTION IF EXISTS public.notify_command_on_email_request();
