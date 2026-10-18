-- purge_vessel_data: some vessel tables store tenant_id as text, not uuid —
-- compare as text so every table is covered (found by a rolled-back dry run).

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
        execute format('delete from public.%I where tenant_id::text = $1', tbl) using p_tenant::text;
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

revoke all on function public.purge_vessel_data(uuid) from public, anon, authenticated;
grant execute on function public.purge_vessel_data(uuid) to service_role;
