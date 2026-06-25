-- Public, token-based captain sign-off for sea service performed under a master
-- who has no Cargo account (the "email for signature" route). Mirrors the
-- supplier delivery-sign pattern: a request row holds an unguessable token and a
-- display snapshot. Possession of the token IS the authorisation, mediated only
-- through the SECURITY DEFINER RPCs below — the table itself is never exposed to
-- anon, and each RPC only ever touches the row_ids captured in its own request.

create table if not exists public.sea_service_sign_requests (
  id               uuid primary key default gen_random_uuid(),
  token            text unique not null default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  tenant_id        uuid not null,
  seafarer_user_id uuid not null,
  seafarer_name    text,
  vessel_name      text,
  captain_name     text,
  captain_email    text,
  row_ids          uuid[] not null,
  snapshot         jsonb not null default '{}'::jsonb,
  status           text not null default 'pending' check (status in ('pending','signed','declined','expired')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '30 days'),
  signed_at        timestamptz,
  signed_name      text,
  signer_coc       text,
  signer_coc_grade text,
  signer_email     text,
  signer_phone     text,
  signer_place     text,
  cmd_from         date,
  cmd_to           date,
  signature_data   text,
  decline_reason   text
);

create index if not exists idx_sssr_token on public.sea_service_sign_requests(token);
create index if not exists idx_sssr_seafarer on public.sea_service_sign_requests(seafarer_user_id);

alter table public.sea_service_sign_requests enable row level security;

-- Seafarers can read their own requests in-app (to see status / re-share the
-- link). All writes go through the SECURITY DEFINER RPCs, so there are no
-- INSERT/UPDATE policies and anon gets no direct table access at all.
drop policy if exists sssr_owner_select on public.sea_service_sign_requests;
create policy sssr_owner_select on public.sea_service_sign_requests
  for select to authenticated using (seafarer_user_id = auth.uid());

-- ── create: the seafarer mints a request for rows they own ──────────────────
create or replace function public.create_sea_service_sign_request(
  p_row_ids uuid[], p_captain_name text, p_captain_email text, p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid; v_vessel text; v_name text; v_cnt int;
  v_token text; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select count(*), min(tenant_id), min(vessel_name)
    into v_cnt, v_tenant, v_vessel
    from public.sea_service_entries
   where id = any(p_row_ids) and user_id = v_uid;
  if coalesce(v_cnt,0) = 0 or v_cnt <> coalesce(array_length(p_row_ids,1),0) then
    raise exception 'rows not found or not owned by caller';
  end if;
  select full_name into v_name from public.profiles where id = v_uid;

  insert into public.sea_service_sign_requests
    (tenant_id, seafarer_user_id, seafarer_name, vessel_name, captain_name, captain_email, row_ids, snapshot)
  values (v_tenant, v_uid, v_name, v_vessel, p_captain_name, nullif(trim(p_captain_email),''), p_row_ids, coalesce(p_snapshot,'{}'::jsonb))
  returning id, token into v_id, v_token;

  update public.sea_service_entries
     set verification_status='pending', submitted_at=now(), submitted_by=v_uid, updated_at=now()
   where id = any(p_row_ids) and user_id = v_uid and verification_status <> 'captain_signed';

  return jsonb_build_object('token', v_token, 'request_id', v_id);
end $$;
grant execute on function public.create_sea_service_sign_request(uuid[],text,text,jsonb) to authenticated;

-- ── fetch: public read by token (display only) ──────────────────────────────
create or replace function public.fetch_sea_service_sign_request(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sea_service_sign_requests;
begin
  select * into r from public.sea_service_sign_requests where token = p_token;
  if not found then return null; end if;
  if r.status = 'pending' and r.expires_at <= now() then
    update public.sea_service_sign_requests set status='expired' where id = r.id;
    r.status := 'expired';
  end if;
  return jsonb_build_object(
    'status', r.status, 'seafarer_name', r.seafarer_name, 'vessel_name', r.vessel_name,
    'captain_name', r.captain_name, 'snapshot', r.snapshot, 'expires_at', r.expires_at,
    'signed_at', r.signed_at, 'signed_name', r.signed_name
  );
end $$;
grant execute on function public.fetch_sea_service_sign_request(text) to anon, authenticated;

-- ── sign: public write by token (only the request's own pending rows) ───────
create or replace function public.sign_sea_service_sign_request(
  p_token text, p_signer_name text, p_coc_no text, p_coc_grade text, p_email text,
  p_phone text, p_place text, p_cmd_from date, p_cmd_to date, p_signature text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sea_service_sign_requests;
begin
  select * into r from public.sea_service_sign_requests where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', r.status); end if;
  if r.expires_at <= now() then
    update public.sea_service_sign_requests set status='expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if coalesce(trim(p_signer_name),'') = '' then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;

  update public.sea_service_entries set
     verification_status='captain_signed', signed_name=p_signer_name, signed_at=now(),
     signed_by=null, locked=true,
     master_name = coalesce(nullif(master_name,''), 'Capt. ' || p_signer_name),
     signature_path = 'sign-request:' || r.id::text, updated_at=now()
   where id = any(r.row_ids) and verification_status = 'pending';

  update public.sea_service_sign_requests set
     status='signed', signed_at=now(), signed_name=p_signer_name, signer_coc=p_coc_no,
     signer_coc_grade=p_coc_grade, signer_email=p_email, signer_phone=p_phone,
     signer_place=p_place, cmd_from=p_cmd_from, cmd_to=p_cmd_to, signature_data=p_signature
   where id = r.id;

  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.sign_sea_service_sign_request(text,text,text,text,text,text,text,date,date,text) to anon, authenticated;

-- ── decline: public, hands the days back to the seafarer as draft ───────────
create or replace function public.decline_sea_service_sign_request(p_token text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sea_service_sign_requests;
begin
  select * into r from public.sea_service_sign_requests where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', r.status); end if;
  update public.sea_service_entries
     set verification_status='draft', submitted_at=null, submitted_by=null, updated_at=now()
   where id = any(r.row_ids) and verification_status = 'pending';
  update public.sea_service_sign_requests set status='declined', decline_reason=p_reason where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.decline_sea_service_sign_request(text,text) to anon, authenticated;
