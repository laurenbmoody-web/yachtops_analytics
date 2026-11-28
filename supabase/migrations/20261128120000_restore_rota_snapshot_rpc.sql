-- Rota "discard changes": restore a member scope to its snapshot atomically.
--
-- The client used to DELETE every shift for the scoped members and then
-- re-INSERT the snapshot rows as two separate calls, without checking either
-- error. If the insert failed (connection drop, RLS, a bad row), those
-- members' shifts for the whole rota were simply gone. Doing both in one
-- function makes it all-or-nothing.
--
-- SECURITY INVOKER: rota_shifts RLS still decides what the caller may delete
-- and insert, exactly as with the two direct calls it replaces. Original ids
-- are preserved so anything referencing a shift survives the restore.
create or replace function public.restore_rota_snapshot(
  p_rota_id uuid,
  p_member_ids uuid[],
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_rota_id is null or p_member_ids is null or cardinality(p_member_ids) = 0 then
    return 0;
  end if;

  delete from public.rota_shifts
   where rota_id = p_rota_id
     and member_id = any(p_member_ids);

  if p_rows is not null and jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0 then
    insert into public.rota_shifts (
      id, tenant_id, rota_id, member_id, shift_date, start_time, end_time,
      shift_type, sub_type, notes, status, trip_id, created_by
    )
    select r.id, r.tenant_id, r.rota_id, r.member_id, r.shift_date, r.start_time, r.end_time,
           coalesce(r.shift_type, 'duty'), r.sub_type, r.notes, coalesce(r.status, 'draft'),
           r.trip_id, r.created_by
      from jsonb_to_recordset(p_rows) as r(
        id uuid, tenant_id uuid, rota_id uuid, member_id uuid, shift_date date,
        start_time time, end_time time, shift_type text, sub_type text, notes text,
        status text, trip_id uuid, created_by uuid
      )
     where r.rota_id = p_rota_id
       and r.member_id = any(p_member_ids);
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

revoke all on function public.restore_rota_snapshot(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.restore_rota_snapshot(uuid, uuid[], jsonb) to authenticated;
