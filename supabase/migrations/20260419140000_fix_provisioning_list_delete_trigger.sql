-- Fix provisioning_lists DELETE trigger that inserts into activity_events
-- without tenant_id, causing NOT NULL violation on every board delete.
--
-- The trigger was created outside of migrations (not in any migration file).
-- This migration:
--   1. Drops ALL existing DELETE triggers on provisioning_lists (safe — the
--      only trigger defined in migrations is BEFORE UPDATE for updated_at)
--   2. Creates a correct replacement trigger function that properly sets
--      tenant_id = OLD.tenant_id and wraps in EXCEPTION so audit logging
--      can NEVER block a board delete

-- ── 1. Drop all existing DELETE triggers on provisioning_lists ────────────────

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table  = 'provisioning_lists'
      AND event_manipulation  = 'DELETE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.provisioning_lists', rec.trigger_name);
    RAISE NOTICE 'Dropped trigger: %', rec.trigger_name;
  END LOOP;
END;
$$;

-- ── 2. Create a correct audit trigger ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_provisioning_list_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO activity_events (
    tenant_id,
    actor_user_id,
    actor_name,
    module,
    action,
    entity_type,
    entity_id,
    summary
  )
  SELECT
    OLD.tenant_id,
    auth.uid(),
    COALESCE(p.full_name, 'Unknown User'),
    'provisioning',
    'delete',
    'provisioning_list',
    OLD.id::text,
    'Deleted board: ' || COALESCE(OLD.title, 'Untitled')
  FROM (SELECT full_name FROM public.profiles WHERE id = auth.uid()) p;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Audit logging must never block a delete
  RAISE WARNING 'log_provisioning_list_delete: audit insert failed: %', SQLERRM;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS log_provisioning_list_delete_trigger ON public.provisioning_lists;

CREATE TRIGGER log_provisioning_list_delete_trigger
  AFTER DELETE ON public.provisioning_lists
  FOR EACH ROW EXECUTE FUNCTION public.log_provisioning_list_delete();
