// inboxScope — who may see a review_items row in their INBOX.
//
// review_items_tenant_read (RLS) is intentionally tenant-wide for audit
// reasons: every active member can SELECT every row. That makes RLS the
// wrong gate for the inbox — relying on it (as the inbox hooks originally
// did) means a submitting HOD sees their own pending submission, and every
// crew member sees everyone's. The inbox is an ACTION surface, so it must
// be scoped to the routed assignee, mirroring review_items_assignee_update:
//
//   CHIEF   → rows whose assignee_department_id is their own department
//   COMMAND → escalated rows (assignee_department_id IS NULL)
//   anyone else (HOD, crew) → no inbox
//
// Note: COMMAND seeing only NULL-dept rows matches what COMMAND can ACT on
// today (the approve/reject writers gate COMMAND to NULL-dept items). Making
// COMMAND a fallback reviewer for a dept that has no CHIEF needs a writer +
// RLS change (a migration) — tracked separately.

export function inboxScopeFor(tier, departmentId) {
  const t = String(tier || '').toUpperCase();
  if (t === 'CHIEF' && departmentId) return { kind: 'chief', departmentId };
  if (t === 'COMMAND') return { kind: 'command' };
  return { kind: 'none' };
}

// Narrow a PostgREST review_items query to the scope. Returns null when the
// user has no inbox — callers should short-circuit to an empty result rather
// than run an unscoped query.
export function applyInboxScope(query, scope) {
  if (scope.kind === 'chief') return query.eq('assignee_department_id', scope.departmentId);
  if (scope.kind === 'command') return query.is('assignee_department_id', null);
  return null;
}

// Client-side predicate for already-fetched rows.
export function matchesInboxScope(item, scope) {
  if (scope.kind === 'chief') return item?.assignee_department_id === scope.departmentId;
  if (scope.kind === 'command') return item?.assignee_department_id == null;
  return false;
}
