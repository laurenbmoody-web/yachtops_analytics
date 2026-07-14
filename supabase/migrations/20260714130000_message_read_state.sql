-- Messaging read-state + realtime.
--
-- Thread-level last-read timestamps + unread counters drive read receipts
-- (a supplier message is "read" once vessel_last_read_at passes its time) and
-- inbox unread badges — without a per-message read row. The touch trigger
-- maintains the counters; opening a thread resets the reader's side. The two
-- tables join the realtime publication so delivery + inbox updates are live.

alter table public.supplier_message_threads
  add column if not exists supplier_last_read_at timestamptz,
  add column if not exists vessel_last_read_at   timestamptz,
  add column if not exists supplier_unread_count integer not null default 0,
  add column if not exists vessel_unread_count   integer not null default 0;

-- Extend the thread-touch trigger: bump the *recipient's* unread counter.
create or replace function public.touch_message_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_message_threads
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 140),
         supplier_unread_count = supplier_unread_count + case when new.sender_type = 'vessel' then 1 else 0 end,
         vessel_unread_count   = vessel_unread_count   + case when new.sender_type = 'supplier' then 1 else 0 end
   where id = new.thread_id;
  return new;
end $$;

-- Realtime: live message delivery + inbox updates (idempotent add).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'supplier_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.supplier_messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'supplier_message_threads'
  ) then
    execute 'alter publication supabase_realtime add table public.supplier_message_threads';
  end if;
end $$;
