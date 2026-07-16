-- Spend sign-off on chat-accepted quotes — reuses the Defects sign-off config
-- (vessels.defect_quote_signoff_threshold + defect_quote_approver_tier), so it's
-- one consistent rule across the app.
--
-- When the crew accept a chat quote whose total is at/above the vessel's
-- threshold, the auto-created order lands as DRAFT + approval_status='pending'
-- and its items are NOT ordered yet. A Captain/HOD (per the vessel's approver
-- tier) signs it off via decide_supplier_order_approval, which confirms the
-- order and flips the items to ordered. Under the threshold it auto-confirms as
-- before.
--
-- Only the auto-created (General-chat) order is gated — adds into an existing
-- order already went through that order's own flow.

alter table public.supplier_orders
  add column if not exists approval_status  text
    check (approval_status is null or approval_status in ('pending', 'approved', 'declined')),
  add column if not exists approved_by      uuid references auth.users(id) on delete set null,
  add column if not exists approved_by_name text,
  add column if not exists approved_at      timestamptz;

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

  -- Quote total (priced lines only) and whether it needs sign-off. Only the
  -- auto-created General-chat order is gated.
  select coalesce(sum((value->>'unit_price')::numeric * coalesce((value->>'qty')::numeric, 1)), 0)
    into v_total
  from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) as value
  where value->>'unit_price' is not null;

  if v_order is null then
    select coalesce(v.defect_quote_signoff_threshold, 1000) into v_threshold
    from public.vessels v where v.tenant_id = v_tenant;
    v_gated := v_total >= coalesce(v_threshold, 1000);

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
    -- A gated order holds its lines un-ordered until sign-off.
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

-- Sign off (or decline) a chat-accepted order that's pending approval. Tier-gated
-- by the vessel's defect_quote_approver_tier, same rule as repair quotes.
create or replace function public.decide_supplier_order_approval(
  p_order_id uuid,
  p_approved boolean,
  p_note     text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant   uuid;
  v_list     uuid;
  v_tier     text;
  v_required text;
  v_name     text;
  v_thread   uuid;
  v_uid      uuid := auth.uid();
begin
  select tenant_id, list_id into v_tenant, v_list
  from public.supplier_orders where id = p_order_id;
  if v_tenant is null then raise exception 'order not found'; end if;

  select tm.permission_tier into v_tier
  from public.tenant_members tm
  where tm.tenant_id = v_tenant and tm.user_id = v_uid and tm.status <> 'invited'
  limit 1;
  if v_tier is null then raise exception 'not a member of this vessel'; end if;

  select coalesce(v.defect_quote_approver_tier, 'HOD') into v_required
  from public.vessels v where v.tenant_id = v_tenant;
  v_required := coalesce(v_required, 'HOD');

  if public._tier_rank(v_tier) < public._tier_rank(v_required) then
    raise exception 'not permitted to sign off orders';
  end if;

  select full_name into v_name from public.profiles where id = v_uid;

  update public.supplier_orders set
    approval_status  = case when p_approved then 'approved' else 'declined' end,
    approved_by      = v_uid,
    approved_by_name = v_name,
    approved_at      = now(),
    status           = case when p_approved then 'confirmed' else status end
  where id = p_order_id;

  if p_approved then
    -- Commit the held lines now that spend is authorised.
    update public.supplier_order_items
       set status = 'confirmed',
           quoted_price = coalesce(quoted_price, estimated_price),
           quoted_currency = coalesce(quoted_currency, estimated_currency),
           quoted_at = coalesce(quoted_at, now()),
           agreed_price = coalesce(agreed_price, estimated_price),
           agreed_currency = coalesce(agreed_currency, estimated_currency),
           agreed_at = coalesce(agreed_at, now()),
           quote_status = 'agreed'
     where order_id = p_order_id and status = 'pending';

    if v_list is not null then
      update public.provisioning_items
         set status = 'ordered'
       where list_id = v_list and source = 'manual' and status = 'draft';
    end if;
  end if;

  -- Tell the conversation.
  select id into v_thread from public.supplier_message_threads where order_id = p_order_id limit 1;
  if v_thread is not null then
    insert into public.supplier_messages (thread_id, sender_type, sender_user_id, body, kind)
    values (v_thread, 'vessel', v_uid,
            case when p_approved
              then 'Signed off by ' || coalesce(v_name, 'the vessel') || ' — order confirmed.'
              else 'Sign-off declined' || case when nullif(btrim(p_note), '') is not null then ' — ' || p_note else '' end
            end, 'system');
  end if;
end $$;

grant execute on function public.decide_supplier_order_approval(uuid, boolean, text) to authenticated;
