-- ─────────────────────────────────────────────────────────────────────────────
-- 20260626120000_crew_issued_kit.sql
--
-- WHAT: "Issued Kit" register — the digital version of the paper uniform/kit
--       hand-out sheet. Each row is one item issued to a crew member, who signs
--       in-app to acknowledge receipt and accept responsibility (kit is often
--       just left in a cabin, so the crew member self-acknowledges rather than
--       counter-signing at handover).
--
--       Lifecycle: a manager (COMMAND) issues an item → it sits "awaiting
--       acknowledgement" until the crew member signs → "in service" with them →
--       (Phase 2) "returned" / "lost" with a return sign-off at offboarding.
--
--       Return columns (returned_* / return_signature_*) are created now so the
--       Phase 2 returns flow needs no further migration. `value` is nullable and
--       NOT surfaced in the crew view — it exists for the later uniform-inventory
--       work (cost / end-of-contract deductions).
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS + bucket ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crew_issued_kit (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,                 -- crew member it's issued to
  tenant_id          uuid,                          -- vessel
  category           text,                          -- uniform | ppe | electronics | equipment | keys | other
  item               text not null,
  size               text,
  quantity           integer not null default 1,
  serial             text,
  condition_issued   text,                          -- New | Good | Used
  issued_date        date,
  issued_by          uuid,
  issued_by_name     text,                          -- snapshot of issuer's name
  value              numeric,                        -- NOT shown to crew; future inventory
  status             text not null default 'in_service',  -- in_service | returned | lost
  -- Acknowledgement (receipt sign-off by the crew member)
  acknowledged_at    timestamptz,
  ack_signature_path text,                          -- path in kit-signatures bucket
  ack_signed_name    text,
  ack_signed_ip      text,
  ack_signed_ua      text,
  -- Returns (Phase 2) — columns present now, UI wired later
  returned_date          date,
  return_condition       text,
  returned_to            uuid,
  return_signature_path  text,
  return_signed_name     text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid
);

create index if not exists crew_issued_kit_user_idx   on public.crew_issued_kit (user_id);
create index if not exists crew_issued_kit_tenant_idx on public.crew_issued_kit (tenant_id);
create index if not exists crew_issued_kit_status_idx on public.crew_issued_kit (status);

alter table public.crew_issued_kit enable row level security;

grant select, insert, update, delete on public.crew_issued_kit to authenticated;

-- The crew member sees their own kit and may UPDATE it to acknowledge receipt
-- (the app only writes the ack_* columns from the crew side). They cannot issue
-- to themselves — issuance is a manager action.
drop policy if exists crew_kit_owner_select on public.crew_issued_kit;
create policy crew_kit_owner_select
  on public.crew_issued_kit for select
  using (user_id = auth.uid());

drop policy if exists crew_kit_owner_update on public.crew_issued_kit;
create policy crew_kit_owner_update
  on public.crew_issued_kit for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- COMMAND in a shared active tenant fully manages a crew member's kit (issue,
-- edit, delete, record returns) — mirrors the personal_documents COMMAND policy.
drop policy if exists crew_kit_command_all on public.crew_issued_kit;
create policy crew_kit_command_all
  on public.crew_issued_kit for all
  using (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = crew_issued_kit.user_id
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and viewer.permission_tier = 'COMMAND'
        and subject.user_id = crew_issued_kit.user_id
    )
  );

-- ── Private signature bucket — drawn receipt/return signatures (PNG) ──────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kit-signatures', 'kit-signatures', false, 524288, array['image/png'])
on conflict (id) do nothing;

-- Each user writes signatures into their OWN {auth.uid()}/ folder.
drop policy if exists kit_sig_owner_all on storage.objects;
create policy kit_sig_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'kit-signatures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'kit-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

-- Tenant members may view each other's kit signatures (a captain sees the crew's
-- acknowledgement; the crew sees the captain's return sign-off).
drop policy if exists kit_sig_tenant_view on storage.objects;
create policy kit_sig_tenant_view on storage.objects
  for select to authenticated
  using (
    bucket_id = 'kit-signatures'
    and exists (
      select 1 from public.tenant_members tm1
      join public.tenant_members tm2 on tm1.tenant_id = tm2.tenant_id
      where tm1.user_id = auth.uid()
        and tm2.user_id = (storage.foldername(name))[1]::uuid
        and tm1.active = true
        and tm2.active = true
    )
  );
