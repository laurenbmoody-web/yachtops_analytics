-- Vessel lifecycle after a plan ends — what the Terms promise:
--   • the vessel keeps full access until the end of the paid period (Stripe
--     keeps the subscription "active" until then);
--   • when the subscription ends (status canceled / unpaid / incomplete_expired)
--     the vessel is locked: crew keep their own profile and records, the admin
--     can resubscribe or export the vessel's data;
--   • day 60 after it ends → reminder email to the vessel admin;
--   • day 90 → the vessel's data is permanently deleted, except crew's own
--     records (sea service, personal documents, credentials), supplier-side
--     business records, and Cargo's billing/legal records.
-- Complimentary vessels (Horizon, internal/demo vessels) never lock or delete.
--
-- The daily vessel-lifecycle edge function drives the reminder + deletion.

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.tenants add column if not exists complimentary boolean not null default false;
alter table public.tenants add column if not exists complimentary_note text;
alter table public.tenants add column if not exists access_ended_at timestamptz;
alter table public.tenants add column if not exists deletion_warning_sent_at timestamptz;
alter table public.tenants add column if not exists data_deleted_at timestamptz;

-- ── Billing columns are Cargo's to set, not the vessel's ─────────────────────
-- Command can update its own tenants row (vessel settings), so guard the
-- billing/lifecycle columns: only the service role (webhooks, edge functions)
-- and definer functions owned by postgres may change them.
create or replace function public.tenants_guard_billing_columns()
returns trigger
language plpgsql
as $$
declare
  privileged boolean := coalesce(auth.role(), '') = 'service_role'
                        or current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.complimentary := false;
    new.complimentary_note := null;
    new.access_ended_at := null;
    new.deletion_warning_sent_at := null;
    new.data_deleted_at := null;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.subscription_status := null;
    new.current_period_end := null;
    new.cancel_at_period_end := false;
    new.terms_version := null;
    new.terms_accepted_at := null;
    new.terms_accepted_by_name := null;
    return new;
  end if;

  if new.complimentary is distinct from old.complimentary
     or new.complimentary_note is distinct from old.complimentary_note
     or new.access_ended_at is distinct from old.access_ended_at
     or new.deletion_warning_sent_at is distinct from old.deletion_warning_sent_at
     or new.data_deleted_at is distinct from old.data_deleted_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.plan_tier is distinct from old.plan_tier
     or new.billing_period is distinct from old.billing_period
     or new.current_period_end is distinct from old.current_period_end
     or new.cancel_at_period_end is distinct from old.cancel_at_period_end
     or new.customer_legal_name is distinct from old.customer_legal_name
     or new.customer_country is distinct from old.customer_country
     or new.terms_version is distinct from old.terms_version
     or new.terms_accepted_at is distinct from old.terms_accepted_at
     or new.terms_accepted_by_name is distinct from old.terms_accepted_by_name
  then
    raise exception 'Billing details can only be changed by Cargo.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tenants_guard_billing on public.tenants;
create trigger trg_tenants_guard_billing
  before insert or update on public.tenants
  for each row execute function public.tenants_guard_billing_columns();

-- ── Start / stop the clock when the subscription ends / restarts ─────────────
create or replace function public.tenants_track_access_end()
returns trigger
language plpgsql
as $$
begin
  if new.subscription_status in ('canceled', 'unpaid', 'incomplete_expired')
     and not new.complimentary then
    if old.subscription_status is distinct from new.subscription_status or new.access_ended_at is null then
      new.access_ended_at := coalesce(new.access_ended_at, now());
    end if;
  elsif new.subscription_status in ('active', 'trialing', 'past_due') or new.complimentary then
    new.access_ended_at := null;
    new.deletion_warning_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tenants_track_access_end on public.tenants;
create trigger trg_tenants_track_access_end
  before update of subscription_status, complimentary on public.tenants
  for each row execute function public.tenants_track_access_end();

-- Vessels whose subscription has already ended start the 90 days now.
update public.tenants
   set access_ended_at = now()
 where subscription_status in ('canceled', 'unpaid', 'incomplete_expired')
   and not complimentary
   and access_ended_at is null;

-- ── Which vessels need the reminder / deletion today (service role) ──────────
create or replace function public.get_vessels_lifecycle_due()
returns table (
  tenant_id uuid,
  vessel_name text,
  stage text,
  access_ended_at timestamptz,
  deletion_warning_sent_at timestamptz,
  stripe_subscription_id text,
  admin_email text,
  admin_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name,
         case when t.access_ended_at <= now() - interval '90 days'
                   and t.deletion_warning_sent_at is not null
                   and t.deletion_warning_sent_at <= now() - interval '7 days'
              then 'delete' else 'warn' end,
         t.access_ended_at, t.deletion_warning_sent_at, t.stripe_subscription_id,
         u.email::text,
         coalesce(p.full_name, u.raw_user_meta_data->>'full_name', '')::text
    from public.tenants t
    left join auth.users u on u.id = t.current_admin_user_id
    left join public.profiles p on p.id = t.current_admin_user_id
   where not t.complimentary
     and t.data_deleted_at is null
     and t.access_ended_at is not null
     and t.subscription_status in ('canceled', 'unpaid', 'incomplete_expired')
     and t.access_ended_at <= now() - interval '60 days'
     and (t.deletion_warning_sent_at is null
          or (t.access_ended_at <= now() - interval '90 days'
              and t.deletion_warning_sent_at <= now() - interval '7 days'));
$$;

-- ── Tables that hold the vessel's data (for export and deletion) ─────────────
-- Kept on deletion (never wiped with the vessel):
--   crew's own records  — sea service, personal documents, credentials,
--                          stamps, master signatures, device push tokens
--   supplier-side       — orders, deliveries, invoices, payments, threads,
--                          returns, reviews, supplier profiles (the supplier's
--                          business records)
--   Cargo's records     — customer agreements, terms acceptances, feedback,
--                          vessel registration
--   identity/structure  — tenants, vessels, tenant_members (deactivated) and
--                          tenant_custom_roles they point at
create or replace function public.vessel_kept_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'captain_credentials','crew_vessel_stamps','master_signatures','personal_documents',
    'sea_service_audit','sea_service_entries','sea_service_sign_requests','push_subscriptions',
    'supplier_deliveries','supplier_invoices','supplier_message_threads','supplier_orders',
    'supplier_payments','supplier_profiles','supplier_return_tasks','supplier_reviews',
    'customer_agreements','terms_acceptances','feedback','vessel_registrations',
    'tenants','vessels','tenant_members','tenant_custom_roles'
  ]::text[];
