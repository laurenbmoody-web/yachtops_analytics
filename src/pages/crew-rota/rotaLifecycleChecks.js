// Department staffing checks for the rota lifecycle pre-flight gates.
//
// hasChiefForDepartment(tenantId, departmentId)
//   Resolves true when an active tenant_member exists with
//   permission_tier='CHIEF' AND department_id=p_dept AND tenant_id=p_tenant.
//   Used by the submit flow to block submissions that would land an
//   un-actionable review_item (Phase 1's routing restricts CHIEF
//   updates to dept-match; if no CHIEF exists in the dept, nobody can
//   accept the submission).
//
// getDraftShiftCount(rotaId, tenantId, departmentId)
//   Returns the count of rota_shifts with status='draft' for the
//   (rota, dept) pair via member_id → tenant_members.department_id.
//   Used to block submit/publish on an empty rota — take_rota_shift_snapshot
//   raises on zero shifts (RPC failure path), so this is the polite
//   pre-check that surfaces the right copy instead of the raw error.
//
// Both functions are pure client-side queries against RLS-scoped reads.
// They return numbers / booleans on success and { ok:false, error } on
// failure for caller convenience. console.error on failure for
// debuggability; the writer error path is the safety net regardless.

import { supabase } from '../../lib/supabaseClient';

export async function hasChiefForDepartment(tenantId, departmentId) {
  if (!tenantId || !departmentId) return { ok: false, error: 'missing-context' };
  const { count, error } = await supabase
    .from('tenant_members')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('department_id', departmentId)
    .eq('permission_tier', 'CHIEF')
    .eq('active', true);
  if (error) {
    console.error('[hasChiefForDepartment] fetch failed:', error);
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true, has: (count || 0) > 0, count: count || 0 };
}

export async function getDraftShiftCount(rotaId, tenantId, departmentId) {
  if (!rotaId || !tenantId || !departmentId) return { ok: false, error: 'missing-context' };
  // Resolve the dept's tenant_member ids first; we filter rota_shifts by
  // member_id IN (...). Two round-trips, but the dept-member set is tiny
  // (typically < 10 rows) so cost is negligible.
  const { data: members, error: mErr } = await supabase
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('department_id', departmentId)
    .eq('active', true);
  if (mErr) {
    console.error('[getDraftShiftCount] tenant_members fetch failed:', mErr);
    return { ok: false, error: mErr.message || String(mErr) };
  }
  const memberIds = (members || []).map((m) => m.id);
  if (memberIds.length === 0) return { ok: true, count: 0 };
  const { count, error: sErr } = await supabase
    .from('rota_shifts')
    .select('id', { count: 'exact', head: true })
    .eq('rota_id', rotaId)
    .eq('status', 'draft')
    .in('member_id', memberIds);
  if (sErr) {
    console.error('[getDraftShiftCount] rota_shifts count failed:', sErr);
    return { ok: false, error: sErr.message || String(sErr) };
  }
  return { ok: true, count: count || 0 };
}

// getDraftDepartmentIds(rotaId, tenantId)
//   Distinct department ids that have at least one DRAFT shift in the rota.
//   Lets COMMAND publish every department they edited in one action (their
//   edits span departments — the per-dept footer target isn't enough).
export async function getDraftDepartmentIds(rotaId, tenantId) {
  if (!rotaId || !tenantId) return { ok: false, error: 'missing-context' };
  // Two steps, not an embed: rota_shifts has two FKs to tenant_members
  // (member_id + created_by), so a PostgREST embed is ambiguous. Collect the
  // draft shifts' member ids, then resolve their departments.
  const { data: shifts, error: sErr } = await supabase
    .from('rota_shifts')
    .select('member_id')
    .eq('rota_id', rotaId)
    .eq('status', 'draft');
  if (sErr) {
    console.error('[getDraftDepartmentIds] shift fetch failed:', sErr);
    return { ok: false, error: sErr.message || String(sErr) };
  }
  const memberIds = [...new Set((shifts || []).map((s) => s.member_id).filter(Boolean))];
  if (memberIds.length === 0) return { ok: true, departmentIds: [] };
  const { data: members, error: mErr } = await supabase
    .from('tenant_members')
    .select('department_id')
    .eq('tenant_id', tenantId)
    .in('id', memberIds);
  if (mErr) {
    console.error('[getDraftDepartmentIds] member fetch failed:', mErr);
    return { ok: false, error: mErr.message || String(mErr) };
  }
  const ids = [...new Set((members || []).map((m) => m.department_id).filter(Boolean))];
  return { ok: true, departmentIds: ids };
}

// getDraftDayCount(rotaId, tenantId, departmentId)
//   Returns the DISTINCT draft shift_date values for the (rota, dept) pair
//   across the WHOLE rota (not a loaded window). Used by the submit footer
//   label so "Submit for approval (N days)" reflects every draft day, not just
//   the ±6-day view. Returns { ok, days: string[] } (deduped date strings).
export async function getDraftDayCount(rotaId, tenantId, departmentId) {
  if (!rotaId || !tenantId || !departmentId) return { ok: false, error: 'missing-context' };
  const { data: members, error: mErr } = await supabase
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('department_id', departmentId)
    .eq('active', true);
  if (mErr) {
    console.error('[getDraftDayCount] tenant_members fetch failed:', mErr);
    return { ok: false, error: mErr.message || String(mErr) };
  }
  const memberIds = (members || []).map((m) => m.id);
  if (memberIds.length === 0) return { ok: true, days: [] };
  const { data, error: sErr } = await supabase
    .from('rota_shifts')
    .select('shift_date')
    .eq('rota_id', rotaId)
    .eq('status', 'draft')
    .in('member_id', memberIds);
  if (sErr) {
    console.error('[getDraftDayCount] rota_shifts fetch failed:', sErr);
    return { ok: false, error: sErr.message || String(sErr) };
  }
  const days = [...new Set((data || []).map((r) => r.shift_date).filter(Boolean))];
  return { ok: true, days };
}

