-- Step 4 of private threads: accepting a quote in a chat routes the items to
-- an ORDER OF THE CREW MEMBER'S CHOOSING — a brand-new order, or an existing
-- OPEN order they own or collaborate on. The chat itself never converts.
--
--   * accept_supplier_quote gains an optional p_order_id. Null → make a new
--     order (unchanged). Non-null → add into that order, after checking it's on
--     this vessel, with this supplier, still open, and the caller owns or has
--     edit/approve collaborator rights on its board.
--   * fetch_addable_orders lists the open orders a crew member may add to for a
--     given supplier, to populate the picker.
--
-- "Open" = still being assembled (draft / sent / confirmed / partially_confirmed);
-- once an order is dispatched / out for delivery / received / invoiced / paid it
-- is closed to new lines.

-- The old single-arg version is replaced by the 2-arg one below.
drop function if exists public.accept_supplier_quote(uuid);

create or replace function public.accept_supplier_quote(
  p_message_id uuid,
  p_order_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread    uuid;
  v_kind      text;
  v_status    text;
  v_quote     jsonb;
  v_expires   timestamptz;
  v_tenant    uuid;
  v_order     uuid;
  v_supplier  uuid;
  v_sname     text;
  v_cur       text;
  v_list      uuid;
  v_item      jsonb;
  v_price     numeric;
  v_commit    boolean;
  v_qty       numeric;
  v_name      text;
  v_unit      text;
  v_n         integer := 0;
  v_short     text;
  v_new_order boolean := false;
  v_uid       uuid := auth.uid();
  v_dept      uuid;
  v_total     numeric := 0;
  v_threshold numeric;
  v_gated     boolean := false;
  -- existing-order validation
  v_o_tenant   uuid;
  v_o_supplier uuid;
  v_o_status   text;
  v_o_creator  uuid;
begin
  select m.thread_id, m.kind, m.quote_status, m.quote, m.quote_expires_at
    into v_thread, v_kind, v_status, v_quote, v_expires
  from public.supplier_messages m
  where m.id = p_message_id;

  if v_thread is null then raise exception 'message not found'; end if;
  if v_kind <> 'quote' then raise exception 'not a quote'; end if;
  if coalesce(v_status, 'pending') <> 'pending' then raise exception 'quote already resolved'; end if;
  if v_expires is not null and v_expires < now() then raise exception 'quote expired'; end if;

  select t.tenant_id, t.supplier_id
    into v_tenant, v_supplier
  from public.supplier_message_threads t
  where t.id = v_thread;

  -- The caller must be a participant of this thread.
  if not public.is_thread_participant(v_thread, v_uid) then
    raise exception 'not authorized';
  end if;

  select department_id into v_dept
  from public.tenant_members
  where tenant_id = v_tenant and user_id = v_uid
  limit 1;

  select coalesce(sum((value->>'unit_price')::numeric * coalesce((value->>'qty')::numeric, 1)), 0)
    into v_total
  from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) as value
  where value->>'unit_price' is not null;

  select coalesce(v.defect_quote_signoff_threshold, 1000) into v_threshold
  from public.vessels v where v.tenant_id = v_tenant;
  v_gated := v_total >= coalesce(v_threshold, 1000);

  -- ── Route: an existing order the caller chose, or a fresh one ──────────────
  if p_order_id is not null then
    select so.tenant_id, so.supplier_profile_id, so.status, so.created_by, so.list_id
      into v_o_tenant, v_o_supplier, v_o_status, v_o_creator, v_list
    from public.supplier_orders so
    where so.id = p_order_id;

    if v_o_tenant is null then raise exception 'order not found'; end if;
    if v_o_tenant <> v_tenant then raise exception 'order is on a different vessel'; end if;
    if v_o_supplier is distinct from v_supplier then raise exception 'order is with a different supplier'; end if;
    if coalesce(v_o_status, '') not in ('draft', 'sent', 'confirmed', 'partially_confirmed') then
      raise exception 'that order is closed to new items';
    end if;
    if not (
      v_o_creator = v_uid
      or exists (select 1 from public.provisioning_lists pl where pl.id = v_list and pl.owner_id = v_uid)
      or public.provisioning_list_collab_perm(v_list, v_uid) in ('edit', 'approve')
    ) then
      raise exception 'not your order to add to';
    end if;

    v_order := p_order_id;
  else
    select name into v_sname from public.supplier_profiles where id = v_supplier;
    v_cur := coalesce(nullif(v_quote->>'currency', ''), 'EUR');

    insert into public.provisioning_lists
      (tenant_id, title, status, currency, created_by, owner_id, visibility, department_id, is_private)
    values
      (v_tenant, coalesce(v_sname, 'Supplier'), 'draft', v_cur,
       v_uid, v_uid, 'department', v_dept, false)
    returning id into v_list;

    insert into public.supplier_orders
      (tenant_id, list_id, supplier_name, supplier_profile_id, currency, status, created_by, approval_status)
    values
      (v_tenant, v_list, coalesce(v_sname, 'Supplier'), v_supplier, v_cur,
       case when v_gated then 'draft' else 'confirmed' end, v_uid,
       case when v_gated then 'pending' else null end)
    returning id into v_order;

    v_new_order := true;
  end if;

  select currency, list_id into v_cur, v_list from public.supplier_orders where id = v_order;

  for v_item in select value from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) as value
  loop
    v_price := (v_item->>'unit_price')::numeric;
    v_qty   := coalesce((v_item->>'qty')::numeric, 1);
    v_name  := coalesce(nullif(v_item->>'name', ''), 'Item');
    v_unit  := nullif(v_item->>'unit', '');
    v_commit := (v_price is not null) and not v_gated;

    -- Order line: always its own line (agreed lines are immutable — never bump
    -- a confirmed line's quantity, the guard forbids it).
    if v_commit then
      insert into public.supplier_order_items
        (order_id, item_name, quantity, unit, status,
         estimated_price, estimated_currency, quoted_price, quoted_currency, quoted_at,
         agreed_price, agreed_currency, agreed_at, quote_status)
      values (v_order, v_name, v_qty, v_unit, 'confirmed',
              v_price, v_cur, v_price, v_cur, now(), v_price, v_cur, now(), 'agreed');
    else
      insert into public.supplier_order_items
        (order_id, item_name, quantity, unit, status, estimated_price, estimated_currency, quote_status)
      values (v_order, v_name, v_qty, v_unit, 'pending', v_price, v_cur, 'awaiting_quote');
    end if;

    -- Board line: MERGE quantities so the crew see one consolidated line. A
    -- gated (held) item stays off the board until sign-off.
    if v_list is not null and (v_commit or not v_gated) then
      update public.provisioning_items
         set quantity_ordered = coalesce(quantity_ordered, 0) + v_qty
       where list_id = v_list and source = 'manual'
         and status = case when v_commit then 'ordered' else 'draft' end
         and lower(coalesce(name, '')) = lower(v_name)
         and coalesce(unit, '') = coalesce(v_unit, '')
         and estimated_unit_cost is not distinct from v_price;
      if not found then
        insert into public.provisioning_items
          (list_id, name, quantity_ordered, unit, estimated_unit_cost, source, status, notes)
        values (v_list, v_name, v_qty, v_unit, v_price, 'manual',
                case when v_commit then 'ordered' else 'draft' end,
                'Added from a supplier chat quote');
      end if;
    end if;

    v_n := v_n + 1;
  end loop;

  -- Adding an over-threshold batch to an existing order re-opens sign-off.
  if v_gated and not v_new_order then
    update public.supplier_orders set approval_status = 'pending' where id = v_order;
  end if;

  update public.supplier_messages
     set quote_status = 'accepted', quote_order_id = v_order,
         quote_resolved_at = now(), quote_resolved_by = v_uid
   where id = p_message_id;

  v_short := upper(substr(v_order::text, 1, 8));
  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'vessel', v_uid,
          case when v_gated
            then 'Quote accepted — pending sign-off before it''s ordered (over the vessel''s spend limit).'
            else v_n || ' item' || (case when v_n = 1 then '' else 's' end)
                   || ' added to Order #' || v_short || ' and your provisioning board'
          end, 'system');

  return v_order;
