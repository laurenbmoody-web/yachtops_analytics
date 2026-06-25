-- A declined public sign-off now lands the days in 'rejected' (with the reason),
-- the same state the in-app reject uses — so the crew's Step 03 shows a
-- "Declined" row + the reason instead of silently reverting to "Email for
-- signature". The days stay unlocked so they can be corrected and resent.
create or replace function public.decline_sea_service_sign_request(p_token text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sea_service_sign_requests;
begin
  select * into r from public.sea_service_sign_requests where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', r.status); end if;
  update public.sea_service_entries
     set verification_status='rejected', rejection_reason=nullif(btrim(p_reason),''),
         submitted_at=null, submitted_by=null, locked=false, updated_at=now()
   where id = any(r.row_ids) and verification_status = 'pending';
  update public.sea_service_sign_requests set status='declined', decline_reason=p_reason where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.decline_sea_service_sign_request(text,text) to anon, authenticated;
