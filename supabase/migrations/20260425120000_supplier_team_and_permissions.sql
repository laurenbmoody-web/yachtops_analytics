-- Migration B: Supplier permission tiers, team invites, ownership transfer.
--
-- Introduces 5-tier permission_tier on supplier_contacts (OWNER/ADMIN/
-- MEMBER/FINANCE/VIEWER) and a has_supplier_permission(action) gate.
-- Tightens write RLS on aliases, orders, catalogue, invoices, deliveries to
-- require the appropriate permission. Adds supplier_invites + two-step
-- ownership transfer, both mirroring the vessel-side patterns in
-- 20260126203500 / 20260126200800.
--
-- Depends on 20260419150000 (supplier_profiles + supplier_contacts),
-- 20260419160000 (portal tables), 20260419170000 (supplier_orders supplier_id),
-- 20260424120000 (aliases + kpis).

-- ─── supplier_contacts: permission_tier + lifecycle columns ──────────────

alter table public.supplier_contacts
  add column if not exists permission_tier text not null default 'VIEWER'
    check (permission_tier in ('OWNER','ADMIN','MEMBER','FINANCE','VIEWER')),
  add column if not exists active boolean not null default true,
  add column if not exists invited_by uuid references auth.users(id),
  add column if not exists invited_at timestamptz,
  add column if not exists last_active_at timestamptz;

create index if not exists supplier_contacts_supplier_active_idx
  on public.supplier_contacts(supplier_id) where active = true;

-- permission_tier supersedes the legacy role + can_* columns. They stay
-- on the table for display/backwards-compat until a future cleanup migration.
comment on column public.supplier_contacts.role is
  'DEPRECATED: display-only; use permission_tier for authorization';
comment on column public.supplier_contacts.can_confirm_orders is
  'DEPRECATED: use permission_tier + has_supplier_permission()';
comment on column public.supplier_contacts.can_manage_catalogue is
  'DEPRECATED: use permission_tier + has_supplier_permission()';
comment on column public.supplier_contacts.can_view_invoices is
  'DEPRECATED: use permission_tier + has_supplier_permission()';

-- The existing role CHECK constraint forbids 'admin'. The invite flow below
-- can pass role='admin' from supplier_invites, so widen the allowed set.
-- The constraint name from the original CREATE TABLE is auto-generated;
-- find it by column + table to avoid hard-coding a name.
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.supplier_contacts'::regclass
      and contype  = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
      and pg_get_constraintdef(oid) ilike '%owner%'
  loop
    execute format('alter table public.supplier_contacts drop constraint %I', v_con.conname);
  end loop;
end$$;

alter table public.supplier_contacts
  add constraint supplier_contacts_role_check
  check (role is null or role in ('owner','sales','logistics','accounts','admin'));

-- ─── Backfill permission_tier from legacy role ───────────────────────────

update public.supplier_contacts
set permission_tier = case
  when role = 'owner'     then 'OWNER'
  when role = 'sales'     then 'MEMBER'
  when role = 'logistics' then 'MEMBER'
  when role = 'accounts'  then 'FINANCE'
  when role = 'admin'     then 'ADMIN'
  else 'MEMBER'
end
where permission_tier = 'VIEWER';

-- ─── has_supplier_permission(action) ─────────────────────────────────────
-- Single source of truth for supplier-side authorisation. Called from RLS
-- policies and RPCs. Matrix:
--   OWNER   → everything
--   ADMIN   → everything except billing:manage, ownership:transfer
--   MEMBER  → orders/catalogue/deliveries/messages/clients edit + all *:view
--   FINANCE → invoices edit + orders/deliveries/clients read
--   VIEWER  → *:view only
-- Inactive contacts (active=false) get false for everything.

