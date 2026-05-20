// useRotaDepartmentStatus — read/write rota_department_status for a rota.
//
// Reads every status row for the given rotaId and exposes:
//   statusByDept : Map<department_id, { id, status, hasUnpublishedChanges }>
//   refetch()
//   ensureDraft({ departmentId, vesselId, tenantId }) — called on first edit
//     of a department. Per Phase-0.5 decision, row creation is an APP-LAYER
//     responsibility:
//       • row exists & status in (published|pending_approval) → UPDATE to
//         'draft' (the "editing after publish/submit silently reverts"
//         behaviour; allowed for HOD because the RLS WITH CHECK permits
//         'draft' as a target — see migration
//         20260518000004_create_rota_department_status.sql)
//       • row exists & status='draft' → no-op
//       • row missing → INSERT status='draft' (succeeds for COMMAND/CHIEF;
//         HOD has no INSERT policy → returns { ok:false, reason:'no-init' }
//         so the caller can surface the graceful error toast)
//
// ensureDraft resolves to { ok:boolean, reason?:string } and never throws —
// auto-save callers branch on .ok.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const REVERTS_TO_DRAFT = new Set(['published', 'pending_approval']);

export function useRotaDepartmentStatus(rotaId) {
  const [statusByDept, setStatusByDept] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!rotaId) {
      setStatusByDept(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('rota_department_status')
        .select('id, department_id, status, has_unpublished_changes')
        .eq('rota_id', rotaId);
      if (qErr) throw qErr;
      const m = new Map();
      for (const r of data ?? []) {
        m.set(r.department_id, {
          id: r.id,
          status: r.status,
          hasUnpublishedChanges: r.has_unpublished_changes,
        });
      }
      setStatusByDept(m);
      setError(null);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [rotaId]);

  useEffect(() => { refetch(); }, [refetch]);

  // Optimistic ensureDraft — set the badge to 'draft' in local state
  // SYNCHRONOUSLY, then fire the DB write in the background. On failure:
  // silent refetch (server truth wins) + return reason.
  //
  // Returns { ok, reason? }. Never throws.
  const ensureDraft = useCallback(
    async ({ departmentId, vesselId, tenantId }) => {
      if (!rotaId || !departmentId) return { ok: false, reason: 'no-context' };

      // Read current entry (closure value; fine for our purposes).
      let existing = null;
      setStatusByDept((prev) => {
        existing = prev.get(departmentId) || null;
        if (existing && existing.status === 'draft') return prev; // no-op
        const m = new Map(prev);
        m.set(departmentId, {
          id: existing?.id ?? `tmp-${Math.random().toString(36).slice(2, 10)}`,
          status: 'draft',
          hasUnpublishedChanges: existing?.hasUnpublishedChanges ?? true,
        });
        return m;
      });

      // No-op when already draft.
      if (existing && existing.status === 'draft') return { ok: true, noop: true };

      try {
        if (existing && REVERTS_TO_DRAFT.has(existing.status)) {
          const { error: updErr } = await supabase
            .from('rota_department_status')
            .update({ status: 'draft', updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          if (updErr) throw updErr;
          return { ok: true };
        }
        // No row → INSERT (RLS: COMMAND/CHIEF succeed; HOD has no INSERT policy).
        const { data, error: insErr } = await supabase
          .from('rota_department_status')
          .insert({
            rota_id: rotaId,
            department_id: departmentId,
            tenant_id: tenantId,
            vessel_id: vesselId,
            status: 'draft',
          })
          .select('id')
          .maybeSingle();
        if (insErr) {
          // Revert optimistic badge to server truth.
          refetch();
          return { ok: false, reason: 'no-init', detail: insErr.message };
        }
        // Reconcile temp id → real id (best-effort; refetch on Done is the
        // safety net if this slot is empty for any reason).
        if (data?.id) {
          setStatusByDept((prev) => {
            const cur = prev.get(departmentId);
            if (!cur || !String(cur.id).startsWith('tmp-')) return prev;
            const m = new Map(prev);
            m.set(departmentId, { ...cur, id: data.id });
            return m;
          });
        }
        return { ok: true };
      } catch (e) {
        refetch();
        return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
      }
    },
    [rotaId, refetch],
  );

  return { statusByDept, loading, error, refetch, ensureDraft };
}
