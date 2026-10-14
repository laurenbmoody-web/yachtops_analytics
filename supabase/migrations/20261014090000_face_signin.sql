-- Face sign-in at the gangway — enrolment, and matching that happens in the
-- database rather than on the iPad.
--
-- WHY THE MATCHING IS SERVER-SIDE
-- The obvious build is: download every crew member's face template to the door
-- iPad and compare locally. That would mean a shared kiosk holding the biometric
-- templates of the whole crew, readable by anyone who can open devtools on it.
-- Instead the iPad sends the ONE template it just computed from the camera, and
-- `match_face` compares it in SQL and returns a name. No client ever selects a
-- stored template — there is deliberately no SELECT policy granting it.
--
-- WHAT IS STORED
-- A 128-float descriptor per enrolment, which is the output of a face-embedding
-- model. Not a photograph: the image is discarded in the browser the moment the
-- descriptor is computed, and nothing in this schema can hold one. The descriptor
-- is still biometric data for the purpose of uniquely identifying someone, which
-- is why consent is a NOT NULL column rather than a checkbox someone remembers.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- There is no liveness detection — a 2D camera will accept a photograph held up
-- to it. That is why this is a convenience over the existing board and not a
-- replacement for it: the door still asks for a confirm tap, tapping your own
-- tile still works, and every face-driven change is logged with source 'face' so
-- it can be audited after the fact. The muster list must stay trustworthy.
--
-- OPT-IN AT TWO LEVELS
--   * the vessel turns it on (vessels.face_signin_enabled, default false)
--   * each crew member enrols themselves, or never does
-- Nobody can be enrolled by someone else: the INSERT policy only lets you write
-- your own row. That is also what keeps consent meaningful — see the ICO's 2024
-- Serco Leisure enforcement, where biometric attendance was ordered stopped
-- partly because staff had no genuine alternative.

-- ── vessel switch ───────────────────────────────────────────────────────────
alter table public.vessels
  add column if not exists face_signin_enabled boolean not null default false;

comment on column public.vessels.face_signin_enabled is
  'Opt-in: show face sign-in on the gangway board. Tapping a tile always works regardless.';

-- ── enrolments ──────────────────────────────────────────────────────────────
create table if not exists public.crew_face_enrolments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- 128 floats from the embedding model, L2-normalised. Length is enforced so a
  -- malformed vector can't silently poison matching for the whole crew.
  descriptor    double precision[] not null,

  -- Which capture of the several taken at enrolment this is (different angles
  -- and lighting), kept so one bad frame can be dropped without re-enrolling.
  capture_index smallint not null default 0,

  -- Consent is recorded, not assumed. The version string lets us tell who
  -- agreed to which wording if the copy changes.
  consent_at            timestamptz not null default now(),
  consent_text_version  text not null,

  created_at    timestamptz not null default now(),
  -- The device/session the enrolment was made from, for an audit trail.
  created_by    uuid references auth.users(id) on delete set null,

  constraint crew_face_descriptor_len check (array_length(descriptor, 1) = 128),
  constraint crew_face_enrolment_unique unique (tenant_id, user_id, capture_index)
);

comment on table public.crew_face_enrolments is
  'Face templates for gangway sign-in. Templates only, never images. Read exclusively through match_face() — no client SELECT.';

create index if not exists idx_crew_face_enrolments_tenant
  on public.crew_face_enrolments (tenant_id);

alter table public.crew_face_enrolments enable row level security;

-- You may see THAT you are enrolled (so the UI can offer "remove my face data"),
-- but the policy below is intentionally the only read, and the service layer
-- selects id/capture_index/created_at — never `descriptor`. Column privileges
-- make that a guarantee rather than a convention.
drop policy if exists crew_face_select_own on public.crew_face_enrolments;
create policy crew_face_select_own on public.crew_face_enrolments
  for select using (user_id = auth.uid());

-- Enrol yourself, and only yourself.
drop policy if exists crew_face_insert_own on public.crew_face_enrolments;
create policy crew_face_insert_own on public.crew_face_enrolments
  for insert with check (
    user_id = auth.uid()
    and public.is_active_tenant_member(tenant_id, auth.uid())
  );