create or replace function public.has_supplier_permission(p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_active boolean;
begin
  select permission_tier, active
    into v_tier, v_active
  from public.supplier_contacts
  where user_id = auth.uid()
  limit 1;

  if v_tier is null or v_active = false then
    return false;
  end if;

  return case v_tier
    when 'OWNER' then true

    when 'ADMIN' then p_action not in ('billing:manage', 'ownership:transfer')

    when 'MEMBER' then p_action in (
      'orders:view', 'orders:confirm', 'orders:edit',
      'catalogue:view', 'catalogue:edit',
      'deliveries:view', 'deliveries:edit',
      'messages:view', 'messages:send',
      'clients:view',
      'aliases:view',
      'team:view',
      'settings:view'
    )

    when 'FINANCE' then p_action in (
      'orders:view',
      'invoices:view', 'invoices:edit',
      'deliveries:view',
      'clients:view',
      'aliases:view',
      'team:view',
      'settings:view'
    )

    when 'VIEWER' then p_action like '%:view'

    else false
  end;
end;
$$;

grant execute on function public.has_supplier_permission(text) to authenticated;

-- ─── Tighten alias RLS (admin-only management) ───────────────────────────
-- v1 let any team member manage aliases. v2 gates on aliases:manage, which
-- is OWNER/ADMIN only. Read policy unchanged — any active team member
-- reads their org's aliases.

drop policy if exists "supplier_insert_own_aliases" on public.supplier_email_aliases;
drop policy if exists "supplier_update_own_aliases" on public.supplier_email_aliases;
drop policy if exists "supplier_delete_own_aliases" on public.supplier_email_aliases;

create policy "admin_insert_aliases"
  on public.supplier_email_aliases for insert
  with check (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('aliases:manage')
  );

create policy "admin_update_aliases"
  on public.supplier_email_aliases for update
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('aliases:manage')
  );

create policy "admin_delete_aliases"
  on public.supplier_email_aliases for delete
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('aliases:manage')
    and is_primary = false
  );

-- ─── Tighten write RLS on other supplier tables ──────────────────────────
-- SELECT policies unchanged (any active team member can read their org's
-- data). INSERT/UPDATE/DELETE policies now gate on the relevant action.

-- supplier_orders: suppliers can only UPDATE orders routed to them. Already
-- scoped by get_user_supplier_id(); add orders:edit gate (covers confirm).
drop policy if exists "supplier_update_own_orders" on public.supplier_orders;
create policy "supplier_update_own_orders"
  on public.supplier_orders for update
  using (
    supplier_profile_id = public.get_user_supplier_id()
    and public.has_supplier_permission('orders:edit')
  );

drop policy if exists "supplier_update_own_order_items" on public.supplier_order_items;
create policy "supplier_update_own_order_items"
  on public.supplier_order_items for update
  using (
    order_id in (
      select id from public.supplier_orders
      where supplier_profile_id = public.get_user_supplier_id()
    )
    and public.has_supplier_permission('orders:edit')
  );

-- supplier_catalogue_items
drop policy if exists "supplier_insert_catalogue" on public.supplier_catalogue_items;
drop policy if exists "supplier_update_catalogue" on public.supplier_catalogue_items;
drop policy if exists "supplier_delete_catalogue" on public.supplier_catalogue_items;

create policy "supplier_insert_catalogue"
  on public.supplier_catalogue_items for insert
  with check (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('catalogue:edit')
  );

create policy "supplier_update_catalogue"
  on public.supplier_catalogue_items for update
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('catalogue:edit')
  );

create policy "supplier_delete_catalogue"
  on public.supplier_catalogue_items for delete
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('catalogue:edit')
  );

-- supplier_invoices
drop policy if exists "supplier_insert_invoices" on public.supplier_invoices;
drop policy if exists "supplier_update_invoices" on public.supplier_invoices;

create policy "supplier_insert_invoices"
  on public.supplier_invoices for insert
  with check (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('invoices:edit')
  );

create policy "supplier_update_invoices"
  on public.supplier_invoices for update
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('invoices:edit')
  );

-- supplier_deliveries
drop policy if exists "supplier_insert_deliveries" on public.supplier_deliveries;
drop policy if exists "supplier_update_deliveries" on public.supplier_deliveries;

create policy "supplier_insert_deliveries"
  on public.supplier_deliveries for insert
  with check (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('deliveries:edit')
  );

create policy "supplier_update_deliveries"
  on public.supplier_deliveries for update
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('deliveries:edit')
  );

-- supplier_contacts: insert gated on team:invite (direct writes — normal
-- path goes through accept_supplier_invite, which is SECURITY DEFINER).
drop policy if exists "supplier_insert_contacts" on public.supplier_contacts;

create policy "supplier_insert_contacts"
  on public.supplier_contacts for insert
  to authenticated with check (
    (
      supplier_id = public.get_user_supplier_id()
      and public.has_supplier_permission('team:invite')
    )
    or not exists (
      select 1 from public.supplier_contacts sc
      where sc.supplier_id = supplier_contacts.supplier_id
    )
  );

-- ─── supplier_invites ────────────────────────────────────────────────────

