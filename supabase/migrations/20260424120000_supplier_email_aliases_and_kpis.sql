-- Migration A: Supplier email aliases, verification flow, KPI RPC, and backfills.
--
-- Adds per-supplier email aliases so inbound/public-token orders can be routed
-- to the correct supplier_profiles row even when the supplier uses multiple
-- mailboxes. Also adds:
--   - a resolver RPC for the email-to-supplier lookup,
--   - triggers that (a) auto-create a primary alias on profile insert,
--     (b) fill supplier_orders.supplier_profile_id on insert, and
--     (c) backfill historical orders when an alias is verified,
--   - an anon-callable verify RPC for the email verification link flow,
--   - home_currency on supplier_profiles,
--   - get_supplier_kpis() for the supplier portal dashboard.

-- ─── supplier_email_aliases ──────────────────────────────────────────────
create table if not exists public.supplier_email_aliases (
  id                      uuid primary key default gen_random_uuid(),
  supplier_id             uuid not null references public.supplier_profiles(id) on delete cascade,
  email                   text not null,
  verified                boolean not null default false,
  is_primary              boolean not null default false,
  verification_token      uuid,
  verification_sent_at    timestamptz,
  verified_at             timestamptz,
  -- Forward-compatibility for per-team-member order routing; not used in v1
  -- but the column is here so we don't need another migration.
  contact_id              uuid references public.supplier_contacts(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists supplier_email_aliases_supplier_idx
  on public.supplier_email_aliases(supplier_id);

create index if not exists supplier_email_aliases_email_idx
  on public.supplier_email_aliases(lower(email));

-- Only one supplier can have a given verified email.
create unique index if not exists supplier_email_aliases_verified_email_unique
  on public.supplier_email_aliases(lower(email))
  where verified = true;

-- One primary alias per supplier.
create unique index if not exists supplier_email_aliases_one_primary_per_supplier
  on public.supplier_email_aliases(supplier_id)
  where is_primary = true;

-- ─── updated_at trigger ──────────────────────────────────────────────────
create trigger supplier_email_aliases_updated_at
  before update on public.supplier_email_aliases
  for each row execute function public.set_updated_at();

-- ─── resolve_supplier_profile_id ─────────────────────────────────────────
create or replace function public.resolve_supplier_profile_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select supplier_id
  from public.supplier_email_aliases
  where lower(email) = lower(p_email)
    and verified = true
  order by is_primary desc, created_at asc
  limit 1;
$$;

grant execute on function public.resolve_supplier_profile_id(text) to authenticated, anon;

-- ─── handle_new_supplier_profile: auto-create primary alias on insert ────
create or replace function public.handle_new_supplier_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_email text;
  v_verified boolean := false;
begin
  if new.contact_email is null then
    return new;
  end if;

  -- Match against the inserting user's auth email
  select email into v_auth_email
  from auth.users
  where id = auth.uid();

  if v_auth_email is not null
     and lower(v_auth_email) = lower(new.contact_email) then
    v_verified := true;
  end if;

  insert into public.supplier_email_aliases
    (supplier_id, email, verified, is_primary, verified_at)
  values
    (new.id, new.contact_email, v_verified, true,
     case when v_verified then now() else null end)
  on conflict do nothing;

  return new;
end;
$$;

create trigger supplier_profiles_create_primary_alias
  after insert on public.supplier_profiles
  for each row execute function public.handle_new_supplier_profile();

-- ─── set_supplier_profile_id_on_order ────────────────────────────────────
create or replace function public.set_supplier_profile_id_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.supplier_profile_id is null and new.supplier_email is not null then
    new.supplier_profile_id := public.resolve_supplier_profile_id(new.supplier_email);
  end if;
  return new;
end;
$$;

create trigger supplier_orders_set_profile_id
  before insert on public.supplier_orders
  for each row execute function public.set_supplier_profile_id_on_order();

-- ─── backfill_orders_on_alias_verified ───────────────────────────────────
create or replace function public.backfill_orders_on_alias_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only act when verified flipped from false to true (or on insert with verified=true).
  if (tg_op = 'INSERT' and new.verified = true)
     or (tg_op = 'UPDATE' and new.verified = true and coalesce(old.verified, false) = false) then
    update public.supplier_orders
    set supplier_profile_id = new.supplier_id
    where supplier_profile_id is null
      and supplier_email is not null
      and lower(supplier_email) = lower(new.email);
  end if;
  return new;
end;
$$;

create trigger supplier_email_aliases_backfill_orders
  after insert or update of verified on public.supplier_email_aliases
  for each row execute function public.backfill_orders_on_alias_verified();

-- ─── RLS on supplier_email_aliases ───────────────────────────────────────
alter table public.supplier_email_aliases enable row level security;

-- Supplier team members read their org's aliases.
create policy "supplier_read_own_aliases"
  on public.supplier_email_aliases for select
  using (supplier_id = public.get_user_supplier_id());

-- v1: any supplier team member can insert/update/delete aliases for their org.
-- Migration B will tighten this to admins only via has_supplier_permission('aliases:manage').
create policy "supplier_insert_own_aliases"
  on public.supplier_email_aliases for insert
  with check (supplier_id = public.get_user_supplier_id());

create policy "supplier_update_own_aliases"
  on public.supplier_email_aliases for update
  using (supplier_id = public.get_user_supplier_id());

create policy "supplier_delete_own_aliases"
  on public.supplier_email_aliases for delete
  using (
    supplier_id = public.get_user_supplier_id()
    and is_primary = false  -- never delete the primary
  );

-- Anon can read aliases by verification token (for verification-link flow).
create policy "anon_read_aliases_by_token"
  on public.supplier_email_aliases for select
  to anon
  using (verification_token is not null);

-- Anon can update an alias to mark it verified via token (called from the
-- verification confirmation page). The RPC below does this with SECURITY DEFINER
-- so this policy is a belt-and-braces extra — may not be strictly needed.
create policy "anon_update_aliases_by_token"
  on public.supplier_email_aliases for update
  to anon
  using (verification_token is not null);

-- ─── verify_supplier_email_alias RPC ─────────────────────────────────────
create or replace function public.verify_supplier_email_alias(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias record;
begin
  select * into v_alias
  from public.supplier_email_aliases
  where verification_token = p_token
  limit 1;

  if v_alias is null then
    return jsonb_build_object('ok', false, 'error', 'token_not_found');
  end if;

  if v_alias.verified = true then
    return jsonb_build_object('ok', true, 'already_verified', true, 'supplier_id', v_alias.supplier_id);
  end if;

  -- Check no other supplier has verified this email in the meantime.
  if exists (
    select 1 from public.supplier_email_aliases
    where lower(email) = lower(v_alias.email)
      and verified = true
      and supplier_id <> v_alias.supplier_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'email_already_claimed');
  end if;

  update public.supplier_email_aliases
  set verified = true,
      verified_at = now(),
      verification_token = null
  where id = v_alias.id;

  return jsonb_build_object('ok', true, 'supplier_id', v_alias.supplier_id);
end;
$$;

grant execute on function public.verify_supplier_email_alias(uuid) to anon, authenticated;

-- ─── supplier_profiles.home_currency ─────────────────────────────────────
alter table public.supplier_profiles
  add column if not exists home_currency text not null default 'EUR';

-- ─── get_supplier_kpis RPC ───────────────────────────────────────────────
-- Returns per-currency aggregates (the frontend will convert to home_currency
-- using its Frankfurter cache).
create or replace function public.get_supplier_kpis(
  p_supplier_id uuid,
  p_from_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_supplier uuid;
  v_today date := current_date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_last_month_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_last_month_end date := (date_trunc('month', v_today) - interval '1 day')::date;
  v_ytd_start date := date_trunc('year', v_today)::date;
  v_90_days_ago date := v_today - interval '90 days';
  v_7_days_out date := v_today + interval '7 days';
  v_result jsonb;
begin
  -- Security: caller must belong to this supplier.
  v_caller_supplier := public.get_user_supplier_id();
  if v_caller_supplier is null or v_caller_supplier <> p_supplier_id then
    return jsonb_build_object('error', 'forbidden');
  end if;

  with order_stats as (
    select
      count(*) filter (where status = 'sent' or status = 'draft')                        as orders_new,
      count(*) filter (where status in ('confirmed','partially_confirmed'))              as orders_in_progress,
      count(*) filter (where status = 'confirmed' and confirmed_at >= v_month_start)     as orders_delivered_this_month,
      count(*)                                                                            as orders_total,
      count(distinct tenant_id) filter (where created_at >= v_90_days_ago)                as active_clients
    from public.supplier_orders
    where supplier_profile_id = p_supplier_id
  ),
  invoice_revenue_month as (
    select currency, coalesce(sum(amount), 0) as total
    from public.supplier_invoices
    where supplier_id = p_supplier_id
      and status in ('paid','sent')
      and issue_date >= v_month_start
    group by currency
  ),
  invoice_revenue_last_month as (
    select currency, coalesce(sum(amount), 0) as total
    from public.supplier_invoices
    where supplier_id = p_supplier_id
      and status in ('paid','sent')
      and issue_date between v_last_month_start and v_last_month_end
    group by currency
  ),
  invoice_revenue_ytd as (
    select currency, coalesce(sum(amount), 0) as total
    from public.supplier_invoices
    where supplier_id = p_supplier_id
      and status in ('paid','sent')
      and issue_date >= v_ytd_start
    group by currency
  ),
  invoice_outstanding as (
    select currency, coalesce(sum(amount), 0) as total
    from public.supplier_invoices
    where supplier_id = p_supplier_id
      and status in ('sent','overdue')
    group by currency
  ),
  delivery_stats as (
    select
      count(*) filter (where scheduled_date between v_today and v_7_days_out
                         and status in ('scheduled','en_route'))              as scheduled_7d,
      count(*) filter (where status = 'delivered'
                         and scheduled_date >= v_month_start)                  as completed_this_month,
      -- On-time rate: of deliveries completed in last 90 days, how many
      -- had status='delivered' (no explicit actual-delivered-date column yet,
      -- so this is a rough proxy — refine in Phase 2).
      case
        when count(*) filter (where scheduled_date >= v_90_days_ago
                                and status in ('delivered','failed','rescheduled')) = 0
        then null
        else round(
          100.0 * count(*) filter (where scheduled_date >= v_90_days_ago
                                     and status = 'delivered')
          / nullif(count(*) filter (where scheduled_date >= v_90_days_ago
                                      and status in ('delivered','failed','rescheduled')), 0),
          1
        )
      end                                                                      as on_time_rate
    from public.supplier_deliveries
    where supplier_id = p_supplier_id
  )
  select jsonb_build_object(
    'orders', jsonb_build_object(
      'total',                       (select orders_total from order_stats),
      'new',                         (select orders_new from order_stats),
      'in_progress',                 (select orders_in_progress from order_stats),
      'delivered_this_month',        (select orders_delivered_this_month from order_stats),
      'active_clients_90d',          (select active_clients from order_stats)
    ),
    'revenue', jsonb_build_object(
      'this_month',  coalesce((select jsonb_object_agg(currency, total) from invoice_revenue_month), '{}'::jsonb),
      'last_month',  coalesce((select jsonb_object_agg(currency, total) from invoice_revenue_last_month), '{}'::jsonb),
      'ytd',         coalesce((select jsonb_object_agg(currency, total) from invoice_revenue_ytd), '{}'::jsonb),
      'outstanding', coalesce((select jsonb_object_agg(currency, total) from invoice_outstanding), '{}'::jsonb)
    ),
    'deliveries', jsonb_build_object(
      'scheduled_7d',        (select scheduled_7d from delivery_stats),
      'completed_this_month',(select completed_this_month from delivery_stats),
      'on_time_rate',        (select on_time_rate from delivery_stats)
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_supplier_kpis(uuid, date) to authenticated;

-- ─── One-time backfills ──────────────────────────────────────────────────
-- Backfill: create primary alias rows for every existing supplier_profiles
-- row that doesn't already have one. Mark verified if an owner-role contact
-- has a matching auth user email.
insert into public.supplier_email_aliases (supplier_id, email, verified, is_primary, verified_at)
select
  sp.id,
  sp.contact_email,
  exists (
    select 1 from public.supplier_contacts sc
    join auth.users u on u.id = sc.user_id
    where sc.supplier_id = sp.id
      and sc.role = 'owner'
      and lower(u.email) = lower(sp.contact_email)
  ),
  true,
  case when exists (
    select 1 from public.supplier_contacts sc
    join auth.users u on u.id = sc.user_id
    where sc.supplier_id = sp.id
      and sc.role = 'owner'
      and lower(u.email) = lower(sp.contact_email)
  ) then now() else null end
from public.supplier_profiles sp
where sp.contact_email is not null
  and not exists (
    select 1 from public.supplier_email_aliases a
    where a.supplier_id = sp.id and a.is_primary = true
  );

-- Backfill: link any existing supplier_orders where the email matches
-- a now-verified alias. The trigger only fires on future inserts/updates.
update public.supplier_orders so
set supplier_profile_id = (
  select a.supplier_id
  from public.supplier_email_aliases a
  where a.verified = true
    and lower(a.email) = lower(so.supplier_email)
  limit 1
)
where so.supplier_profile_id is null
  and so.supplier_email is not null;

-- Verification queries (run manually after apply):
-- select count(*) from public.supplier_email_aliases;
-- select count(*) from public.supplier_orders where supplier_profile_id is not null;
-- select public.get_supplier_kpis((select id from public.supplier_profiles limit 1));
