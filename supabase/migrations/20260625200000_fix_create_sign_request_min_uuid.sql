-- Fix: min(uuid) doesn't exist in Postgres — the original
-- create_sea_service_sign_request used min(tenant_id) and threw 42883 on every
-- call ("Could not create the signing link"). Derive tenant/vessel/owner via
-- array_agg instead. Also broaden authorization: the seafarer themselves OR a
-- COMMAND member of the tenant (acting on their behalf) may mint the request,
-- and it's always attributed to the seafarer (row owner) so notifications land
-- on them — not on whoever clicked.
create or replace function public.create_sea_service_sign_request(
  p_row_ids uuid[], p_captain_name text, p_captain_email text, p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid; v_vessel text; v_owner uuid; v_owners int; v_cnt int; v_name text;
  v_token text; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select count(*), count(distinct user_id),
         (array_agg(tenant_id))[1], (array_agg(vessel_name))[1], (array_agg(user_id))[1]
    into v_cnt, v_owners, v_tenant, v_vessel, v_owner
    from public.sea_service_entries where id = any(p_row_ids);
  if coalesce(v_cnt,0) = 0 or v_cnt <> coalesce(array_length(p_row_ids,1),0) then
    raise exception 'rows not found';
  end if;
  if v_owners <> 1 then raise exception 'rows span multiple seafarers'; end if;
  if not (v_owner = v_uid or public.is_command_user_in_tenant(v_tenant)) then
    raise exception 'not authorized for these rows';
  end if;
  select full_name into v_name from public.profiles where id = v_owner;

  insert into public.sea_service_sign_requests
    (tenant_id, seafarer_user_id, seafarer_name, vessel_name, captain_name, captain_email, row_ids, snapshot)
  values (v_tenant, v_owner, v_name, v_vessel, p_captain_name, nullif(trim(p_captain_email),''), p_row_ids, coalesce(p_snapshot,'{}'::jsonb))
  returning id, token into v_id, v_token;

  update public.sea_service_entries
     set verification_status='pending', submitted_at=now(), submitted_by=v_uid, updated_at=now()
   where id = any(p_row_ids) and verification_status <> 'captain_signed';

  return jsonb_build_object('token', v_token, 'request_id', v_id);
end $$;
grant execute on function public.create_sea_service_sign_request(uuid[],text,text,jsonb) to authenticated;
