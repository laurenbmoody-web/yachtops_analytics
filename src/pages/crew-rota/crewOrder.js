// Shared crew/department ordering for the rota — used by BOTH the day grid and
// the list view so they always present crew in the same order:
//   • the signed-in user's own department first (every tier sees their own
//     rota at the top), then the remaining departments in canonical order;
//   • within a department: render-state → role rank → name, with the
//     signed-in user pinned to the very top of their own department.
import { getRoleRank, UNKNOWN_RANK } from './crewDisplay';

// Department canonical fallback order (signed-in-user rules layered on top).
export const CANONICAL_DEPTS = ['Deck', 'Interior', 'Galley', 'Engineering', 'Bridge', 'Shore'];

// On-vessel render state from today's shift.
export function renderStateOf(crew) {
  if (crew.activeOnShift) return 'active';
  if (crew.medicalToday) return 'medical';
  return 'off'; // shift_type 'off' OR no shift row
}
const STATE_RANK = { active: 0, off: 1, medical: 2 };

export function sortWithinDept(a, b) {
  const sa = STATE_RANK[renderStateOf(a)];
  const sb = STATE_RANK[renderStateOf(b)];
  if (sa !== sb) return sa - sb;
  const ra = getRoleRank(a.role);
  const rb = getRoleRank(b.role);
  if (ra !== rb) return ra - rb;
  if (ra === UNKNOWN_RANK) {
    const byRole = String(a.role || '').localeCompare(String(b.role || ''));
    if (byRole !== 0) return byRole;
  }
  return String(a.name || '').localeCompare(String(b.name || ''));
}

// Department order for the signed-in user: their own department first — so
// EVERY tier (COMMAND included) sees their own rota at the top — then the
// remaining departments in canonical order. A user with no/absent own
// department falls back to plain canonical order.
export function orderDepartments(byDept, crew, ownDeptId) {
  const present = Array.from(byDept.keys());
  const canonIdx = (n) => {
    const i = CANONICAL_DEPTS.indexOf(n);
    return i === -1 ? 999 : i;
  };
  const canonicalSort = (a, b) => canonIdx(a) - canonIdx(b) || a.localeCompare(b);

  let ownDeptName = null;
  if (ownDeptId) {
    const m = crew.find(c => c.departmentId === ownDeptId);
    ownDeptName = m?.department || null;
  }

  if (!ownDeptName || !byDept.has(ownDeptName)) {
    return [...present].sort(canonicalSort);
  }
  const rest = present.filter(d => d !== ownDeptName).sort(canonicalSort);
  return [ownDeptName, ...rest];
}

// Group crew by department and apply the full ordering (within-dept sort, own
// user pinned to top, own department first). Returns [[deptName, members], …].
export function groupAndOrderCrew(crew, { userId = null, ownDeptId = null } = {}) {
  const byDept = new Map();
  for (const c of crew) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c);
  }
  for (const arr of byDept.values()) {
    arr.sort(sortWithinDept);
    if (userId) {
      const idx = arr.findIndex(c => c.userId === userId);
      if (idx > 0) {
        const [mine] = arr.splice(idx, 1);
        arr.unshift(mine);
      }
    }
  }
  return orderDepartments(byDept, crew, ownDeptId).map(d => [d, byDept.get(d)]);
}
