-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000002_auto_create_standing_rotas_trigger.sql
--
-- WHAT: Recreates the function create_vessel_standing_rota_for_new_tenant()
--       and the AFTER INSERT trigger ensure_vessel_standing_rota on
--       public.tenants, so every new tenant automatically gets its single
--       "vessel" standing rota. Also idempotently backfills the standing rota
--       for any pre-existing tenant that lacks one.
--
-- RECOVERY MIGRATION: function + trigger are ALREADY LIVE (introspected
--       verbatim). No-op on prod.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS before
--       CREATE TRIGGER (Postgres has no CREATE TRIGGER IF NOT EXISTS — this is
--       the same pattern used by 20260417200000_crew_status_history.sql); the
--       backfill INSERT is guarded by NOT EXISTS so it inserts nothing on prod
--       (all 5 live tenants already have their standing rota).
--
-- AUDIT NOTES / QUIRKS:
--   * The function sets vessel_id = NEW.id (the TENANT's id) — tenant↔vessel id
--     reuse. Reproduced byte-for-byte incl. lowercase begin/end, LANGUAGE
--     plpgsql, NOT SECURITY DEFINER, NO `SET search_path` (unqualified
--     `insert into rotas` relies on search_path). Robustness observation only;
--     deliberately NOT modified — this is a faithful recovery.
--   * The trigger only fires for FUTURE tenant INSERTs; the NOT EXISTS backfill
--     below covers tenants created before the trigger existed and makes fresh/
--     partial environments correct. Backfill ordering is intentional: must run
--     after _001 (rotas exists) and before _003 (rota_shifts.rota_id backfill
--     references these standing rotas).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_vessel_standing_rota_for_new_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  insert into rotas (tenant_id, vessel_id, owner_type, date_start, date_end, name)
  values (new.id, new.id, 'vessel', new.created_at::date, null, 'Vessel standing rota');
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS ensure_vessel_standing_rota ON public.tenants;
CREATE TRIGGER ensure_vessel_standing_rota
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION create_vessel_standing_rota_for_new_tenant();

-- Idempotent backfill for tenants that predate the trigger (no-op on prod).
INSERT INTO public.rotas (tenant_id, vessel_id, owner_type, date_start, date_end, name)
SELECT t.id, t.id, 'vessel', t.created_at::date, NULL, 'Vessel standing rota'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.rotas r
  WHERE r.vessel_id = t.id AND r.owner_type = 'vessel'
);
