-- Per-user notification preferences (in-app bell). One row per user; missing
-- row = everything on. A BEFORE INSERT trigger on public.notifications enforces
-- these for EVERY DB-inserted bell notification, so no sender needs changing.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_rota_submissions       boolean NOT NULL DEFAULT true,
  notify_rota_decisions         boolean NOT NULL DEFAULT true,
  notify_hor_reminders          boolean NOT NULL DEFAULT true,
  notify_provisioning_approvals boolean NOT NULL DEFAULT true,
  notify_document_expiry        boolean NOT NULL DEFAULT true,
  notify_returns                boolean NOT NULL DEFAULT true,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_prefs_select ON public.notification_preferences;
CREATE POLICY notif_prefs_select ON public.notification_preferences
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS notif_prefs_insert ON public.notification_preferences;
CREATE POLICY notif_prefs_insert ON public.notification_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notif_prefs_update ON public.notification_preferences;
CREATE POLICY notif_prefs_update ON public.notification_preferences
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

-- Enforcement: suppress a bell insert when the recipient has that category off.
-- Unknown types pass through (fail-open). Document expiry is client-derived, not
-- inserted here, so it's filtered app-side instead.
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
    WHEN NEW.type LIKE 'ROTA_SUBMITTED%'              THEN p.notify_rota_submissions
    WHEN NEW.type IN ('ROTA_ACCEPTED', 'ROTA_REJECTED') THEN p.notify_rota_decisions
    WHEN NEW.type LIKE 'HOR%'                         THEN p.notify_hor_reminders
    WHEN NEW.type LIKE 'PROVISIONING%'                THEN p.notify_provisioning_approvals
    WHEN NEW.type LIKE 'RETURN%'                      THEN p.notify_returns
    ELSE true
  END;

  IF v_allowed = false THEN
    RETURN NULL;  -- drop the insert
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS notifications_respect_prefs_trg ON public.notifications;
CREATE TRIGGER notifications_respect_prefs_trg
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_respect_prefs();
