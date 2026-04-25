-- Add invited-teammate name to supplier_invites so the signup flow can
-- pre-fill the Full name field (and the invite email can address the
-- person by name).

alter table public.supplier_invites
  add column if not exists name text;

-- ─── get_supplier_invite_public (now returns name) ───────────────────────
-- Same signature and shape as the v1 in 20260425120000, with the
-- extra top-level `name` field. SECURITY DEFINER, anon-callable so the
-- accept-invite page works without a session.

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
    'name', v_invite.name,
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

-- Verification queries (run manually after apply):
-- select name from public.supplier_invites limit 1;
-- select public.get_supplier_invite_public((select token from public.supplier_invites limit 1));