end $$;

grant execute on function public.accept_supplier_quote(uuid, uuid) to authenticated;

-- The open orders a crew member may add a chat quote to, for one supplier:
-- their own or ones they collaborate on (edit/approve), still open. SECURITY
-- DEFINER so it can read across the board/collaborator tables uniformly; the
-- caller identity (auth.uid()) still scopes the results.
create or replace function public.fetch_addable_orders(
  p_supplier_id uuid,
  p_tenant_id   uuid
)
returns table (
  order_id   uuid,
  short_id   text,
  title      text,
  status     text,
  item_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select so.id,
         upper(substr(so.id::text, 1, 8)),
         coalesce(nullif(pl.title, ''), so.supplier_name),
         so.status,
         (select count(*) from public.supplier_order_items si where si.order_id = so.id)::int,
         so.created_at
  from public.supplier_orders so
  left join public.provisioning_lists pl on pl.id = so.list_id
  where so.tenant_id = p_tenant_id
    and so.supplier_profile_id = p_supplier_id
    and coalesce(so.status, '') in ('draft', 'sent', 'confirmed', 'partially_confirmed')
    and (
      so.created_by = auth.uid()
      or pl.owner_id = auth.uid()
      or public.provisioning_list_collab_perm(so.list_id, auth.uid()) in ('edit', 'approve')
    )
  order by so.created_at desc
$$;

grant execute on function public.fetch_addable_orders(uuid, uuid) to authenticated;
