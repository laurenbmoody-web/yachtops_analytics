-- Item appearance (icon & colour) is read and written by the app
-- (updateItemAppearance / rowToItem / saveItem) but the columns never existed,
-- so every appearance save 400'd. Add them.
alter table public.inventory_items
  add column if not exists icon text,
  add column if not exists color text;