create table if not exists public.supplier_invites (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid not null references public.supplier_profiles(id) on delete cascade,
  email            text not null,
  permission_tier  text not null check (permission_tier in ('ADMIN','MEMBER','FINANCE','VIEWER')),
  role             text check (role in ('sales','logistics','accounts','admin')),
  token            uuid not null default gen_random_uuid(),
  invited_by       uuid references auth.users(id),
  status           text not null default 'pending'
                     check (status in ('pending','accepted','revoked','expired')),
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users(id),
  nudge_count      integer not null default 0,
  last_nudged_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists supplier_invites_supplier_idx on public.supplier_invites(supplier_id);
create index if not exists supplier_invites_token_idx    on public.supplier_invites(token);
create index if not exists supplier_invites_status_idx   on public.supplier_invites(status);

create trigger supplier_invites_updated_at
  before update on public.supplier_invites
  for each row execute function public.set_updated_at();

alter table public.supplier_invites enable row level security;

create policy "admin_read_invites" on public.supplier_invites for select
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('team:view')
  );

create policy "admin_insert_invites" on public.supplier_invites for insert
  with check (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('team:invite')
  );

create policy "admin_update_invites" on public.supplier_invites for update
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('team:invite')
  );

-- ─── get_supplier_invite_public (anon-callable lookup by token) ──────────
-- Used by the accept-invite landing page before the user signs in.

