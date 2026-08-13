-- Roster crew — crew who are on the vessel's roster but have no login yet.
--
-- A roster crew member is a *real* user record (auth user + profile +
-- tenant_members row) whose account simply has no usable email and no
-- password, so every user_id-keyed feature — rota, jobs, hours of rest,
-- laundry, documents, crew profile — treats them exactly like anyone else.
-- What they cannot do is sign in: the auth row carries a non-routable
-- placeholder address (@roster.cargo.invalid, an RFC 2606 reserved TLD) and
-- no credentials, and profiles.email is left NULL so no placeholder address
-- ever surfaces in the UI or on an export.
--
-- When the vessel is ready to give them access, `rosterCrew` (edge function,
-- action 'activate') attaches the real email and password to that same user
-- record — so their whole history follows them into the account rather than
-- being stranded on an orphaned row.

-- ── 1. Flag on the profile ───────────────────────────────────────────────────
alter table public.profiles
  add column if not exists roster_only boolean not null default false;

comment on column public.profiles.roster_only is
  'True while this person is on the crew roster without a login. Their auth row holds a non-routable placeholder email and no password; profiles.email stays NULL. Cleared when an invite is accepted and real credentials are attached.';

-- ── 2. Link an invite back to the roster member it activates ─────────────────
alter table public.crew_invites
  add column if not exists roster_user_id uuid references public.profiles(id) on delete cascade;

comment on column public.crew_invites.roster_user_id is
  'Set when this invite gives an existing roster crew member their login. Acceptance attaches credentials to this user instead of creating a new account.';

create index if not exists crew_invites_roster_user_id_idx
  on public.crew_invites (roster_user_id)
  where roster_user_id is not null;

-- ── 3. Who may add / activate roster crew ────────────────────────────────────
-- Mirrors the crew-management page's `canInvite` rule (COMMAND, CHIEF or
-- MANAGEMENT). Takes the user id explicitly because the rosterCrew edge
-- function calls it with the service role on behalf of the caller it has
-- already identified from their JWT — auth.uid() is not the caller there.
create or replace function public.can_manage_crew(p_user_id uuid, p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = p_user_id
      and tm.active     = true
      and (
        tm.permission_tier          in ('COMMAND', 'CHIEF', 'MANAGEMENT')
        or tm.permission_tier_override in ('COMMAND', 'CHIEF', 'MANAGEMENT')
        or tm.role                     in ('COMMAND', 'CHIEF', 'MANAGEMENT')
      )
  )
$$;

grant execute on function public.can_manage_crew(uuid, uuid) to authenticated, service_role;

-- ── 4. Tell the invite-accept page when an invite activates a roster member ──
-- Same function as before with `roster_activation` appended; the return type
-- changes, so it has to be dropped rather than replaced.
drop function if exists public.get_invite_public(text);

create function public.get_invite_public(p_token text)
returns table(
    success boolean,
    vessel_name text,
    vessel_type_label text,
    loa_m numeric,
    crew_count bigint,
    department_count bigint,
    email text,
    job_title_label text,
    department text,
    department_id uuid,
    role_id uuid,
    invitee_name text,
    error_message text,
    roster_activation boolean
)
language plpgsql
security definer
as $function$
DECLARE
    v_invite_record RECORD;
    v_vessel_name TEXT;
    v_vessel_type_label TEXT;
    v_loa_m NUMERIC;
    v_crew_count BIGINT;
    v_department_count BIGINT;
    v_role_name TEXT;
    v_department_name TEXT;
BEGIN
    SELECT * INTO v_invite_record
    FROM public.crew_invites
    WHERE token = p_token
      AND status = 'PENDING'
      AND (expires_at IS NULL OR expires_at > NOW());

    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::BIGINT, NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, 'Invite expired or invalid'::TEXT, false;
        RETURN;
    END IF;

    SELECT t.name, t.vessel_type_label, t.loa_m INTO v_vessel_name, v_vessel_type_label, v_loa_m
    FROM public.tenants t
    WHERE t.id = v_invite_record.tenant_id;

    SELECT count(*), count(DISTINCT tm.department_id) FILTER (WHERE tm.department_id IS NOT NULL)
    INTO v_crew_count, v_department_count
    FROM public.tenant_members tm
    WHERE tm.tenant_id = v_invite_record.tenant_id
      AND tm.active = true;

    IF v_invite_record.role_id IS NOT NULL THEN
        SELECT r.name INTO v_role_name
        FROM public.roles r
        WHERE r.id = v_invite_record.role_id;
    END IF;

    IF v_invite_record.department_id IS NOT NULL THEN
        SELECT d.name INTO v_department_name
        FROM public.departments d
        WHERE d.id = v_invite_record.department_id;
    END IF;

    RETURN QUERY SELECT
        true,
        COALESCE(v_vessel_name, 'Unknown Vessel'),
        v_vessel_type_label,
        v_loa_m,
        COALESCE(v_crew_count, 0),
        COALESCE(v_department_count, 0),
        v_invite_record.email,
        COALESCE(v_role_name, v_invite_record.role_label, v_invite_record.job_title_label, 'Not set'),
        COALESCE(v_department_name, v_invite_record.department_label, v_invite_record.department, 'Not set'),
        v_invite_record.department_id,
        v_invite_record.role_id,
        v_invite_record.invitee_name,
        NULL::TEXT,
        (v_invite_record.roster_user_id IS NOT NULL);

EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::BIGINT, NULL::BIGINT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, SQLERRM::TEXT, false;
END;
$function$;

grant execute on function public.get_invite_public(text) to anon, authenticated, service_role;
