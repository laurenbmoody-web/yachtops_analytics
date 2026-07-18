-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716860000_driver_status_backtrack.sql
--
-- Lets a supplier cleanly correct a mis-clicked driver step (e.g. tapped
-- "Delivered" too early) without desyncing the crew ping or the board.
--
--   1. notify_vessel_on_driver_status — only ping the crew on FORWARD driver
--      progress. Stepping back is a correction, not a new event, so it must not
--      re-notify ("your order is out for delivery" right after "delivered"
--      would be confusing).
--
--   2. cascade_board_status_from_order — also reverse a mistaken delivery: if
--      the order drops back below 'received' and the board is on plain
--      'delivered', pull the board back to match. (Item-driven delivery states
--      — partially_delivered / delivered_with_discrepancies — stay owned by the
--      item cascade and are never touched.)
--
-- The JS side (setDriverStatus) clears delivered_at + rolls supplier_orders.
-- status back to out_for_delivery when stepping back to on_the_way / arrived.
-- ─────────────────────────────────────────────────────────────────────────────

-- Monotonic rank for the internal driver's sub-status.
create or replace function public._driver_status_rank(p_status text)
returns int language sql immutable as $$
  select case p_status
    when 'assigned'   then 0
    when 'on_the_way' then 1
    when 'arrived'    then 2
    when 'delivered'  then 3
    else -1
  end;
$$;

-- ── A) Crew ping — forward progress only ────────────────────────────────────
create or replace function public.notify_vessel_on_driver_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg text;
  v_url text := '/provisioning/orders/' || new.id;
begin
  -- Only crew-facing transitions ping, and only when moving FORWARD — a
  -- backward step is a mis-click correction and must stay silent.
  if new.driver_status is null
     or new.driver_status not in ('on_the_way', 'arrived', 'delivered')
     or public._driver_status_rank(new.driver_status)
        <= public._driver_status_rank(old.driver_status) then
    return new;
  end if;

  v_msg := case new.driver_status
    when 'on_the_way' then 'Your order is out for delivery'
    when 'arrived'    then 'Your delivery has arrived'
    when 'delivered'  then 'Your order has been delivered'
  end;

  insert into public.notifications
    (user_id, type, title, message, severity, action_url, read, created_at)
  select tm.user_id,
         'delivery_update',
         coalesce(new.supplier_name, 'Your supplier'),
         v_msg,
         'info',
         v_url,
         false,
         now()
  from public.tenant_members tm
  where tm.tenant_id = new.tenant_id
    and tm.status <> 'invited'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = tm.user_id
        and n.type = 'delivery_update'
        and n.read = false
        and n.action_url = v_url
        and n.message = v_msg
    );

  return new;
exception when others then
  return new;
end;
$$;

-- ── B) Board cascade — forward, plus reverse a mistaken delivery ─────────────
create or replace function public.cascade_board_status_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target  text;
  v_current text;
begin
  if new.list_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  v_target := case new.status
    when 'sent'                then 'sent_to_supplier'
    when 'confirmed'           then 'confirmed'
    when 'partially_confirmed' then 'partially_confirmed'
    when 'picking'             then 'confirmed'
    when 'packed'              then 'confirmed'
    when 'dispatched'          then 'confirmed'
    when 'out_for_delivery'    then 'confirmed'
    when 'received'            then 'delivered'
    when 'invoiced'            then 'delivered'
    when 'paid'                then 'delivered'
    else null
  end;
  if v_target is null then
    return new;
  end if;

  select status into v_current
  from public.provisioning_lists
  where id = new.list_id;
  if v_current is null then
    return new;
  end if;

  -- Item-level delivery states are owned by recompute_provisioning_list_
  -- delivery_status — never touch them from the order side.
  if v_current in ('partially_delivered', 'delivered_with_discrepancies') then
    return new;
  end if;

  if public._board_status_rank(v_target) > public._board_status_rank(v_current) then
    -- forward
    update public.provisioning_lists set status = v_target where id = new.list_id;
  elsif v_current = 'delivered'
        and public._board_status_rank(v_target) < public._board_status_rank('delivered') then
    -- backward: a mistaken delivery was undone on the order → match it
    update public.provisioning_lists set status = v_target where id = new.list_id;
  end if;

  return new;
exception when others then
  return new;
end;
$$;
