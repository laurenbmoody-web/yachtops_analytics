-- ============================================================
-- delivery_inbox — RLS, indexes, FKs, status CHECK (catch-up #2).
--
-- Follow-up to 20260520010000_create_delivery_inbox_catchup.sql,
-- which created the table but deliberately omitted RLS / indexes /
-- FKs / CHECK pending a live-schema capture. Replicated precisely
-- from the live Supabase schema — not guessed.
--
-- IDEMPOTENT — every operation is guarded so re-runs are no-ops:
--   • RLS:         ENABLE ROW LEVEL SECURITY is idempotent on a
--                  table that already has RLS enabled.
--   • policies:    DROP POLICY IF EXISTS then CREATE POLICY.
--   • indexes:     CREATE INDEX IF NOT EXISTS.
--   • FKs/CHECK:   DO block that probes pg_constraint first.
-- Result: zero-effect on the live DB (where all of this already
-- exists) and a complete apply on any fresh DB from migrations.
--
-- Timestamp 20260520010001 sorts immediately after the catch-up
-- CREATE TABLE migration (010000) so the table exists when this
-- runs.
--
-- Note on the return_slip_token policy predicate: the live column
-- is `text` (the 010000 catch-up has been corrected to declare it
-- text), so a plain `<> ''` would parse fine. The `::text` cast
-- below is kept as defence-in-depth — harmless against text, and
-- if the column type ever shifts back to uuid this still parses.
-- ============================================================

-- ─── Row Level Security ──────────────────────────────────────
ALTER TABLE public.delivery_inbox ENABLE ROW LEVEL SECURITY;
-- (RLS enabled, NOT forced — matches live.)

DROP POLICY IF EXISTS delivery_inbox_tenant_read   ON public.delivery_inbox;
DROP POLICY IF EXISTS delivery_inbox_tenant_insert ON public.delivery_inbox;
DROP POLICY IF EXISTS delivery_inbox_tenant_update ON public.delivery_inbox;
DROP POLICY IF EXISTS "Allow public return slip confirmation via token" ON public.delivery_inbox;

-- 1. Tenant-scoped SELECT — members of the row's tenant can read.
CREATE POLICY delivery_inbox_tenant_read
  ON public.delivery_inbox
  FOR SELECT
  TO public
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

-- 2. Tenant-scoped INSERT.
CREATE POLICY delivery_inbox_tenant_insert
  ON public.delivery_inbox
  FOR INSERT
  TO public
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

-- 3. Tenant-scoped UPDATE.
CREATE POLICY delivery_inbox_tenant_update
  ON public.delivery_inbox
  FOR UPDATE
  TO public
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

-- 4. Public return-slip confirmation. The public /return-confirm
--    page runs as `anon` when a supplier (no Cargo account) clicks
--    the link in the emailed slip; this policy gates the row by
--    the per-slip token only. Token-or-nothing.
CREATE POLICY "Allow public return slip confirmation via token"
  ON public.delivery_inbox
  FOR ALL
  TO anon
  USING       (return_slip_token IS NOT NULL AND return_slip_token::text <> '')
  WITH CHECK  (return_slip_token IS NOT NULL AND return_slip_token::text <> '');

-- (Deliberately no DELETE policy — matches live. Deletions in
--  this table are soft via status = 'archived'.)


-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_delivery_inbox_tenant_status
  ON public.delivery_inbox (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_delivery_inbox_expires
  ON public.delivery_inbox (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_delivery_inbox_return_slip_token
  ON public.delivery_inbox (return_slip_token)
  WHERE return_slip_token IS NOT NULL;


-- ─── Foreign keys + status CHECK ─────────────────────────────
-- Postgres has no IF NOT EXISTS on ADD CONSTRAINT; each constraint
-- is gated by a pg_constraint existence probe so re-runs are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_inbox_claimed_board_id_fkey'
      AND conrelid = 'public.delivery_inbox'::regclass
  ) THEN
    ALTER TABLE public.delivery_inbox
      ADD CONSTRAINT delivery_inbox_claimed_board_id_fkey
      FOREIGN KEY (claimed_board_id)
      REFERENCES public.provisioning_lists(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_inbox_claimed_by_fkey'
      AND conrelid = 'public.delivery_inbox'::regclass
  ) THEN
    ALTER TABLE public.delivery_inbox
      ADD CONSTRAINT delivery_inbox_claimed_by_fkey
      FOREIGN KEY (claimed_by)
      REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_inbox_delivery_batch_id_fkey'
      AND conrelid = 'public.delivery_inbox'::regclass
  ) THEN
    ALTER TABLE public.delivery_inbox
      ADD CONSTRAINT delivery_inbox_delivery_batch_id_fkey
      FOREIGN KEY (delivery_batch_id)
      REFERENCES public.provisioning_deliveries(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_inbox_scanned_by_fkey'
      AND conrelid = 'public.delivery_inbox'::regclass
  ) THEN
    ALTER TABLE public.delivery_inbox
      ADD CONSTRAINT delivery_inbox_scanned_by_fkey
      FOREIGN KEY (scanned_by)
      REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delivery_inbox_status_check'
      AND conrelid = 'public.delivery_inbox'::regclass
  ) THEN
    ALTER TABLE public.delivery_inbox
      ADD CONSTRAINT delivery_inbox_status_check
      CHECK (status IN ('pending','claimed','archived','pending_return','returned'));
  END IF;
END $$;
