-- ─────────────────────────────────────────────────────────────────────────────
-- 20260626230000_provisioning_list_status_from_receive.sql
--
-- Auto-progress provisioning_lists.status from item receive events.
--
-- The supplier-driven leg of the lifecycle already auto-advances:
-- a supplier quoting flips the list to 'quote_received'
-- (handle_supplier_quote_for_list_status, see
-- 20260617150000_fix_quote_received_trigger_column.sql), and the
-- chief approving the quote flips it to 'confirmed' or
-- 'partially_confirmed' (approveAllQuotes RPC).
--
-- What was missing: the receive-driven leg. Once items start landing
-- aboard, the board status should roll forward:
--
--   1+ item received/partial → 'partially_delivered'
--   every item finalized + ≥1 received, no shortfalls → 'delivered'
--   every item finalized + ≥1 received, some not_received/returned
--     → 'delivered_with_discrepancies'
--
-- This trigger fires on AFTER INSERT / UPDATE OF status / DELETE on
-- provisioning_items, recomputes the parent list, and writes the
-- progression if it would move the lifecycle forward. Never
-- downgrades (a manually-set 'delivered' / 'delivered_with_discrepancies'
-- stays put even if items are reopened), and never touches
-- supplier-flow statuses (draft, pending_approval, sent_to_supplier,
-- quote_received, partially_confirmed, confirmed) until at least
-- one item has actually been received — so a freshly-confirmed
-- board doesn't immediately bump itself forward before any goods
-- have landed.
--
-- Mirrors the same SECURITY DEFINER / search_path pinning the
-- quote-flow trigger uses so RLS doesn't block the recompute.
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

  -- Tally the children of the parent list.
  SELECT COUNT(*),
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

DROP TRIGGER IF EXISTS recompute_provisioning_list_delivery_status_tg
  ON public.provisioning_items;

CREATE TRIGGER recompute_provisioning_list_delivery_status_tg
  AFTER INSERT OR UPDATE OF status OR DELETE
  ON public.provisioning_items
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_provisioning_list_delivery_status();

COMMENT ON FUNCTION public.recompute_provisioning_list_delivery_status() IS
  'Auto-progresses provisioning_lists.status from receive events on
   its children. Fires on AFTER INSERT / UPDATE OF status / DELETE
   on provisioning_items. Upward-only — never downgrades a delivered
   board.';
