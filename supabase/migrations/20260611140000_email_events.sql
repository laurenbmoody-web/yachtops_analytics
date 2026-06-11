-- ─────────────────────────────────────────────────────────────────────────────
-- 20260611140000_email_events.sql
--
-- WHAT: public.email_events — a log of Resend delivery problems (bounces,
--       complaints, delays) for EVERY email Cargo sends, populated by the
--       resendWebhook edge function. Gives the Cargo backend a queryable
--       history so a suppressed/bounced address surfaces on its own instead
--       of silently failing (Resend accepts the send with 200, then drops it).
--
-- SCOPE: backend/ops data, not tenant-facing. RLS is enabled with NO client
--        policies — only the service role (the webhook) writes, and ops reads
--        via the service role / SQL editor. Nothing is world- or tenant-
--        readable.
--
-- IDEMPOTENCY: CREATE ... IF NOT EXISTS throughout. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,              -- e.g. email.bounced | email.complained
  email_id    text,                       -- Resend message id
  recipient   text,                       -- comma-joined To addresses
  subject     text,
  reason      text,                       -- bounce/complaint detail, if any
  payload     jsonb,                       -- full webhook event for forensics
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_events_created_idx
  ON public.email_events (created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_type_idx
  ON public.email_events (event_type);
CREATE INDEX IF NOT EXISTS email_events_recipient_idx
  ON public.email_events (recipient);

-- Locked down: RLS on, no policies → no anon/authenticated access. The webhook
-- writes with the service role (bypasses RLS); ops reads with the service role.
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
