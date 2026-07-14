-- Track each thread's last sender — powers the "awaiting your reply" metric
-- (last message came from the vessel) and the "You:" preview prefix.

alter table public.supplier_message_threads
  add column if not exists last_sender_type text;

-- Extend the touch trigger to also stamp the last sender.
create or replace function public.touch_message_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_message_threads
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 140),
         last_sender_type = new.sender_type,
         supplier_unread_count = supplier_unread_count + case when new.sender_type = 'vessel' then 1 else 0 end,
         vessel_unread_count   = vessel_unread_count   + case when new.sender_type = 'supplier' then 1 else 0 end
   where id = new.thread_id;
  return new;
end $$;
