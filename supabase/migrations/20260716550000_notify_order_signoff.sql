-- Notify eligible approvers when a chat order goes pending sign-off, so it's not
-- buried in a conversation. Every active member whose tier can approve (per the
-- vessel's defect_quote_approver_tier, same rule as the gate) gets a bell
-- notification linking to the thread where the sign-off banner lives.
--
-- Wrapped in an exception guard so a notify hiccup can NEVER roll back the
-- accept that fired it. One unread order_signoff per approver per thread.

create or replace function public.notify_order_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    text;
  v_thread uuid;
  v_url    text;
begin
  if new.approval_status = 'pending'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'pending') then
    begin
      select coalesce(v.defect_quote_approver_tier, 'HOD') into v_req
      from public.vessels v where v.tenant_id = new.tenant_id;
      v_req := coalesce(v_req, 'HOD');

      select id into v_thread from public.supplier_message_threads where order_id = new.id limit 1;
      v_url := coalesce('/messages?threadId=' || v_thread::text, '/messages');

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
      null;  -- best-effort; never break the accept
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_order_signoff on public.supplier_orders;
create trigger trg_notify_order_signoff
  after insert or update of approval_status on public.supplier_orders
  for each row execute function public.notify_order_signoff();
