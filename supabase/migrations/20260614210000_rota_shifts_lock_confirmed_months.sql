-- ─────────────────────────────────────────────────────────────────────────────
-- 20260614210000_rota_shifts_lock_confirmed_months.sql
--
-- WHAT: Once a crew member's Hours-of-Rest month is signed off (hor_month_status
--       = 'confirmed' or 'locked'), their rota_shifts for that month become
--       immutable — the signed record can't silently change. Enforced as a
--       row-level trigger so EVERY write path is covered (grid autosave, template
--       apply, publish/clear RPCs, snapshot restore). Reopening the month
--       (hor_reopen_month → 'open') lifts the block.
--
--       hor_month_status is keyed by subject_user_id (= profiles/auth id); rota
--       rows carry member_id (tenant_members.id), so we map across.
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._rota_shifts_block_signed_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_member  uuid;
  v_date    date;
  v_tenant  uuid;
  v_subject uuid;
  v_status  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_member := OLD.member_id; v_date := OLD.shift_date; v_tenant := OLD.tenant_id;
  ELSE
    v_member := NEW.member_id; v_date := NEW.shift_date; v_tenant := NEW.tenant_id;
  END IF;

  IF v_member IS NULL OR v_date IS NULL OR v_tenant IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- rota member → the HOR subject (auth/profiles id)
  SELECT tm.user_id INTO v_subject
  FROM public.tenant_members tm
  WHERE tm.id = v_member AND tm.tenant_id = v_tenant
  LIMIT 1;
  IF v_subject IS NULL THEN
    RETURN COALESCE(NEW, OLD); -- unlinked crew member: nothing to lock against
  END IF;

  SELECT s.status INTO v_status
  FROM public.hor_month_status s
  WHERE s.tenant_id = v_tenant
    AND s.subject_user_id = v_subject
    AND s.period_year  = EXTRACT(YEAR  FROM v_date)::int
    AND s.period_month = EXTRACT(MONTH FROM v_date)::int
  LIMIT 1;

  IF v_status IN ('confirmed', 'locked') THEN
    RAISE EXCEPTION
      'Hours of rest are signed off for % — reopen that month to change the rota.',
      to_char(v_date, 'FMMonth YYYY');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS rota_shifts_block_signed_month ON public.rota_shifts;
CREATE TRIGGER rota_shifts_block_signed_month
  BEFORE INSERT OR UPDATE OR DELETE ON public.rota_shifts
  FOR EACH ROW EXECUTE FUNCTION public._rota_shifts_block_signed_month();
