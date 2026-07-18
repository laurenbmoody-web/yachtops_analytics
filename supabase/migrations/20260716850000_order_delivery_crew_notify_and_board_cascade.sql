-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716850000_order_delivery_crew_notify_and_board_cascade.sql
--
-- Two order-side triggers, both keyed off supplier_orders (which carries
-- tenant_id + list_id on the row, so neither needs the messaging thread):
--
--   A. notify_vessel_on_driver_status — when an internal driver advances to
--      on_the_way / arrived / delivered, ping every crew member of the vessel
--      (bell notification deep-linking to the order). Threads are now private
--      per-person DMs, so a thread re-post is unreliable; a direct
--      notifications fan-out (the notify_vessel_on_supplier_message pattern) is
--      the robust path.
--
--   B. cascade_board_status_from_order — advance the linked provisioning board
--      (provisioning_lists.status) forward as the order progresses. Board
--      status previously only moved via the vessel's own Send/Receive UI or via
--      provisioning_items changes, so an order driven entirely supplier-side
--      (confirmed → dispatched → out_for_delivery → received) left its board
--      stuck on 'draft'. Forward-only, and it never overrides the item-level
--      delivery cascade (partially_delivered / delivered_with_discrepancies /
--      delivered stay owned by recompute_provisioning_list_delivery_status).
-- ─────────────────────────────────────────────────────────────────────────────

-- Monotonic rank for the provisioning board lifecycle (forward-only guard).
create or replace function public._board_status_rank(p_status text)
returns int language sql immutable as $$
  select case p_status
    when 'draft'                        then 0
    when 'pending_approval'             then 1
    when 'sent_to_supplier'             then 2
    when 'quote_received'               then 3
    when 'confirmed'                    then 4
    when 'partially_confirmed'          then 4
    when 'partially_delivered'          then 5
    when 'delivered_with_discrepancies' then 6
    when 'delivered'                    then 6
    else -1
  end;
$$;

-- ── A) Crew notification on driver progress ─────────────────────────────────
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
  -- Only the crew-facing transitions ping; 'assigned' is internal-only.
  if new.driver_status is null
     or new.driver_status not in ('on_the_way', 'arrived', 'delivered')
     or new.driver_status is not distinct from old.driver_status then
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
      -- one unread bell per order per distinct status
      select 1 from public.notifications n
      where n.user_id = tm.user_id
        and n.type = 'delivery_update'
        and n.read = false
        and n.action_url = v_url
        and n.message = v_msg
    );

  return new;
exception when others then
  return new;  -- best-effort; a notify failure must never break the status write
end;
$$;

drop trigger if exists trg_notify_vessel_on_driver_status on public.supplier_orders;
create trigger trg_notify_vessel_on_driver_status
  after update of driver_status on public.supplier_orders
  for each row execute function public.notify_vessel_on_driver_status();

-- ── B) Board status cascade as the order progresses ─────────────────────────
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

  -- Order status → board status. In-transit order stages (picking/packed/
  -- dispatched/out_for_delivery) have no board equivalent, so the board holds
  -- at 'confirmed' until the order is received.
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

  -- Never override the item-level delivery cascade once it has taken over.
  if v_current in ('partially_delivered', 'delivered_with_discrepancies', 'delivered') then
    return new;
  end if;

  -- Forward-only.
  if public._board_status_rank(v_target) <= public._board_status_rank(v_current) then
    return new;
  end if;

  update public.provisioning_lists
    set status = v_target
    where id = new.list_id;

  return new;
exception when others then
  return new;  -- best-effort; never break the order status write
end;
$$;

drop trigger if exists trg_cascade_board_status_from_order on public.supplier_orders;
create trigger trg_cascade_board_status_from_order
  after insert or update of status on public.supplier_orders
  for each row execute function public.cascade_board_status_from_order();
