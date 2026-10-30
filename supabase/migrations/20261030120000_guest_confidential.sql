-- Stop every crew member reading guests' passports, NDAs and money.
--
-- THE HOLE
-- All four policies on public.guests were plain is_tenant_member(tenant_id).
-- That table carries 60 columns including passport numbers and document URLs,
-- visa notes, NDA status and documents, APA amounts, payment and billing
-- details — and any active member of the vessel could SELECT, UPDATE and hard
-- DELETE all of it through the API. The dashboard's own tier checks were
-- bypassed by a DEV_MODE flag (removed separately), but even with the page
-- fixed the API stayed open: RLS is the only thing that actually stops this.
--
-- WHY A SECOND TABLE RATHER THAN CLEVERER POLICIES
-- RLS filters ROWS, not columns, so "crew may read this guest but not their
-- passport" cannot be written as a policy on one table. Column-level GRANTs
-- are per-role, and every signed-in user shares the `authenticated` role, so
-- they cannot separate Command from Crew either. Moving the columns to their
-- own table makes the question row-level again, which RLS answers natively.
--
-- Routing every read through a SECURITY DEFINER RPC was the alternative. It was
-- rejected: 39 places in the app select from `guests` directly, so that would
-- have been a far wider and riskier refactor for the same outcome.
--
-- WHAT MOVED, AND WHAT DELIBERATELY DID NOT
-- Moved: the columns with no plausible operational use for crew — passport and
-- visa, NDA, and anything financial.
--
-- Left on `guests` ON PURPOSE: date_of_birth (the galley plans birthday cakes —
-- cake_preference sits next to it), emergency_contact_* (wanted in a hurry by
-- whoever is standing there), contact_email / contact_phone (the interior team
-- reach guests), and allergies / health_conditions (service cannot be done
-- safely without them). Those are judgement calls about real crew workflows
-- rather than obvious leaks, so they are flagged for a human rather than
-- decided here.
--
-- Also left alone: crew keep UPDATE on `guests`, because marking a guest asleep
-- or ashore runs through personsOnBoard.js, the preferences summary through
-- preferencesSync.js, and the history log through guestHistoryLog.js. Locking
-- UPDATE to Command would have broken a stew's ordinary day. The confidential
-- columns are protected by living on a table crew cannot touch at all, which
-- gates reads and writes in one move.
--
-- STILL NOT ENFORCED, and not faked here
-- share_guest_info_with_crew ('Full' / 'Limited' / 'None'), privacy_level and
-- photo_permission are still stored and read by nothing. They are not wired up
-- in this migration because nothing anywhere defines what 'Limited' should
-- actually hide, and inventing that would put a privacy promise in front of a
-- guest that the product had not agreed to keep. It needs a decision first.

-- ── who is trusted with the confidential record ─────────────────────────────
create or replace function public.is_tenant_command_or_chief(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = p_tenant
       and tm.user_id = auth.uid()
       and tm.active is not false
       and upper(coalesce(tm.permission_tier, '')) in ('COMMAND', 'CHIEF')
  );
$$;

comment on function public.is_tenant_command_or_chief is
  'True for COMMAND and CHIEF members of the vessel. Reads permission_tier only — tenant_members.role disagrees with it on live rows, so coalescing the two would widen access.';

-- ── the confidential record ─────────────────────────────────────────────────
create table if not exists public.guest_confidential (
  guest_id   uuid primary key references public.guests(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  -- travel documents
  passport_number             text,
  passport_nationality        text,
  passport_nationality_other  text,
  passport_expiry_date        text,
  passport_document_url       text,
  visa_notes                  text,

  -- commercial
  client_type                 text,
  billing_contact_name        text,
  billing_contact_email       text,
  preferred_currency          text,
  apa_required                boolean,
  apa_amount                  numeric,
  apa_notes                   text,
  payment_notes               text,

  -- legal
  nda_signed                  boolean,
  nda_expiry_date             text,
  nda_document_url            text,
  privacy_notes               text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guest_confidential is
  'The parts of a guest record only Command and Chief may see: travel documents, commercial terms and legal status. Split out of public.guests because RLS gates rows, not columns.';

create index if not exists guest_confidential_tenant
  on public.guest_confidential (tenant_id);

alter table public.guest_confidential enable row level security;

-- Each policy is dropped first because Postgres has no CREATE POLICY IF NOT
-- EXISTS; without the guard this aborts whenever the schema was applied ahead
-- of the deploy.
drop policy if exists guest_confidential_select on public.guest_confidential;
create policy guest_confidential_select on public.guest_confidential
  for select using (public.is_tenant_command_or_chief(tenant_id));

drop policy if exists guest_confidential_insert on public.guest_confidential;
create policy guest_confidential_insert on public.guest_confidential
  for insert with check (public.is_tenant_command_or_chief(tenant_id));

drop policy if exists guest_confidential_update on public.guest_confidential;
create policy guest_confidential_update on public.guest_confidential
  for update using (public.is_tenant_command_or_chief(tenant_id))
          with check (public.is_tenant_command_or_chief(tenant_id));

drop policy if exists guest_confidential_delete on public.guest_confidential;
create policy guest_confidential_delete on public.guest_confidential
  for delete using (public.is_tenant_command(tenant_id));

-- ── carry the existing values across ────────────────────────────────────────
-- Re-runnable: a guest already carried across is left alone rather than reset.
insert into public.guest_confidential (
  guest_id, tenant_id,
  passport_number, passport_nationality, passport_nationality_other,
  passport_expiry_date, passport_document_url, visa_notes,
  client_type, billing_contact_name, billing_contact_email, preferred_currency,
  apa_required, apa_amount, apa_notes, payment_notes,
  nda_signed, nda_expiry_date, nda_document_url, privacy_notes
)
select
  g.id, g.tenant_id,
  g.passport_number, g.passport_nationality, g.passport_nationality_other,
  g.passport_expiry_date, g.passport_document_url, g.visa_notes,
  g.client_type, g.billing_contact_name, g.billing_contact_email, g.preferred_currency,
  g.apa_required, g.apa_amount, g.apa_notes, g.payment_notes,
  g.nda_signed, g.nda_expiry_date, g.nda_document_url, g.privacy_notes
from public.guests g
on conflict (guest_id) do nothing;

-- ── and take them off the open table ────────────────────────────────────────
-- Runs after the insert above, in the same migration, so the values are safely
-- copied before the originals go. Until this runs the columns are still
-- readable by any member, which is the whole point of dropping them.
alter table public.guests
  drop column if exists passport_number,
  drop column if exists passport_nationality,
  drop column if exists passport_nationality_other,
  drop column if exists passport_expiry_date,
  drop column if exists passport_document_url,
  drop column if exists visa_notes,
  drop column if exists client_type,
  drop column if exists billing_contact_name,
  drop column if exists billing_contact_email,
  drop column if exists preferred_currency,
  drop column if exists apa_required,
  drop column if exists apa_amount,
  drop column if exists apa_notes,
  drop column if exists payment_notes,
  drop column if exists nda_signed,
  drop column if exists nda_expiry_date,
  drop column if exists nda_document_url,
  drop column if exists privacy_notes;

-- ── hard deletes are Command's alone ────────────────────────────────────────
-- The app soft-deletes (is_deleted), so a real DELETE is the irreversible
-- escape hatch, and it cascades to preferences and the confidential record.
-- Any member could do it.
drop policy if exists guests_delete_tenant_members on public.guests;
drop policy if exists guests_delete_command on public.guests;
create policy guests_delete_command on public.guests
  for delete using (public.is_tenant_command(tenant_id));
