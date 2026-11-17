-- Charter parties — the group a charter guest belongs to.
--
-- Level 2 of "who is this guest" (owner-or-charter > WHICH CHARTER > who they
-- are to the party) was being read from `trips.name`. That works only while a
-- charter is exactly one trip, and it is not:
--
--   * a party can charter again, with a different set of guests, so one name
--     spans several trips and `trips.name` would give two answers;
--   * guests arrive from the broker before the trip exists in Cargo at all, so
--     there is often no trip to read a name from when the guest is recorded.
--
-- So the party is its own thing: named once, picked again for the next guest
-- who belongs to it, and still there when the same party comes back.
--
-- `trips` is deliberately NOT given a party FK here. It is the obvious next
-- step — it would let a second trip for a known party pre-fill its guests — but
-- nothing needs it to answer level 2, and an unused column invites being
-- half-filled.
--
-- NOTE: this ships ahead of the UI that uses it. Nothing reads
-- `charter_party_id` yet, so applying it changes no behaviour.

create table if not exists public.charter_parties (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);

-- One name per vessel, case-insensitively: "Milton" and "milton" being two
-- parties is the near-duplicate problem a free-text field would have had, and
-- it is the whole reason this is a table and not a string on the guest.
create unique index if not exists charter_parties_tenant_name_key
  on public.charter_parties (tenant_id, lower(name))
  where is_deleted = false;

create index if not exists charter_parties_tenant_idx
  on public.charter_parties (tenant_id)
  where is_deleted = false;

alter table public.guests
  add column if not exists charter_party_id uuid
    references public.charter_parties(id) on delete set null;

comment on column public.guests.charter_party_id is
  'Which charter party this guest belongs to. Null for owner-side guests and '
  'for charter guests whose party has not been named yet. A party outlives any '
  'one trip — the same party can charter again with different guests.';

create index if not exists guests_charter_party_idx
  on public.guests (charter_party_id)
  where charter_party_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- A party is a name and a note, no more sensitive than the guest list it
-- groups, so it reads and writes like `guests`: any active member of the
-- vessel. Deletes are soft (is_deleted), so no delete policy is offered.
alter table public.charter_parties enable row level security;

drop policy if exists charter_parties_select on public.charter_parties;
create policy charter_parties_select on public.charter_parties
  for select using (is_tenant_member(tenant_id));

drop policy if exists charter_parties_insert on public.charter_parties;
create policy charter_parties_insert on public.charter_parties
  for insert with check (is_tenant_member(tenant_id));

drop policy if exists charter_parties_update on public.charter_parties;
create policy charter_parties_update on public.charter_parties
  for update using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
