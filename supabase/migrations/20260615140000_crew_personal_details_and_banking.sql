-- Persist the crew profile fields that previously saved nowhere
-- (only name/email were persisted on profiles). One row per crew member.

create table if not exists public.crew_personal_details (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth        date,
  nationality          text,
  phones               jsonb not null default '[]'::jsonb,   -- [{label, value}]
  secondary_email      text,
  home_address         text,
  blood_type           text,
  allergies_status     text,                                  -- 'no_known' | 'not_provided' | 'has'
  allergies_text       text,
  allergies_confirmed_at date,
  medical_conditions   text,
  emergency_contact    jsonb not null default '{}'::jsonb,    -- {name, relationship, phone, address}
  next_of_kin          jsonb not null default '{}'::jsonb,
  preferences          jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now()
);

create table if not exists public.crew_banking (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  account_holder   text,
  bank_name        text,
  account_number   text,
  swift_bic        text,
  currency         text,
  country          text,
  account_type     text,
  sort_code        text,
  routing_number   text,
  address_line1    text,
  address_line2    text,
  city             text,
  address_country  text,
  updated_at       timestamptz not null default now()
);

alter table public.crew_personal_details enable row level security;
alter table public.crew_banking          enable row level security;

-- Self manages own; COMMAND manages crew in a shared active tenant.
drop policy if exists crew_personal_details_access on public.crew_personal_details;
create policy crew_personal_details_access on public.crew_personal_details for all
  using (
    user_id = auth.uid() or exists (
      select 1 from public.tenant_members v
      join public.tenant_members s on s.tenant_id = v.tenant_id
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and s.user_id = crew_personal_details.user_id
    )
  )
  with check (
    user_id = auth.uid() or exists (
      select 1 from public.tenant_members v
      join public.tenant_members s on s.tenant_id = v.tenant_id
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and s.user_id = crew_personal_details.user_id
    )
  );

drop policy if exists crew_banking_access on public.crew_banking;
create policy crew_banking_access on public.crew_banking for all
  using (
    user_id = auth.uid() or exists (
      select 1 from public.tenant_members v
      join public.tenant_members s on s.tenant_id = v.tenant_id
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and s.user_id = crew_banking.user_id
    )
  )
  with check (
    user_id = auth.uid() or exists (
      select 1 from public.tenant_members v
      join public.tenant_members s on s.tenant_id = v.tenant_id
      where v.user_id = auth.uid() and v.active = true and v.permission_tier = 'COMMAND'
        and s.user_id = crew_banking.user_id
    )
  );
