-- Bell notification when a supplier messages the vessel.
--
-- On each supplier→vessel message, drop a notification into every active crew
-- member's feed so it shows on the header bell (and its realtime badge). A guard
-- avoids piling up multiple unread bells for the same thread — one unread bell
-- per thread per member until they read it; a fresh message after that makes a
-- new one. SECURITY DEFINER so it can write to other users' feeds.

create or replace function public.notify_vessel_on_supplier_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant        uuid;
  v_supplier_name text;
  v_action        text;
begin
  if new.sender_type <> 'supplier' then
    return new;
  end if;

  select th.tenant_id, sp.name
    into v_tenant, v_supplier_name
  from public.supplier_message_threads th
  left join public.supplier_profiles sp on sp.id = th.supplier_id
  where th.id = new.thread_id;

  if v_tenant is null then
    return new;
  end if;

  v_action := '/messages?threadId=' || new.thread_id::text;

  insert into public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
  select tm.user_id,
         'supplier_message',
         coalesce(v_supplier_name, 'A supplier') || ' sent a message',
         left(new.body, 140),
         'info',
         v_action,
         false,
         now()
  from public.tenant_members tm
  where tm.tenant_id = v_tenant
    and tm.status <> 'invited'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = tm.user_id
        and n.type = 'supplier_message'
        and n.read = false
        and n.action_url = v_action
    );

  return new;
end $$;

drop trigger if exists trg_notify_vessel_on_supplier_message on public.supplier_messages;
create trigger trg_notify_vessel_on_supplier_message
  after insert on public.supplier_messages
  for each row execute function public.notify_vessel_on_supplier_message();
