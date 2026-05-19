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

  // Returns { ok, reason? }. Never throws.
  const ensureDraft = useCallback(
    async ({ departmentId, vesselId, tenantId }) => {
      if (!rotaId || !departmentId) return { ok: false, reason: 'no-context' };
      try {
        const { data: existing, error: selErr } = await supabase
          .from('rota_department_status')
          .select('id, status')
          .eq('rota_id', rotaId)
          .eq('department_id', departmentId)
          .maybeSingle();
        if (selErr) throw selErr;

        if (existing) {
          if (REVERTS_TO_DRAFT.has(existing.status)) {
            const { error: updErr } = await supabase
              .from('rota_department_status')
              .update({ status: 'draft', updated_at: new Date().toISOString() })
              .eq('id', existing.id);
            if (updErr) throw updErr;
            await refetch();
          }
          return { ok: true };
        }

        // No row — INSERT as draft. RLS: succeeds for COMMAND/CHIEF; HOD has
        // no INSERT policy, so this errors and we report 'no-init'.
        const { error: insErr } = await supabase
          .from('rota_department_status')
          .insert({
            rota_id: rotaId,
            department_id: departmentId,
            tenant_id: tenantId,
            vessel_id: vesselId,
            status: 'draft',
          });
        if (insErr) {
          return { ok: false, reason: 'no-init', detail: insErr.message };
        }
        await refetch();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
      }
    },
    [rotaId, refetch],
  );

  return { statusByDept, loading, error, refetch, ensureDraft };
}
