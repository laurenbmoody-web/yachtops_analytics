// useRotaLifecycleWriters — thin wrappers over the four Phase-2 RPC
// writers. Pure data layer: each function calls one Supabase RPC and
// returns a uniform { ok: boolean, data?, error? } shape. No UI, no
// toasts, no notifications — the calling code (Phase 3 footer wiring,
// Phase 4 inbox UI) owns user-facing feedback.
//
// The "use" prefix is for naming consistency with the rest of the rota
// hooks track; this is not a React hook (no state, no useEffect).
//
// Error mapping: Supabase RPC errors surface .message (typically the
// raise-exception text from the function body). We pass it through
// untouched — the writers already use human-readable error messages,
// so callers can show them as-is.

import { supabase } from '../../lib/supabaseClient';

async function callRpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[rota lifecycle] ${fn} failed:`, error);
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true, data };
}

// HOD → "submit my dept for approval".
// Writes rota_department_status (draft → pending_approval), a
// 'submitted' rota_approval_events row, and a pending review_item
// routed to CHIEFs in the same dept. All-or-nothing.
export async function submitRotaDepartment({ rotaId, departmentId }) {
  return callRpc('submit_rota_department', {
    p_rota_id: rotaId,
    p_department_id: departmentId,
  });
}

// CHIEF (dept-match) or COMMAND (NULL-dept fallback) → accept a
// pending review_item. Snapshot + flip dept and its shifts to
// published + 'approved' audit + close the inbox row.
export async function approveRotaDepartment({ reviewItemId, note }) {
  return callRpc('approve_rota_department', {
    p_review_item_id: reviewItemId,
    p_note: note ?? null,
  });
}

// CHIEF (dept-match) or COMMAND (NULL-dept fallback) → reject a
// pending review_item. note is REQUIRED — surface a client-side guard
// so we return ok:false immediately rather than round-tripping to a
// raise-exception. The RPC also enforces server-side.
export async function rejectRotaDepartment({ reviewItemId, note }) {
  if (!note || !String(note).trim()) {
    return { ok: false, error: 'A rejection reason is required.' };
  }
  return callRpc('reject_rota_department', {
    p_review_item_id: reviewItemId,
    p_note: note,
  });
}

// CHIEF (own-dept) or COMMAND (any dept) → fix-it-and-ship for a
// dept in draft. RPC rejects pending_approval state with a directive
// message; callers should not call this on submitted depts.
export async function publishRotaDepartmentDirect({ rotaId, departmentId, note }) {
  return callRpc('publish_rota_department_direct', {
    p_rota_id: rotaId,
    p_department_id: departmentId,
    p_note: note ?? null,
  });
}
