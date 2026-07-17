-- Extend the spend sign-off gate to additions to an existing order.
--
-- 20260716530000 only gated the auto-created (General-chat) order. But accepting
-- an over-threshold quote into an ALREADY-confirmed order commits that spend too,
-- so it must gate the same way: the newly-added lines are held un-ordered and the
-- order is flagged approval_status='pending' until a Captain/HOD signs it off
-- (decide_supplier_order_approval, unchanged, then commits the held lines).
--
-- Threshold is the accepted quote's own total (the incremental spend), matching
-- how the crew think about "adding more over £1000".

create or replace function public.accept_supplier_quote(p_message_id uuid)
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
  v_confirmed boolean;
  v_n         integer := 0;
  v_short     text;
  v_new_order boolean := false;
  v_was_general boolean := false;
  v_other_pending integer := 0;
  v_uid       uuid := auth.uid();
  v_dept      uuid;
  v_total     numeric := 0;
  v_threshold numeric;
  v_gated     boolean := false;
begin
  select m.thread_id, m.kind, m.quote_status, m.quote, m.quote_expires_at
    into v_thread, v_kind, v_status, v_quote, v_expires
  from public.supplier_messages m
  where m.id = p_message_id;

  if v_thread is null then raise exception 'message not found'; end if;
  if v_kind <> 'quote' then raise exception 'not a quote'; end if;
  if coalesce(v_status, 'pending') <> 'pending' then raise exception 'quote already resolved'; end if;
  if v_expires is not null and v_expires < now() then raise exception 'quote expired'; end if;

  select t.tenant_id, t.order_id, t.supplier_id
    into v_tenant, v_order, v_supplier
  from public.supplier_message_threads t
  where t.id = v_thread;

  v_was_general := v_order is null;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = v_uid and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  select department_id into v_dept
  from public.tenant_members
  where tenant_id = v_tenant and user_id = v_uid
  limit 1;

  -- Priced total of THIS quote, and whether that spend needs sign-off. Applies
  -- whether the quote makes a new order or adds to an existing one.
  select coalesce(sum((value->>'unit_price')::numeric * coalesce((value->>'qty')::numeric, 1)), 0)
    into v_total
  from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) as value
  where value->>'unit_price' is not null;

  select coalesce(v.defect_quote_signoff_threshold, 1000) into v_threshold
  from public.vessels v where v.tenant_id = v_tenant;
  v_gated := v_total >= coalesce(v_threshold, 1000);

  if v_order is null then
    select name into v_sname from public.supplier_profiles where id = v_supplier;
    v_cur := coalesce(nullif(v_quote->>'currency', ''), 'EUR');

    insert into public.provisioning_lists
      (tenant_id, title, status, currency, created_by, owner_id, visibility, department_id, is_private)
    values
      (v_tenant, coalesce(v_sname, 'Supplier'), 'draft', v_cur,
       v_uid, v_uid, 'department', v_dept, false)
    returning id into v_list;

    insert into public.supplier_orders
      (tenant_id, list_id, supplier_name, supplier_profile_id, currency, status, created_by,
       approval_status)
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
    v_price     := (v_item->>'unit_price')::numeric;
    -- A gated quote holds its lines un-ordered until sign-off.
    v_confirmed := (v_price is not null) and not v_gated;

    insert into public.supplier_order_items
      (order_id, item_name, quantity, unit, status,
       estimated_price, estimated_currency,
       quoted_price, quoted_currency, quoted_at,
       agreed_price, agreed_currency, agreed_at,
       quote_status)
    values (
      v_order,
      coalesce(nullif(v_item->>'name', ''), 'Item'),
      coalesce((v_item->>'qty')::numeric, 1),
      nullif(v_item->>'unit', ''),
      case when v_confirmed then 'confirmed' else 'pending' end,
      v_price, v_cur,
      case when v_confirmed then v_price else null end,
      case when v_confirmed then v_cur   else null end,
      case when v_confirmed then now()   else null end,
      case when v_confirmed then v_price else null end,
      case when v_confirmed then v_cur   else null end,
      case when v_confirmed then now()   else null end,
      case when v_confirmed then 'agreed' else 'awaiting_quote' end
    );

    if v_list is not null then
      insert into public.provisioning_items
        (list_id, name, quantity_ordered, unit, estimated_unit_cost, source, status, notes)
      values (
        v_list,
        coalesce(nullif(v_item->>'name', ''), 'Item'),
        coalesce((v_item->>'qty')::numeric, 1),
        nullif(v_item->>'unit', ''),
        v_price,
        'manual',
        case when v_confirmed then 'ordered' else 'draft' end,
        'Added from a supplier chat quote'
      );
    end if;

    v_n := v_n + 1;
  end loop;

  -- Adding over-threshold spend to an existing order re-flags it for sign-off
  -- (the held lines above wait until it's approved).
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

  if v_new_order and v_was_general then
    begin
      select count(*) into v_other_pending
      from public.supplier_messages
      where thread_id = v_thread and kind = 'quote'
        and id <> p_message_id
        and coalesce(quote_status, 'pending') = 'pending';

      if v_other_pending = 0 then
        update public.supplier_message_threads set order_id = v_order where id = v_thread;

        if not exists (
          select 1 from public.supplier_message_threads
          where supplier_id = v_supplier and tenant_id = v_tenant and order_id is null
        ) then
          insert into public.supplier_message_threads (supplier_id, tenant_id, order_id)
          values (v_supplier, v_tenant, null);
        end if;
      end if;
    exception when others then
      null;
    end;
  end if;

  return v_order;
end $$;

grant execute on function public.accept_supplier_quote(uuid) to authenticated;
