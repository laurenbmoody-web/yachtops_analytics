-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616222000_provisioning_quote_file_upload.sql
--
-- Re-approval workflow PR 3/3.
--
-- Wires the quote-file upload path. PR 1 flips the board to
-- quote_received when a per-line `quoted_price` lands (suppliers using
-- Cargo); this slice covers the manual case — supplier emails a PDF
-- or returns a written quote that gets attached to the board.
--
-- Schema:
--   * provisioning_lists.quote_file_url      text        — public URL
--   * provisioning_lists.quote_file_uploaded_at  timestamptz
--   * provisioning_lists.quote_file_uploaded_by  uuid → auth.users
--
-- RPC:
--   record_provisioning_quote_file(p_list_id, p_file_url, p_filename)
--   * Verifies caller is an active tenant member of the board's vessel.
--   * Sets the three new columns + updated_at = now().
--   * Flips status to quote_received IFF currently sent_to_supplier.
--   * Idempotent — overwriting an existing quote file is allowed
--     (supplier sends a revised PDF), and only the first transition
--     flips the status (we don't pull a delivered board back).
--
-- IDEMPOTENT throughout.
-- ─────────────────────────────────────────────────────────────────────────────


ALTER TABLE public.provisioning_lists
  ADD COLUMN IF NOT EXISTS quote_file_url           text,
  ADD COLUMN IF NOT EXISTS quote_file_uploaded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS quote_file_uploaded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_file_name          text;

COMMENT ON COLUMN public.provisioning_lists.quote_file_url IS
  'Public URL to the supplier quote artifact (PDF / image) stored in
   the provisioning-invoices bucket under quotes/<list_id>/...';


CREATE OR REPLACE FUNCTION public.record_provisioning_quote_file(
  p_list_id   uuid,
  p_file_url  text,
  p_filename  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_tenant_id       uuid;
  v_current_status  text;
  v_new_status      text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_list_id IS NULL OR p_file_url IS NULL OR length(btrim(p_file_url)) = 0 THEN
    RAISE EXCEPTION 'list_id and file_url are both required';
  END IF;

  SELECT pl.tenant_id, pl.status INTO v_tenant_id, v_current_status
  FROM public.provisioning_lists pl
  WHERE pl.id = p_list_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Provisioning list % not found', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = v_uid
      AND tm.tenant_id = v_tenant_id
      AND tm.active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'You are not an active member of this vessel.';
  END IF;

  -- Flip to quote_received only if currently sent_to_supplier.
  -- Boards already past that point (partially_delivered, delivered,
  -- discrepancies) don't get pulled back; boards at draft /
  -- pending_approval / quote_received keep their current status.
  v_new_status := CASE
    WHEN v_current_status = 'sent_to_supplier' THEN 'quote_received'
    ELSE v_current_status
  END;

  UPDATE public.provisioning_lists
     SET quote_file_url         = p_file_url,
         quote_file_uploaded_at = now(),
         quote_file_uploaded_by = v_uid,
         quote_file_name        = NULLIF(btrim(p_filename), ''),
         status                 = v_new_status,
         updated_at             = now()
   WHERE id = p_list_id;

  RETURN jsonb_build_object(
    'list_id',     p_list_id,
    'status',      v_new_status,
    'prev_status', v_current_status,
    'flipped',     v_current_status <> v_new_status
  );
END;
$function$;

COMMENT ON FUNCTION public.record_provisioning_quote_file(uuid, text, text) IS
  'Attaches a supplier quote file URL to a provisioning_lists row and
   flips status to quote_received iff the board is currently
   sent_to_supplier. Idempotent — supports replacing an existing quote
   PDF with a revised one without regressing the lifecycle.';

GRANT EXECUTE ON FUNCTION public.record_provisioning_quote_file(uuid, text, text)
  TO authenticated;
