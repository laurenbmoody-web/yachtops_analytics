-- Private-thread ENFORCEMENT FLIP (the coupled, privacy-critical step).
--
-- Until now every active tenant member could read every one of their vessel's
-- supplier threads (RLS was vessel-wide), so a chief saw the captain's chats.
-- The foundation migrations (20260716700000 participants + 20260716710000
-- get_or_create_dm_thread) seeded a participant list on every thread and gave
-- crew a SECURITY DEFINER way to open their own 1:1 thread. This migration turns
-- the key: threads and messages become visible ONLY to their participants.
--
-- What flips here (all as one unit — a partial flip leaks or breaks visibility):
--   1. Drop the one-general / one-per-order uniqueness — the DM model holds many
--      threads per (supplier, vessel): one per crew member ↔ supplier contact.
--   2. Threads + messages RLS → participant-scoped (is_thread_participant).
--      No thread INSERT policy: threads are born only inside SECURITY DEFINER
--      RPCs, so suppliers can no longer initiate.
--   3. The crew read/archive/delete RPCs gate on participation, not tenant
--      membership.
--   4. The supplier→vessel bell notifies only the thread's CREW PARTICIPANTS
--      (not the whole crew — that would re-leak the thread's existence).
--   5. accept_supplier_quote no longer re-parents the thread or spawns a stray
--      participant-less "general" thread (the chat never converts); the order
--      it creates is found back through the accepted message.

-- ── 1. Uniqueness ────────────────────────────────────────────────────────────
drop index if exists public.uq_smt_supplier_order;
drop index if exists public.uq_smt_supplier_general;

-- ── 2a. Threads RLS ──────────────────────────────────────────────────────────
drop policy if exists "supplier manage own threads"      on public.supplier_message_threads;
drop policy if exists "tenant members read their threads" on public.supplier_message_threads;

drop policy if exists "participants read threads" on public.supplier_message_threads;
create policy "participants read threads" on public.supplier_message_threads
  for select using (public.is_thread_participant(id, auth.uid()));

-- Supplier read-receipts + both sides' archive go through direct UPDATEs.
drop policy if exists "participants update threads" on public.supplier_message_threads;
create policy "participants update threads" on public.supplier_message_threads
  for update using (public.is_thread_participant(id, auth.uid()))
  with check (public.is_thread_participant(id, auth.uid()));

-- Supplier-side delete is a direct DELETE; crew delete goes via RPC.
drop policy if exists "participants delete threads" on public.supplier_message_threads;
create policy "participants delete threads" on public.supplier_message_threads
  for delete using (public.is_thread_participant(id, auth.uid()));

-- (No INSERT policy — creation is RPC-only, so suppliers can't start threads.)

-- ── 2b. Messages RLS ─────────────────────────────────────────────────────────
drop policy if exists "supplier manage own messages"    on public.supplier_messages;
drop policy if exists "tenant members read their messages" on public.supplier_messages;
drop policy if exists "tenant members send messages"    on public.supplier_messages;

drop policy if exists "participants read messages" on public.supplier_messages;
create policy "participants read messages" on public.supplier_messages
  for select using (public.is_thread_participant(thread_id, auth.uid()));

-- A participant may post, as themselves. (edit / delete / react stay on their
-- SECURITY DEFINER RPCs; system messages are written by definer functions that
-- bypass RLS.)
drop policy if exists "participants send messages" on public.supplier_messages;
create policy "participants send messages" on public.supplier_messages
  for insert with check (
    public.is_thread_participant(thread_id, auth.uid())
    and sender_user_id = auth.uid()
  );

-- ── 3. Crew RPCs → participant checks ────────────────────────────────────────
create or replace function public.mark_thread_read_vessel(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.supplier_message_threads t
     set vessel_last_read_at = now(),
         vessel_unread_count = 0
   where t.id = p_thread_id
     and public.is_thread_participant(p_thread_id, auth.uid());
end $$;

create or replace function public.set_thread_archived_vessel(p_thread_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_thread_participant(p_thread_id, auth.uid()) then
    raise exception 'not authorized';
  end if;
  update public.supplier_message_threads
     set archived_at = case when p_archived then now() else null end
   where id = p_thread_id;
end $$;

create or replace function public.delete_thread_vessel(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_thread_participant(p_thread_id, auth.uid()) then
    raise exception 'not authorized';
  end if;
  delete from public.supplier_message_threads where id = p_thread_id;
end $$;

-- ── 4. Bell notification → crew PARTICIPANTS only ────────────────────────────
create or replace function public.notify_vessel_on_supplier_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier_name text;
  v_action        text;
begin
  if new.sender_type <> 'supplier' then
    return new;
  end if;

  select sp.name into v_supplier_name
  from public.supplier_message_threads th
  left join public.supplier_profiles sp on sp.id = th.supplier_id
  where th.id = new.thread_id;

  v_action := '/messages?threadId=' || new.thread_id::text;

  -- Only the crew members actually IN this thread get a bell — notifying every
  -- tenant member would tell the whole crew a private thread exists.
  insert into public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
  select p.user_id,
         'supplier_message',
         coalesce(v_supplier_name, 'A supplier') || ' sent a message',
         left(new.body, 140),
         'info',
         v_action,
         false,
         now()
  from public.supplier_message_thread_participants p
  where p.thread_id = new.thread_id
    and p.party = 'crew'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = p.user_id
        and n.type = 'supplier_message'
        and n.read = false
        and n.action_url = v_action
    );

  return new;
end $$;

-- ── 5. accept_supplier_quote — no re-parent / no stray general thread ────────
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

  -- The caller must be a participant of this thread (they own or collaborate on
  -- the conversation). Membership alone is no longer enough.
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

  -- NOTE: the thread is a persistent DM — it never converts into an order
  -- thread, so we no longer stamp order_id onto it or spawn a fresh general
  -- thread. The order is reachable from the accepted message (quote_order_id).

  return v_order;
end $$;

grant execute on function public.accept_supplier_quote(uuid) to authenticated;

-- decide_supplier_order_approval — find the thread via the accepted message
-- (order_id is no longer stamped on the thread), everything else unchanged.
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
  v_held     record;
  v_price    numeric;
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
    for v_held in
      select * from public.supplier_order_items
      where order_id = p_order_id and status = 'pending'
    loop
      v_price := coalesce(v_held.quoted_price, v_held.estimated_price);

      update public.supplier_order_items
         set status = 'confirmed',
             quoted_price = coalesce(quoted_price, estimated_price),
             quoted_currency = coalesce(quoted_currency, estimated_currency),
             quoted_at = coalesce(quoted_at, now()),
             agreed_price = coalesce(agreed_price, estimated_price),
             agreed_currency = coalesce(agreed_currency, estimated_currency),
             agreed_at = coalesce(agreed_at, now()),
             quote_status = 'agreed'
       where id = v_held.id;

      if v_list is not null then
        update public.provisioning_items
           set quantity_ordered = coalesce(quantity_ordered, 0) + v_held.quantity
         where list_id = v_list and status = 'ordered' and source = 'manual'
           and lower(coalesce(name, '')) = lower(coalesce(v_held.item_name, ''))
           and coalesce(unit, '') = coalesce(v_held.unit, '')
           and estimated_unit_cost is not distinct from v_price;
        if not found then
          insert into public.provisioning_items
            (list_id, name, quantity_ordered, unit, estimated_unit_cost, source, status, notes)
          values (v_list, coalesce(v_held.item_name, 'Item'), v_held.quantity, v_held.unit,
                  v_price, 'manual', 'ordered', 'Added from a supplier chat quote (signed off)');
        end if;
      end if;
    end loop;
  end if;

  -- Thread lookup: through the accepted message, since the thread is no longer
  -- keyed by order_id.
  select thread_id into v_thread
  from public.supplier_messages
  where quote_order_id = p_order_id and kind = 'quote'
  order by created_at asc
  limit 1;

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
