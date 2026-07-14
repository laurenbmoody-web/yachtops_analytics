-- Supplier ↔ yacht messaging.
--
-- A thread per (supplier, tenant/yacht); messages belong to a thread. The
-- supplier side sends today (Radar nudges, the client profile, and every
-- "Message yacht" button). The vessel side can read + reply once its inbox
-- is built — the RLS already admits tenant members, so that plugs in with no
-- schema change.

create table if not exists public.supplier_message_threads (
  id                   uuid primary key default gen_random_uuid(),
  supplier_id          uuid not null references public.supplier_profiles(id) on delete cascade,
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  order_id             uuid references public.supplier_orders(id) on delete set null,
  last_message_at      timestamptz,
  last_message_preview text,
  created_at           timestamptz not null default now(),
  unique (supplier_id, tenant_id)
);

create index if not exists idx_smt_supplier on public.supplier_message_threads (supplier_id, last_message_at desc);
create index if not exists idx_smt_tenant   on public.supplier_message_threads (tenant_id);

create table if not exists public.supplier_messages (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references public.supplier_message_threads(id) on delete cascade,
  sender_type    text not null check (sender_type in ('supplier', 'vessel')),
  sender_user_id uuid references auth.users(id) on delete set null,
  body           text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_sm_thread on public.supplier_messages (thread_id, created_at);

alter table public.supplier_message_threads enable row level security;
alter table public.supplier_messages         enable row level security;

-- Threads — the supplier owns theirs; tenant members can read their yacht's.
-- (drop-before-create so the migration stays re-runnable if the pipeline
-- replays it against a database that already has the objects.)
drop policy if exists "supplier manage own threads" on public.supplier_message_threads;
create policy "supplier manage own threads" on public.supplier_message_threads
  for all
  using (supplier_id = get_user_supplier_id())
  with check (supplier_id = get_user_supplier_id());

drop policy if exists "tenant members read their threads" on public.supplier_message_threads;
create policy "tenant members read their threads" on public.supplier_message_threads
  for select
  using (tenant_id in (
    select tenant_id from public.tenant_members
    where user_id = auth.uid() and status != 'invited'
  ));

-- Messages — reachable via the thread's supplier ownership or tenant membership.
drop policy if exists "supplier manage own messages" on public.supplier_messages;
create policy "supplier manage own messages" on public.supplier_messages
  for all
  using (thread_id in (
    select id from public.supplier_message_threads where supplier_id = get_user_supplier_id()
  ))
  with check (thread_id in (
    select id from public.supplier_message_threads where supplier_id = get_user_supplier_id()
  ));

drop policy if exists "tenant members read their messages" on public.supplier_messages;
create policy "tenant members read their messages" on public.supplier_messages
  for select
  using (thread_id in (
    select t.id from public.supplier_message_threads t
    join public.tenant_members tm on tm.tenant_id = t.tenant_id
    where tm.user_id = auth.uid() and tm.status != 'invited'
  ));

-- Vessel-side reply (for when the crew inbox lands) — must send as 'vessel'.
drop policy if exists "tenant members send messages" on public.supplier_messages;
create policy "tenant members send messages" on public.supplier_messages
  for insert
  with check (
    sender_type = 'vessel'
    and thread_id in (
      select t.id from public.supplier_message_threads t
      join public.tenant_members tm on tm.tenant_id = t.tenant_id
      where tm.user_id = auth.uid() and tm.status != 'invited'
    )
  );

-- Keep the thread's last-message summary current for inbox ordering + preview.
create or replace function public.touch_message_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_message_threads
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 140)
   where id = new.thread_id;
  return new;
end $$;

drop trigger if exists trg_touch_message_thread on public.supplier_messages;
create trigger trg_touch_message_thread
  after insert on public.supplier_messages
  for each row execute function public.touch_message_thread();
