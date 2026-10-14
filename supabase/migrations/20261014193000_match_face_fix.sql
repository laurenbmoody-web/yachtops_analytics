-- match_face: fix a crash, and stop leaning on PostgREST default-arg resolution.
--
-- Two faults, both surfaced by the first real test at the gangway, where the
-- board reported "can't use the camera" when the camera was working fine.
--
-- 1. THE FUNCTION CRASHED THE MOMENT IT RAN. It picked the best two candidates
--    with `max(case when rn = 1 then uid end)` over a uuid column, and min/max
--    aggregates for uuid do not exist before PostgreSQL 18. This project runs
--    17, so every call raised 42883 "function max(uuid) does not exist".
--    Replaced with a plain loop over an ordered pair — clearer regardless.
--
--    This got shipped because the only thing verified beforehand was
--    face_distance_sq against synthetic vectors: the distance maths, not the
--    function that uses it. The function itself is now exercised directly, as
--    an authenticated caller, and the three cases that matter all hold:
--      * a stored template matches its own owner at distance 0
--      * a stranger's descriptor returns NO row rather than a nearest guess
--      * a caller who is not an active member of the vessel is refused (42501)
--
-- 2. THE IPAD GOT A FLAT 404 from POST /rest/v1/rpc/match_face. The client sent
--    only p_tenant and p_descriptor, leaning on the SQL default for
--    p_max_distance. PostgREST resolves an RPC by the set of argument names in
--    the request body, so that call matched nothing and 404'd even though the
--    function was present and executable. The client now always sends all
--    three, which also makes faceGate.MATCH_DISTANCE the single source of the
--    threshold instead of keeping a second copy as a SQL default that could
--    drift away from it.
--
--    The default stays on the signature for anyone calling this from SQL.

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
  r           record;
begin
  -- Only an active member of the vessel may ask, and only about their vessel.
  if not public.is_active_tenant_member(p_tenant, auth.uid()) then
    raise exception 'not a member of this vessel' using errcode = '42501';
  end if;

  if p_descriptor is null or array_length(p_descriptor, 1) <> 128 then
    raise exception 'descriptor must be 128 floats' using errcode = '22023';
  end if;

  -- Nearest capture per person (each enrols several angles), then the two
  -- closest people. The runner-up travels back so the caller can refuse an
  -- ambiguous match instead of guessing between two crew who look alike.
  for r in
    select e.user_id as uid, min(public.face_distance_sq(e.descriptor, p_descriptor)) as d
    from public.crew_face_enrolments e
    where e.tenant_id = p_tenant
    group by e.user_id
    order by d asc
    limit 2
  loop
    if v_best_user is null then
      v_best_user := r.uid;
      v_best := r.d;
    else
      v_second := r.d;
    end if;
  end loop;

  if v_best_user is null then
    return; -- nobody on this vessel has enrolled
  end if;

  -- Distances are compared squared, so the threshold is squared too.
  if v_best > (p_max_distance * p_max_distance) then
    return; -- the closest enrolled face is still not close enough
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

grant execute on function public.match_face(uuid, double precision[], double precision) to authenticated;

-- PostgREST caches the schema; a replaced function needs it reloaded before the
-- new signature is callable over HTTP.
notify pgrst, 'reload schema';