-- Withdraw consent at any time. Command can also delete — an offboarded crew
-- member's template should not outlive them on the vessel.
drop policy if exists crew_face_delete_own_or_command on public.crew_face_enrolments;
create policy crew_face_delete_own_or_command on public.crew_face_enrolments
  for delete using (
    user_id = auth.uid() or public.is_tenant_command(tenant_id)
  );

-- No UPDATE policy: a template is replaced by delete + insert, so there is no
-- path that edits someone else's biometric data in place.

-- Revoke the descriptor column from clients outright. Even with the SELECT
-- policy above, PostgREST cannot return it.
revoke all on public.crew_face_enrolments from anon, authenticated;
grant select (id, tenant_id, user_id, capture_index, consent_at, consent_text_version, created_at)
  on public.crew_face_enrolments to authenticated;
grant insert, delete on public.crew_face_enrolments to authenticated;

-- ── the matcher ─────────────────────────────────────────────────────────────
-- Squared euclidean distance, so the comparison needs no sqrt per candidate; the
-- caller gets the real distance back for the one winner only.
create or replace function public.face_distance_sq(a double precision[], b double precision[])
returns double precision
language sql
immutable
parallel safe
as $$
  select coalesce(sum((a[i] - b[i]) * (a[i] - b[i])), 'Infinity'::double precision)
  from generate_subscripts(a, 1) as i
$$;

-- Returns at most one row: the best candidate, plus the runner-up distance so
-- the caller can refuse an ambiguous match (two crew who look alike) instead of
-- guessing. Returns no row when nobody is close enough.
--
-- NOT named get_*/fetch_*/list_*/is_*/my_* on purpose: those prefixes are
-- treated as cacheable reads by the offline layer (see lib/offline/readCache.js)
-- and a face match served from a stale cache would be worse than no match. Face
-- sign-in therefore needs connectivity; tapping a tile does not.
create or replace function public.match_face(
  p_tenant     uuid,
  p_descriptor double precision[],
  p_max_distance double precision default 0.5
)
returns table (
  user_id        uuid,
  display_name   text,
  distance       double precision,
  runner_up      double precision,
  enrolled_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_best_user uuid;
  v_best      double precision;
  v_second    double precision;
begin
  -- Only an active member of the vessel may ask, and only about their own vessel.
  if not public.is_active_tenant_member(p_tenant, auth.uid()) then
    raise exception 'not a member of this vessel' using errcode = '42501';
  end if;

  if p_descriptor is null or array_length(p_descriptor, 1) <> 128 then
    raise exception 'descriptor must be 128 floats' using errcode = '22023';
  end if;

  -- Best distance per enrolled person (several captures each, nearest wins),
  -- then the best two people overall.
  with per_person as (
    select e.user_id as uid, min(public.face_distance_sq(e.descriptor, p_descriptor)) as d
    from public.crew_face_enrolments e
    where e.tenant_id = p_tenant
    group by e.user_id
  ), ranked as (
    select uid, d, row_number() over (order by d asc) as rn
    from per_person
  )
  select
    max(case when rn = 1 then uid end),
    max(case when rn = 1 then d end),
    max(case when rn = 2 then d end)
  into v_best_user, v_best, v_second
  from ranked
  where rn <= 2;

  if v_best_user is null then
    return; -- nobody on this vessel has enrolled
  end if;

  -- Compare in squared space against a squared threshold.
  if v_best > (p_max_distance * p_max_distance) then
    return; -- closest enrolled face is still not close enough
  end if;

  return query
  select
    v_best_user,
    coalesce(nullif(tm.display_name, ''), nullif(p.full_name, ''), 'Crew')::text,
    sqrt(v_best),
    case when v_second is null then null else sqrt(v_second) end,
    (select count(*)::integer from public.crew_face_enrolments e2
      where e2.tenant_id = p_tenant and e2.user_id = v_best_user)
  from public.tenant_members tm
  left join public.profiles p on p.id = tm.user_id
  where tm.tenant_id = p_tenant
    and tm.user_id = v_best_user
    and tm.active = true;
end;
$$;

revoke all on function public.match_face(uuid, double precision[], double precision) from public;
grant execute on function public.match_face(uuid, double precision[], double precision) to authenticated;

comment on function public.match_face is
  'Best enrolled face for a probe descriptor on one vessel. Templates stay in the database; callers get a name and a distance.';
