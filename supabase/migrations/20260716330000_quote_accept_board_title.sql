-- Tidy the auto-created board's title. "<Supplier> — chat request" renders as a
-- huge all-caps serif heading ("SOURCE AND SUPPLY — CHAT REQUEST") which reads as
-- obnoxious. Use just the supplier name — the "Added from a supplier chat quote"
-- item note already records where it came from, and boards are renamable.
--
-- Replaces accept_supplier_quote from 20260716320000 (only the board title
-- string changes; everything else is identical).

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
  v_new_order boolean := false;
  v_was_general boolean := false;
  v_other_pending integer := 0;
  v_uid       uuid := auth.uid();
  v_dept      uuid;
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

  v_was_general := v_order is null;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = v_uid and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  -- The accepting member's department, so the auto-created board lands on
  -- their department wall like any board they'd make by hand.
  select department_id into v_dept
  from public.tenant_members
  where tenant_id = v_tenant and user_id = v_uid
  limit 1;

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
      (tenant_id, list_id, supplier_name, supplier_profile_id, currency, status, created_by)
    values
      (v_tenant, v_list, coalesce(v_sname, 'Supplier'), v_supplier, v_cur, 'confirmed', v_uid)
    returning id into v_order;

    v_new_order := true;
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
        case when v_confirmed then 'ordered' else 'draft' end,
        'Added from a supplier chat quote'
      );
    end if;

    v_n := v_n + 1;
  end loop;

  update public.supplier_messages
     set quote_status = 'accepted', quote_order_id = v_order,
         quote_resolved_at = now(), quote_resolved_by = v_uid
   where id = p_message_id;

  v_short := upper(substr(v_order::text, 1, 8));
  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'vessel', v_uid,
          v_n || ' item' || (case when v_n = 1 then '' else 's' end)
            || ' added to Order #' || v_short || ' and your provisioning board', 'system');

  -- Re-parent a clean General chat onto the order it just created (and open a
  -- fresh General). Wrapped so any bookkeeping error here can never undo the
  -- accept above.
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
      null;  -- thread bookkeeping is best-effort; never break the accept
    end;
  end if;

  return v_order;
end $$;

grant execute on function public.accept_supplier_quote(uuid) to authenticated;

-- Shorten the boards the earlier RPC already titled "<Supplier> — chat request"
-- down to just the supplier name.
update public.provisioning_lists
   set title = trim(regexp_replace(title, '\s*—\s*chat request$', ''))
 where title like '% — chat request';
