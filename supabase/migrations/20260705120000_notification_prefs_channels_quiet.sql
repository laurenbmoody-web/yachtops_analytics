-- Extend notification_preferences for the redesigned "signal desk" tab:
--   * new bell categories that are DB-inserted or client-derived (sea-time,
--     vessel documents),
--   * a parallel set of EMAIL preferences for the categories that actually
--     email (rota submissions/decisions, HOR, sea-time),
--   * quiet hours.
--
-- Bell stays enforced by the existing BEFORE-INSERT trigger on
-- public.notifications (extended below for sea_time). Vessel/crew document
-- expiries are client-derived and filtered app-side (see lib/derivedNotifications).
-- Email columns are stored preferences; the sending edge functions honour them
-- in a follow-up. Quiet hours are stored for the delivery layer.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_seatime         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_vessel_docs      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_rota_submissions  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_rota_decisions    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_hor_reminders     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_seatime           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_enabled           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_from              time    NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_to                time    NOT NULL DEFAULT '07:00';

-- Bell suppression: add the sea-time category (a real DB insert). Everything
-- else is unchanged; unknown types still fail-open.
CREATE OR REPLACE FUNCTION public.notifications_respect_prefs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  p public.notification_preferences%ROWTYPE;
  v_allowed boolean;
BEGIN
  SELECT * INTO p FROM public.notification_preferences WHERE user_id = NEW.user_id;
  IF NOT FOUND THEN
    RETURN NEW;  -- no preferences set → everything on
  END IF;

  v_allowed := CASE
    WHEN NEW.type LIKE 'ROTA_SUBMITTED%'                 THEN p.notify_rota_submissions
    WHEN NEW.type IN ('ROTA_ACCEPTED', 'ROTA_REJECTED')  THEN p.notify_rota_decisions
    WHEN NEW.type LIKE 'HOR%'                            THEN p.notify_hor_reminders
    WHEN NEW.type LIKE 'PROVISIONING%'                   THEN p.notify_provisioning_approvals
    WHEN NEW.type LIKE 'RETURN%'                         THEN p.notify_returns
    WHEN NEW.type = 'sea_time'                           THEN p.notify_seatime
    ELSE true
  END;

  IF v_allowed = false THEN
    RETURN NULL;  -- drop the insert
  END IF;
  RETURN NEW;
END;
$function$;
