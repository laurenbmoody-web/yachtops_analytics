-- Extended, free-form attributes for a wardrobe garment record (owner/guest
-- world). Core columns (description = item name, colour, garment_type,
-- garment_value, tags = care, wardrobe_id, owner, notes, photos) stay as-is;
-- this holds the richer descriptive fields a high-value wardrobe wants —
-- brand, sku, size, material, a long description, condition, season, purchase
-- provenance, monogram — without a wide column-per-attribute schema.
alter table public.laundry_items
  add column if not exists details jsonb not null default '{}'::jsonb;