create or replace function public.get_supplier_invite_public(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_supplier record;
begin
  select * into v_invite
  from public.supplier_invites
  where token = p_token
  limit 1;

  if v_invite is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_invite.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', v_invite.status);
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select id, name, logo_url into v_supplier
  from public.supplier_profiles
  where id = v_invite.supplier_id;

  return jsonb_build_object(
    'ok', true,
    'email', v_invite.email,
    'permission_tier', v_invite.permission_tier,
    'role', v_invite.role,
    'supplier', jsonb_build_object(
      'id',       v_supplier.id,
      'name',     v_supplier.name,
      'logo_url', v_supplier.logo_url
    )
  );
end;
$$;

grant execute on function public.get_supplier_invite_public(uuid) to anon, authenticated;

-- ─── accept_supplier_invite ──────────────────────────────────────────────

create or replace function public.accept_supplier_invite(
  p_token uuid,
  p_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_user_id uuid;
  v_user_email text;
  v_contact_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  select * into v_invite
  from public.supplier_invites
  where token = p_token
  for update;

  if v_invite is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_invite.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', v_invite.status);
  end if;
  if v_invite.expires_at < now() then
    update public.supplier_invites set status = 'expired' where id = v_invite.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if lower(v_invite.email) <> lower(v_user_email) then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  insert into public.supplier_contacts
    (supplier_id, user_id, role, permission_tier, name, email, active, invited_by, invited_at)
  values
    (v_invite.supplier_id, v_user_id, coalesce(v_invite.role, 'sales'),
     v_invite.permission_tier, p_full_name, v_user_email,
     true, v_invite.invited_by, v_invite.created_at)
  on conflict do nothing
  returning id into v_contact_id;

  update public.supplier_invites
  set status = 'accepted', accepted_at = now(), accepted_by = v_user_id
  where id = v_invite.id;

  return jsonb_build_object('ok', true, 'supplier_id', v_invite.supplier_id, 'contact_id', v_contact_id);
end;
$$;

grant execute on function public.accept_supplier_invite(uuid, text) to authenticated;

-- ─── revoke_supplier_invite ──────────────────────────────────────────────

create or replace function public.revoke_supplier_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select * into v_invite
  from public.supplier_invites
  where id = p_invite_id;

  if v_invite is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_invite.supplier_id <> public.get_user_supplier_id()
     or not public.has_supplier_permission('team:invite') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.supplier_invites set status = 'revoked' where id = p_invite_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.revoke_supplier_invite(uuid) to authenticated;

-- ─── remove_supplier_member (soft-remove) ────────────────────────────────

create or replace function public.remove_supplier_member(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  select * into v_contact
  from public.supplier_contacts
  where id = p_contact_id;

  if v_contact is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_contact.supplier_id <> public.get_user_supplier_id()
     or not public.has_supplier_permission('team:remove') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_contact.permission_tier = 'OWNER' then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_owner');
  end if;

  update public.supplier_contacts set active = false where id = p_contact_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.remove_supplier_member(uuid) to authenticated;

-- ─── update_supplier_member_tier ─────────────────────────────────────────

create or replace function public.update_supplier_member_tier(
  p_contact_id uuid,
  p_new_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  if p_new_tier not in ('ADMIN','MEMBER','FINANCE','VIEWER') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;

  select * into v_contact
  from public.supplier_contacts
  where id = p_contact_id;

  if v_contact is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_contact.supplier_id <> public.get_user_supplier_id()
     or not public.has_supplier_permission('team:invite') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_contact.permission_tier = 'OWNER' then
    return jsonb_build_object('ok', false, 'error', 'use_ownership_transfer');
  end if;

  update public.supplier_contacts set permission_tier = p_new_tier where id = p_contact_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.update_supplier_member_tier(uuid, text) to authenticated;

-- ─── Ownership transfer (two-step) ───────────────────────────────────────

create table if not exists public.supplier_ownership_transfer_requests (
  id                uuid primary key default gen_random_uuid(),
  supplier_id       uuid not null references public.supplier_profiles(id) on delete cascade,
  from_contact_id   uuid not null references public.supplier_contacts(id) on delete cascade,
  to_contact_id     uuid not null references public.supplier_contacts(id) on delete cascade,
  token             uuid not null default gen_random_uuid(),
  status            text not null default 'pending'
                      check (status in ('pending','confirmed','cancelled','expired')),
  expires_at        timestamptz not null default (now() + interval '72 hours'),
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists supplier_ownership_token_idx
  on public.supplier_ownership_transfer_requests(token);
create index if not exists supplier_ownership_supplier_status_idx
  on public.supplier_ownership_transfer_requests(supplier_id, status);

alter table public.supplier_ownership_transfer_requests enable row level security;

create policy "owner_read_own_transfer_requests"
  on public.supplier_ownership_transfer_requests for select
  using (
    supplier_id = public.get_user_supplier_id()
    and public.has_supplier_permission('ownership:transfer')
  );

-- Anon read by token so the target can load the confirm page from email.
create policy "anon_read_transfer_by_token"
  on public.supplier_ownership_transfer_requests for select
  to anon
  using (token is not null);

-- ─── request_supplier_ownership_transfer ─────────────────────────────────

create or replace function public.request_supplier_ownership_transfer(p_to_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_contact record;
  v_to_contact record;
  v_request_id uuid;
  v_token uuid;
begin
  select * into v_from_contact
  from public.supplier_contacts
  where user_id = auth.uid() and active = true and permission_tier = 'OWNER'
  limit 1;

  if v_from_contact is null then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select * into v_to_contact
  from public.supplier_contacts
  where id = p_to_contact_id;

  if v_to_contact is null
     or v_to_contact.supplier_id <> v_from_contact.supplier_id
     or v_to_contact.active = false then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  if v_to_contact.id = v_from_contact.id then
    return jsonb_build_object('ok', false, 'error', 'cannot_transfer_to_self');
  end if;

  update public.supplier_ownership_transfer_requests
  set status = 'cancelled'
  where supplier_id = v_from_contact.supplier_id and status = 'pending';

  insert into public.supplier_ownership_transfer_requests
    (supplier_id, from_contact_id, to_contact_id)
  values
    (v_from_contact.supplier_id, v_from_contact.id, v_to_contact.id)
  returning id, token into v_request_id, v_token;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'token', v_token,
    'target_email', v_to_contact.email
  );
end;
$$;

grant execute on function public.request_supplier_ownership_transfer(uuid) to authenticated;

-- ─── confirm_supplier_ownership_transfer ─────────────────────────────────

create or replace function public.confirm_supplier_ownership_transfer(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_to_contact record;
begin
  select * into v_request
  from public.supplier_ownership_transfer_requests
  where token = p_token
  for update;

  if v_request is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', v_request.status);
  end if;
  if v_request.expires_at < now() then
    update public.supplier_ownership_transfer_requests set status = 'expired' where id = v_request.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select * into v_to_contact
  from public.supplier_contacts
  where id = v_request.to_contact_id and user_id = auth.uid();

  if v_to_contact is null then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update public.supplier_contacts
  set permission_tier = 'ADMIN'
  where id = v_request.from_contact_id;

  update public.supplier_contacts
  set permission_tier = 'OWNER'
  where id = v_request.to_contact_id;

  update public.supplier_ownership_transfer_requests
  set status = 'confirmed', confirmed_at = now()
  where id = v_request.id;

  return jsonb_build_object('ok', true, 'supplier_id', v_request.supplier_id);
end;
$$;

grant execute on function public.confirm_supplier_ownership_transfer(uuid) to authenticated;

-- Verification queries (run manually after apply):
-- select permission_tier, count(*) from public.supplier_contacts group by permission_tier;
-- select public.has_supplier_permission('orders:confirm');  -- run as logged-in supplier user
-- select * from public.supplier_invites limit 1;
