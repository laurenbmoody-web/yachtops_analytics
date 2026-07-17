-- Surface chat-order sign-offs in /reviews (order approvals) so the approver
-- decides on the ORDER — items, total, who requested it — without being dropped
-- into the (soon private) conversation. Tier-gated, same rule as the gate.
--
-- Also repoint the sign-off notification at /reviews/orders instead of the chat,
-- for the same reason: the approver belongs on the approvals surface, not in the
-- thread.

-- Pending order approvals the caller is entitled to sign off, with the detail the
-- approvals pane needs. SECURITY DEFINER so it can read across the order + items +
-- board + requester regardless of per-row RLS, but it returns nothing unless the
-- caller's tier clears the vessel's approver bar.
create or replace function public.fetch_pending_order_approvals(p_tenant_id uuid)
returns table (
  order_id     uuid,
  supplier_name text,
  currency     text,
  total        numeric,
  item_count   integer,
  board_id     uuid,
  board_title  text,
  requested_by text,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_req  text;
begin
  select tm.permission_tier into v_tier
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status <> 'invited'
  limit 1;
  if v_tier is null then return; end if;

  select coalesce(v.defect_quote_approver_tier, 'HOD') into v_req
  from public.vessels v where v.tenant_id = p_tenant_id;
  v_req := coalesce(v_req, 'HOD');

  if public._tier_rank(v_tier) < public._tier_rank(v_req) then return; end if;

  return query
  select o.id,
         o.supplier_name,
         o.currency,
         coalesce((select sum(coalesce(i.quoted_price, i.estimated_price, 0) * coalesce(i.quantity, 1))
                   from public.supplier_order_items i
                   where i.order_id = o.id and i.status = 'pending'), 0)::numeric,
         (select count(*)::int from public.supplier_order_items i
           where i.order_id = o.id and i.status = 'pending'),
         o.list_id,
         (select pl.title from public.provisioning_lists pl where pl.id = o.list_id),
         (select coalesce(p.full_name, p.email) from public.profiles p where p.id = o.created_by),
         o.created_at
  from public.supplier_orders o
  where o.tenant_id = p_tenant_id
    and o.approval_status = 'pending'
  order by o.created_at desc;
end $$;

grant execute on function public.fetch_pending_order_approvals(uuid) to authenticated;

-- Repoint the sign-off notification at the approvals surface (not the chat).
create or replace function public.notify_order_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req text;
  v_url text;
begin
  if new.approval_status = 'pending'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'pending') then
    begin
      select coalesce(v.defect_quote_approver_tier, 'HOD') into v_req
      from public.vessels v where v.tenant_id = new.tenant_id;
      v_req := coalesce(v_req, 'HOD');

      v_url := '/reviews/orders?selected=' || new.id::text;

      insert into public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
      select tm.user_id,
             'order_signoff',
             'Order needs your sign-off',
             'A supplier order over the spend limit is awaiting your approval.',
             'info',
             v_url,
             false,
             now()
      from public.tenant_members tm
      where tm.tenant_id = new.tenant_id
        and tm.status <> 'invited'
        and public._tier_rank(tm.permission_tier) >= public._tier_rank(v_req)
        and not exists (
          select 1 from public.notifications n
          where n.user_id = tm.user_id
            and n.type = 'order_signoff'
            and n.read = false
            and n.action_url = v_url
        );
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;
