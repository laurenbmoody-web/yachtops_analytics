-- ─────────────────────────────────────────────────────────────────────────────
-- 20260701130000_delivery_status_excludes_unavailable.sql
--
-- Excludes crew-set 'unavailable' lines from the delivery-status rollup.
--
-- recompute_provisioning_list_delivery_status (20260626230002) advances a
-- board to 'delivered' once (received + not_received + returned) = total
-- items. With the new crew-set 'unavailable' line status (a line that
-- won't be supplied), those items are none of received / not_received /
-- returned — so v_total could never be reached and a board with any
-- unavailable line would stick at 'partially_delivered' forever.
--
-- Fix: drop 'unavailable' lines from v_total (the delivery denominator).
-- The board then completes once every *supplyable* line is finalized.
-- Everything else about the trigger is unchanged (upward-only, pre-receive
-- phase untouched, same SECURITY DEFINER / search_path pinning).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_provisioning_list_delivery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list_id        uuid;
  v_total          int;
  v_received       int;
  v_partial        int;
  v_not_received   int;
  v_returned       int;
  v_current_status text;
  v_next_status    text;
BEGIN
  -- COALESCE handles INSERT (OLD null) and DELETE (NEW null).
  v_list_id := COALESCE(NEW.list_id, OLD.list_id);
  IF v_list_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Skip UPDATEs that didn't touch status (other column edits
  -- shouldn't kick the lifecycle forward).
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Tally the children of the parent list. 'unavailable' lines are
  -- excluded from the total (they won't be supplied), so the board can
  -- still complete once every supplyable line is finalized.
  SELECT COUNT(*) FILTER (WHERE status <> 'unavailable'),
         COUNT(*) FILTER (WHERE status = 'received'),
         COUNT(*) FILTER (WHERE status = 'partial'),
         COUNT(*) FILTER (WHERE status = 'not_received'),
         COUNT(*) FILTER (WHERE status = 'returned')
    INTO v_total, v_received, v_partial, v_not_received, v_returned
    FROM public.provisioning_items
   WHERE list_id = v_list_id;

  IF v_total = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_current_status
    FROM public.provisioning_lists
   WHERE id = v_list_id;

  -- Decide the next status.
  --   * Everything finalized (received / not_received / returned)
  --     AND ≥1 received  → delivered  (or delivered_with_discrepancies
  --     if any line came up short)
  --   * Otherwise, ≥1 received or partial → partially_delivered
  --   * Otherwise → leave the lifecycle alone (still in pre-receive
  --     phase, the supplier flow owns it).
  IF (v_received + v_not_received + v_returned) = v_total
     AND v_received > 0 THEN
    IF (v_not_received + v_returned) > 0 THEN
      v_next_status := 'delivered_with_discrepancies';
    ELSE
      v_next_status := 'delivered';
    END IF;
  ELSIF (v_received + v_partial) > 0 THEN
    v_next_status := 'partially_delivered';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_current_status = v_next_status THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Never downgrade. A board already at 'delivered' /
  -- 'delivered_with_discrepancies' stays put even if an item gets
  -- reopened — the chief can correct via another flow.
  IF v_current_status = 'delivered'
     AND v_next_status IN ('partially_delivered',
                           'delivered_with_discrepancies') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_current_status = 'delivered_with_discrepancies'
     AND v_next_status = 'partially_delivered' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.provisioning_lists
     SET status     = v_next_status,
         updated_at = now()
   WHERE id = v_list_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.recompute_provisioning_list_delivery_status() IS
  'Auto-progresses provisioning_lists.status from receive events on
   its children. Fires on AFTER INSERT / UPDATE OF status / DELETE
   on provisioning_items. Upward-only — never downgrades a delivered
   board. Excludes crew-set ''unavailable'' lines from the delivery
   denominator so a board still completes once every supplyable line
   is finalized.';
