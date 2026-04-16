-- Migration: Add email delivery tracking columns to crew_invites
-- Created: 2026-04-16
--
-- email_sent_at  — timestamp of most recent successful Resend delivery
--                  (set by the sendCrewInvite edge function on success)
-- email_send_error — Resend error message from last failed send attempt;
--                    cleared to NULL on subsequent success
--
-- IMPORTANT: this migration is NOT auto-applied by Netlify.
-- Run in the Supabase SQL Editor (Database → SQL Editor → New query → Run).

ALTER TABLE public.crew_invites
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS email_send_error TEXT;

COMMENT ON COLUMN public.crew_invites.email_sent_at IS
  'Timestamp of the most recent successful crew invite email sent via Resend';
COMMENT ON COLUMN public.crew_invites.email_send_error IS
  'Resend error message from the last failed send attempt; NULL when the last send succeeded';
