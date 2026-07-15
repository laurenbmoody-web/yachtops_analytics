-- Actionable quotes inside supplier messaging.
--
-- "Turn into a quote" now sends a structured quote message (line items + prices).
-- The crew can Accept it — which adds the lines to the linked supplier order as
-- normal pending items (the same shape a crew-added item has, priced from the
-- catalogue estimate) — or Decline. A system message records the outcome.
--
-- Kept intentionally simple/safe: it appends to the *supplier order* (what gets
-- fulfilled). Syncing back to the provisioning board is a follow-up.

alter table public.supplier_messages
  add column if not exists kind text not null default 'text'
    check (kind in ('text', 'quote', 'system')),
  add column if not exists quote jsonb,
  add column if not exists quote_status text
    check (quote_status in ('pending', 'accepted', 'declined')),
  add column if not exists quote_order_id uuid references public.supplier_orders(id) on delete set null,
  add column if not exists quote_resolved_at timestamptz,
  add column if not exists quote_resolved_by uuid references auth.users(id) on delete set null;

-- Vessel accepts a quote → append its items to the order + record it.
create or replace function public.accept_supplier_quote(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread   uuid;
  v_kind     text;
  v_status   text;
  v_quote    jsonb;
  v_tenant   uuid;
  v_order    uuid;
  v_supplier uuid;
  v_cur      text;
  v_item     jsonb;
  v_n        integer := 0;
  v_short    text;
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

  -- Target: the thread's order, else this vessel's most recent order with this supplier.
  if v_order is null then
    select o.id into v_order
    from public.supplier_orders o
    where o.tenant_id = v_tenant and o.supplier_profile_id = v_supplier
    order by o.created_at desc
    limit 1;
  end if;
  if v_order is null then
    raise exception 'no_order';
  end if;

  select currency into v_cur from public.supplier_orders where id = v_order;

  for v_item in select value from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) as value
  loop
    insert into public.supplier_order_items
      (order_id, item_name, quantity, unit, status, estimated_price, estimated_currency, quote_status)
    values (
      v_order,
      coalesce(nullif(v_item->>'name', ''), 'Item'),
      coalesce((v_item->>'qty')::numeric, 1),
      nullif(v_item->>'unit', ''),
      'pending',
      (v_item->>'unit_price')::numeric,
      coalesce(v_cur, v_item->>'currency'),
      'awaiting_quote'
    );
    v_n := v_n + 1;
  end loop;

  update public.supplier_messages
     set quote_status = 'accepted', quote_order_id = v_order,
         quote_resolved_at = now(), quote_resolved_by = auth.uid()
   where id = p_message_id;

  v_short := upper(substr(v_order::text, 1, 8));
  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'vessel', auth.uid(),
          v_n || ' item' || (case when v_n = 1 then '' else 's' end) || ' added to Order #' || v_short, 'system');

  return v_order;
end $$;

grant execute on function public.accept_supplier_quote(uuid) to authenticated;

-- Vessel declines a quote.
create or replace function public.decline_supplier_quote(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread uuid;
  v_tenant uuid;
begin
  select m.thread_id into v_thread
  from public.supplier_messages m
  where m.id = p_message_id and m.kind = 'quote' and coalesce(m.quote_status, 'pending') = 'pending';
  if v_thread is null then raise exception 'quote not found or already resolved'; end if;

  select t.tenant_id into v_tenant from public.supplier_message_threads t where t.id = v_thread;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.user_id = auth.uid() and tm.status <> 'invited'
  ) then
    raise exception 'not authorized';
  end if;

  update public.supplier_messages
     set quote_status = 'declined', quote_resolved_at = now(), quote_resolved_by = auth.uid()
   where id = p_message_id;

  insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
  values (v_thread, 'vessel', auth.uid(), 'Quote declined', 'system');
end $$;

grant execute on function public.decline_supplier_quote(uuid) to authenticated;