$$;

create or replace function public.vessel_data_tables()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}')
    from information_schema.columns c
    join information_schema.tables x
      on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'tenant_id';
$$;

-- Storage files that belong to the vessel (deleted with it). Crew's own files
-- (avatars, crew documents, credentials, sea-service testimonials, signatures)
-- live under user ids and are not touched.
create or replace function public.vessel_storage_paths(p_tenant uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public, storage
as $$
  select o.bucket_id::text, o.name::text
    from storage.objects o
   where (o.bucket_id in ('laundry-photos','vessel-scans','vessel-vault','hor-documents',
                          'vessel-assets','vessel-documents','ledger-receipts','feedback-audio')
          and o.name like p_tenant::text || '/%')
      or (o.bucket_id = 'item-images' and o.name like 'inventory/' || p_tenant::text || '/%');
$$;

-- ── Permanent deletion (service role only) ───────────────────────────────────
create or replace function public.purge_vessel_data(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tenants%rowtype;
  keep text[] := public.vessel_kept_tables();
  remaining text[];
  stuck text[];
  tbl text;
  n bigint;
  pass int;
  summary jsonb := '{}'::jsonb;
begin
  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'vessel % not found', p_tenant; end if;
  if t.data_deleted_at is not null then
    return jsonb_build_object('already_deleted_at', t.data_deleted_at);
  end if;
  if t.complimentary then raise exception 'complimentary vessel — never deleted'; end if;
  if t.subscription_status is null or t.subscription_status not in ('canceled', 'unpaid', 'incomplete_expired') then
    raise exception 'subscription has not ended (status %)', coalesce(t.subscription_status, 'none');
  end if;
  if t.access_ended_at is null or t.access_ended_at > now() - interval '90 days' then
    raise exception 'plan ended less than 90 days ago';
  end if;

  select coalesce(array_agg(x), '{}') into remaining
    from unnest(public.vessel_data_tables()) x
   where not (x = any(keep));

  -- Delete in passes: a table blocked by a foreign key is retried after the
  -- tables that reference it are gone. Any table still blocked aborts the
  -- whole deletion (nothing is deleted).
  for pass in 1..10 loop
    stuck := '{}';
    foreach tbl in array remaining loop
      begin
        execute format('delete from public.%I where tenant_id = $1', tbl) using p_tenant;
        get diagnostics n = row_count;
        if n > 0 then
          summary := summary || jsonb_build_object(tbl, coalesce((summary->>tbl)::bigint, 0) + n);
        end if;
      exception when foreign_key_violation or restrict_violation then
        stuck := stuck || tbl;
      end;
    end loop;
    exit when cardinality(stuck) = 0 or stuck = remaining;
    remaining := stuck;
  end loop;
  if cardinality(stuck) > 0 then
    raise exception 'could not delete vessel data from: %', array_to_string(stuck, ', ');
  end if;

  -- Crew keep their accounts; the vessel relationship ends.
  update public.tenant_members set active = false where tenant_id = p_tenant and active;
  update public.push_subscriptions set tenant_id = null where tenant_id = p_tenant;

  update public.tenants
     set data_deleted_at = now(),
         current_admin_user_id = null,
         approval_routing = '{}'::jsonb,
         dismissed_tasks = '{}'
   where id = p_tenant;

  return jsonb_build_object('deleted_rows', summary);
end;
$$;

revoke all on function public.get_vessels_lifecycle_due() from public, anon, authenticated;
revoke all on function public.vessel_data_tables() from public, anon, authenticated;
revoke all on function public.vessel_storage_paths(uuid) from public, anon, authenticated;
revoke all on function public.purge_vessel_data(uuid) from public, anon, authenticated;
grant execute on function public.get_vessels_lifecycle_due() to service_role;
grant execute on function public.vessel_data_tables() to service_role;
grant execute on function public.vessel_storage_paths(uuid) to service_role;
grant execute on function public.purge_vessel_data(uuid) to service_role;

-- ── Daily run (07:40 UTC) ────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vessel-lifecycle-daily') then
    perform cron.unschedule('vessel-lifecycle-daily');
  end if;
end $$;

select cron.schedule(
  'vessel-lifecycle-daily',
  '40 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://gwexbrbasfysbheeklyq.supabase.co/functions/v1/vessel-lifecycle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZXhicmJhc2Z5c2JoZWVrbHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTc5NDksImV4cCI6MjA4NDgzMzk0OX0.dfUXJ2ZepeZ4bNSKGjhoxwI-FgXMSU-lF465eGlWQ5M'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
