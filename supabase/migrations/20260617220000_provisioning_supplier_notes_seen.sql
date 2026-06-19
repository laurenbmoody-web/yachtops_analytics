-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617220000_provisioning_supplier_notes_seen.sql
--
-- Tracks per-user acknowledgement of the "Note from supplier" chip on
-- the provisioning board detail page. Chip pulses while there's
-- unseen supplier-side activity (substitution / unavailable / note);
-- click marks it seen for THIS user only so multi-chief boats still
-- pulse for the other crew until each member acks individually.
--
-- One row per (user, list). Upserted by markSupplierNotesSeen() on
-- chip click; SELECTed by the chip-pulse predicate.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provisioning_supplier_notes_seen (
  user_id  uuid        NOT NULL REFERENCES auth.users(id)              ON DELETE CASCADE,
  list_id  uuid        NOT NULL REFERENCES public.provisioning_lists(id) ON DELETE CASCADE,
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, list_id)
);

ALTER TABLE public.provisioning_supplier_notes_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_reads_own_supplier_notes_seen"
  ON public.provisioning_supplier_notes_seen;
CREATE POLICY "user_reads_own_supplier_notes_seen"
  ON public.provisioning_supplier_notes_seen
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_writes_own_supplier_notes_seen"
  ON public.provisioning_supplier_notes_seen;
CREATE POLICY "user_writes_own_supplier_notes_seen"
  ON public.provisioning_supplier_notes_seen
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_updates_own_supplier_notes_seen"
  ON public.provisioning_supplier_notes_seen;
CREATE POLICY "user_updates_own_supplier_notes_seen"
  ON public.provisioning_supplier_notes_seen
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.provisioning_supplier_notes_seen IS
  'Per-user acknowledgement of the supplier-notes chip on a
   provisioning board. seen_at = the moment this user clicked the chip
   to read the supplier popover. Compared against the max
   supplier_order_items.updated_at across the board to decide whether
   the chip pulses for this user.';
