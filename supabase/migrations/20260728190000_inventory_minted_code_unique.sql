-- Guarantee that a generated ("Create QR") code is unique per tenant, so no two
-- items can share a minted Cargo code. Minted codes carry the 'CGO-' prefix;
-- scanned manufacturer barcodes are left alone (they may legitimately repeat),
-- so the uniqueness is scoped to minted codes only via a partial index.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_minted_code_uniq
  ON public.inventory_items (tenant_id, barcode)
  WHERE barcode LIKE 'CGO-%';
