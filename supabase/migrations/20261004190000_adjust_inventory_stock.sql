-- Offline-safe stock counting (+/- buttons).
--
-- The inventory screens used to write the whole new stock array ("Bar fridge:
-- 6"). Recorded offline and synced hours later, that overwrites whatever other
-- crew counted meanwhile. adjust_inventory_stock applies a *change* instead
-- ("Bar fridge: +1") atomically on the current row, so offline taps from
-- several phones add up.
--
-- p_op_id makes a replay harmless: the app's outbox may resend an op whose
-- response was lost; an op id already applied is skipped.
--
-- Size-tracked items (variants) are refused: their stock changes per size.
--
-- The stock entry is found by its vessel location id; entries without one fall
-- back to the position + name the device saw (or, for deliveries, the name in
-- any case). A delivery to a place the item isn't stocked yet passes p_create
-- (the new entry) and it is added. Items with no stock locations — or a change
-- given no location at all (unplaced stock) — adjust the totals directly. Runs as the caller, so the usual inventory_items
-- UPDATE policy decides who may count.

create table if not exists public.inventory_stock_ops (
  op_id      text not null,
  user_id    uuid not null default auth.uid(),
  item_id    uuid not null,
  delta      numeric not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

alter table public.inventory_stock_ops enable row level security;

drop policy if exists inventory_stock_ops_own on public.inventory_stock_ops;
create policy inventory_stock_ops_own on public.inventory_stock_ops
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists inventory_stock_ops_applied_at on public.inventory_stock_ops (applied_at);

-- (An early 6-argument draft may exist on some databases: retire it.)
drop function if exists public.adjust_inventory_stock(uuid, numeric, text, int, text, text);

-- Every argument is passed on every call (no defaults), so PostgREST always
-- resolves this exact function.

create or replace function public.adjust_inventory_stock(
  p_item_id        uuid,
  p_delta          numeric,
  p_location_id    text,
  p_location_index int,
  p_location_name  text,
  p_op_id          text,
  p_create         jsonb
) returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_locs  jsonb;
  v_qty   numeric;
  v_total_old numeric;
  v_idx   int := null;
  v_entry jsonb;
  v_new   numeric;
  v_total numeric;
  i       int;
begin
  if p_op_id is not null then
    insert into public.inventory_stock_ops (op_id, item_id, delta)
    values (p_op_id, p_item_id, p_delta)
    on conflict do nothing;
    if not found then
      select total_qty into v_total from public.inventory_items where id = p_item_id;
      return v_total;  -- already applied
    end if;
  end if;

  select coalesce(stock_locations, '[]'::jsonb), coalesce(quantity, 0), coalesce(total_qty, quantity, 0)
    into v_locs, v_qty, v_total_old
    from public.inventory_items
   where id = p_item_id
   for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  -- Size-tracked items keep a per-size breakdown a flat change would corrupt.
  if exists (select 1 from public.inventory_items
              where id = p_item_id
                and (coalesce(has_variants, false)
                     or (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) > 0))) then
    raise exception 'This item is tracked by size — change its stock per size' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_locs) <> 'array' then v_locs := '[]'::jsonb; end if;

  -- No stock locations, or unplaced stock: the totals only.
  if (jsonb_array_length(v_locs) = 0 and p_create is null)
     or (coalesce(p_location_id, '') = '' and p_location_index is null
         and coalesce(p_location_name, '') = '' and p_create is null) then
    v_total := greatest(0, v_total_old + p_delta);
    update public.inventory_items
       set quantity = v_total, total_qty = v_total,
           updated_at = now(), updated_by = auth.uid()
     where id = p_item_id;
    if not found then raise exception 'Not allowed to update this item' using errcode = '42501'; end if;
    return v_total;
  end if;

  -- 1. by location id
  if coalesce(p_location_id, '') <> '' then
    for i in 0 .. jsonb_array_length(v_locs) - 1 loop
      v_entry := v_locs -> i;
      if coalesce(v_entry ->> 'vesselLocationId', v_entry ->> 'locationId', '') = p_location_id then
        v_idx := i; exit;
      end if;
    end loop;
  end if;
  -- 2. by the position the device saw, if the name still matches there
  if v_idx is null and p_location_index is not null
     and p_location_index >= 0 and p_location_index < jsonb_array_length(v_locs) then
    v_entry := v_locs -> p_location_index;
    if coalesce(v_entry ->> 'locationName', v_entry ->> 'location_name', v_entry ->> 'name', '')
       = coalesce(p_location_name, '') then
      v_idx := p_location_index;
    end if;
  end if;
  -- 3. first entry with that name (any case)
  if v_idx is null and coalesce(p_location_name, '') <> '' then
    for i in 0 .. jsonb_array_length(v_locs) - 1 loop
      v_entry := v_locs -> i;
      if lower(coalesce(v_entry ->> 'locationName', v_entry ->> 'location_name', v_entry ->> 'name', '')) = lower(p_location_name) then
        v_idx := i; exit;
      end if;
    end loop;
  end if;

  if v_idx is null then
    if p_create is null then
      raise exception 'That stock location no longer exists on this item' using errcode = 'P0002';
    end if;
    v_new := greatest(0, p_delta);
    v_locs := v_locs || jsonb_build_array(jsonb_set(p_create, '{qty}', to_jsonb(v_new)));
  else
    v_entry := v_locs -> v_idx;
    v_new := greatest(0, coalesce((v_entry ->> 'qty')::numeric, (v_entry ->> 'quantity')::numeric, 0) + p_delta);
    v_entry := jsonb_set(v_entry, '{qty}', to_jsonb(v_new));
    if v_entry ? 'quantity' then v_entry := jsonb_set(v_entry, '{quantity}', to_jsonb(v_new)); end if;
    v_locs := jsonb_set(v_locs, array[v_idx::text], v_entry);
  end if;

  select coalesce(sum(coalesce((e ->> 'qty')::numeric, (e ->> 'quantity')::numeric, 0)), 0)
    into v_total
    from jsonb_array_elements(v_locs) e;

  update public.inventory_items
     set stock_locations = v_locs, quantity = v_total, total_qty = v_total,
         updated_at = now(), updated_by = auth.uid()
   where id = p_item_id;
  if not found then raise exception 'Not allowed to update this item' using errcode = '42501'; end if;
  return v_total;
end;
$$;

revoke all on function public.adjust_inventory_stock(uuid, numeric, text, int, text, text, jsonb) from public, anon;
grant execute on function public.adjust_inventory_stock(uuid, numeric, text, int, text, text, jsonb) to authenticated;
