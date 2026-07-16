-- Accepting a chat quote with no order yet now MINTS a board + order for the
-- vessel, so a request that started purely in chat (e.g. an item not in the
-- supplier's catalogue) becomes a trackable order + provisioning board end to
-- end — instead of erroring 'no_order'. Priced lines still land confirmed and
-- mirror onto the board; unpriced lines stay awaiting a price. Replaces
-- accept_supplier_quote from 20260715163000.

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
begin
  select m.thread_id, m.kind, m.quote_status, m.quote
    into v_thread, v_kind, v_status, v_quote
  from public.supplier_messages m
  where m.id = p_message_id;

  if v_thread is null then raise exception 'message not found'; end if;
  if v_kind <> 'quote' then raise exception 'not a quote'; end if;
  if coalesce(v_status, 'pending') <> 'pending' then raise exception 'quote already resolved'; end if;

  select t.tenant_id, t.order_id, t.supplier_id
    into v_tenant, v_order, v_supplier
  from public.supplier_message_threads t
  where t.id = v_thread;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = auth.uid() and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  -- Attach to the thread's order, else the vessel's most recent order …
  if v_order is null then
    select o.id into v_order
    from public.supplier_orders o
    where o.tenant_id = v_tenant and o.supplier_profile_id = v_supplier
    order by o.created_at desc
    limit 1;
  end if;

  -- … and if there's still no order, mint a board + order from this chat.
  if v_order is null then
    select name into v_sname from public.supplier_profiles where id = v_supplier;
    v_cur := coalesce(nullif(v_quote->>'currency', ''), 'EUR');

    insert into public.provisioning_lists (tenant_id, title, status, currency, created_by)
    values (v_tenant, coalesce(v_sname, 'Supplier') || ' — chat request', 'draft', v_cur, auth.uid())
    returning id into v_list;

    insert into public.supplier_orders
      (tenant_id, list_id, supplier_name, supplier_profile_id, currency, status, created_by)
    values
      (v_tenant, v_list, coalesce(v_sname, 'Supplier'), v_supplier, v_cur, 'confirmed', auth.uid())
    returning id into v_order;
  end if;

  select currency, list_id into v_cur, v_list from public.supplier_orders where id = v_order;

  for v_item in select value from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) as value
  loop
    v_price     := (v_item->>'unit_price')::numeric;
    v_confirmed := v_price is not null;

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
        'pending',
        'Added from a supplier chat quote'
      );
    end if;

    v_n := v_n + 1;
  end loop;

  update public.supplier_messages
     set quote_status = 'accepted', quote_order_id = v_order,
         quote_resolved_at = now(), quote_resolved_by = auth.uid()
   where id = p_message_id;

  v_short := upper(substr(v_order::text, 1, 8));
  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'vessel', auth.uid(),
          v_n || ' item' || (case when v_n = 1 then '' else 's' end)
            || ' added to Order #' || v_short || ' and your provisioning board', 'system');

  return v_order;
end $$;

grant execute on function public.accept_supplier_quote(uuid) to authenticated;
