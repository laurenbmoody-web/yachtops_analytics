-- Foundation for private, participant-scoped supplier↔yacht threads.
--
-- This migration is NON-BREAKING: it creates the participant table and a helper,
-- and backfills participants for every existing thread. RLS is NOT changed here
-- (the vessel-wide policies still apply) — the enforcement flip lands in a
-- follow-up once every thread has its participants seeded.
--
-- Backfill policy (agreed with the vessel):
--   crew participants     = everyone who actually sent a vessel message
--                           (people genuinely in the conversation keep access;
--                           crew who never touched it stop seeing it once RLS
--                           flips). Threads with NO crew sender (supplier-started,
--                           no reply) are assigned to a COMMAND member so they
--                           surface for the captain rather than vanish.
--   supplier participants = everyone who sent a supplier message, plus the
--                           supplier's primary user.

create table if not exists public.supplier_message_thread_participants (
  thread_id uuid not null references public.supplier_message_threads(id) on delete cascade,
  party     text not null check (party in ('crew', 'supplier')),
  user_id   uuid not null references auth.users(id) on delete cascade,
  added_by  uuid references auth.users(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_smtp_user   on public.supplier_message_thread_participants (user_id);
create index if not exists idx_smtp_thread on public.supplier_message_thread_participants (thread_id);

comment on table public.supplier_message_thread_participants is
  'Explicit member list for a supplier↔yacht thread. party=crew → a tenant member; party=supplier → a supplier user. Drives (from a follow-up migration) participant-scoped RLS so threads are private to the people in them.';

-- Membership test used by RLS + app, SECURITY DEFINER to avoid policy recursion.
create or replace function public.is_thread_participant(p_thread uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.supplier_message_thread_participants
    where thread_id = p_thread and user_id = p_uid
  );
$$;

grant execute on function public.is_thread_participant(uuid, uuid) to authenticated;

-- ── Backfill ────────────────────────────────────────────────────────────────

-- Crew: everyone who sent a vessel message.
insert into public.supplier_message_thread_participants (thread_id, party, user_id)
select distinct m.thread_id, 'crew', m.sender_user_id
from public.supplier_messages m
where m.sender_type = 'vessel' and m.sender_user_id is not null
on conflict do nothing;

-- Supplier: everyone who sent a supplier message.
insert into public.supplier_message_thread_participants (thread_id, party, user_id)
select distinct m.thread_id, 'supplier', m.sender_user_id
from public.supplier_messages m
where m.sender_type = 'supplier' and m.sender_user_id is not null
on conflict do nothing;

-- Supplier: the supplier's contacts (the supplier↔user link is supplier_contacts,
-- not supplier_profiles). Existing threads grandfather the whole supplier team so
-- nobody loses access; new threads (from the follow-up) add specific participants.
insert into public.supplier_message_thread_participants (thread_id, party, user_id)
select distinct t.id, 'supplier', sc.user_id
from public.supplier_message_threads t
join public.supplier_contacts sc on sc.supplier_id = t.supplier_id
where sc.user_id is not null
on conflict do nothing;

-- Orphan crew side: threads with no crew participant → a COMMAND member, so the
-- captain sees them (these include supplier-started, unreplied threads).
insert into public.supplier_message_thread_participants (thread_id, party, user_id)
select t.id, 'crew', cmd.user_id
from public.supplier_message_threads t
join lateral (
  select tm.user_id
  from public.tenant_members tm
  where tm.tenant_id = t.tenant_id
    and tm.permission_tier = 'COMMAND'
    and tm.status <> 'invited'
  order by tm.joined_at asc nulls last
  limit 1
) cmd on true
where not exists (
  select 1 from public.supplier_message_thread_participants p
  where p.thread_id = t.id and p.party = 'crew'
)
on conflict do nothing;

-- RLS on the participant table itself: you may read participant rows for a
-- thread you're in (so the UI can show who's in the room). Writes go through
-- SECURITY DEFINER RPCs (added in the follow-up), so no direct insert/update
-- policy here.
alter table public.supplier_message_thread_participants enable row level security;

drop policy if exists "read participants of my threads" on public.supplier_message_thread_participants;
create policy "read participants of my threads"
on public.supplier_message_thread_participants
for select
to authenticated
using (public.is_thread_participant(thread_id, auth.uid()));
