// inboxScope — who may see a review_items row in their INBOX.
//
// review_items_tenant_read (RLS) is intentionally tenant-wide for audit: every
// active member can SELECT every row. That makes RLS the wrong gate for the
// inbox — relying on it (as the inbox hooks originally did) means a submitting
// HOD sees their own pending submission and every member sees everyone's. The
// inbox is an ACTION surface, so it is scoped here at the app level:
//
//   CHIEF   → submissions routed to their own department
//   COMMAND → submissions whose department has NO active CHIEF (the fallback
//             reviewer lane) plus explicitly escalated (NULL-dept) rows. A
//             CHIEF-served department stays the CHIEF's to action.
//   anyone else (HOD, crew) → no inbox
//
// COMMAND's ability to ACT on those rows is granted by the
// 20260610120000_command_fallback_reviewer migration (RLS + approve/reject
// writers); this module decides what SURFACES in the inbox.

export function inboxScopeFor(tier, departmentId) {
  const t = String(tier || '').toUpperCase();
  if (t === 'CHIEF' && departmentId) return { kind: 'chief', departmentId };
  if (t === 'COMMAND') return { kind: 'command' };
  return { kind: 'none' };
}

// The set of department_ids that currently have an active CHIEF. A COMMAND
// inbox shows submissions whose department is NOT in this set.
export async function fetchChiefDepartmentIds(supabase, tenantId) {
  if (!tenantId) return new Set();
  const { data, error } = await supabase
    .from('tenant_members')
    .select('department_id')
    .eq('tenant_id', tenantId)
    .eq('permission_tier', 'CHIEF')
    .eq('active', true);
  if (error) {
    console.warn('[inboxScope] chief-dept fetch failed:', error);
    return new Set();
  }
  return new Set((data || []).map((r) => r.department_id).filter(Boolean));
}

// Does a row belong in a COMMAND inbox, given the chief-dept set? NULL-dept
// rows (explicit escalation) always show; otherwise only when the row's
// department has no CHIEF.
export function commandSeesItem(item, chiefDeptIds) {
  const dept = item?.assignee_department_id;
  if (dept == null) return true;
  return !chiefDeptIds.has(dept);
}

// Fetch the pending review_items visible in the current user's inbox.
//
// Pending volumes are tiny, so this fetches rows and filters in JS rather than
// leaning on head-count round-trips — that keeps the CHIEF and COMMAND paths
// uniform (COMMAND needs the chief-dept set, which a head count can't express).
//
//   supabase   the client
//   tier, departmentId, tenantId   the current member's scope inputs
//   columns    the SELECT list (defaults to the minimum for counting)
//   narrow     optional (query) => query, e.g. q => q.eq('source_module','rota')
//
// Returns an array of rows (possibly empty). Callers count or enrich them.
export async function fetchInboxPending(
  supabase,
  { tier, departmentId, tenantId, columns = 'id, assignee_department_id', narrow } = {},
) {
  const scope = inboxScopeFor(tier, departmentId);
  if (scope.kind === 'none') return [];

  let q = supabase.from('review_items').select(columns).eq('status', 'pending');
  if (typeof narrow === 'function') q = narrow(q);
  if (scope.kind === 'chief') q = q.eq('assignee_department_id', scope.departmentId);

  const { data, error } = await q;
  if (error) {
    console.warn('[inboxScope] pending fetch failed:', error);
    return [];
  }
  let rows = data || [];
  if (scope.kind === 'command') {
    const chiefDepts = await fetchChiefDepartmentIds(supabase, tenantId);
    rows = rows.filter((r) => commandSeesItem(r, chiefDepts));
  }
  return rows;
}
