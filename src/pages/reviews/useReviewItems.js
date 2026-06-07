// useReviewItems — list of pending review_items for the current user.
// RLS already scopes visibility (Phase 1 review_items_assignee_update
// policy lets only CHIEF+dept-match and COMMAND+NULL-dept through), so
// we just SELECT * WHERE status='pending' and Postgres returns the
// right rows.
//
// For each item we also count rota_approval_events of event_type=
// 'mlc_override' for the (rota_id, department_id) tuple so the card
// can surface the MLC flag. One query per item is acceptable at v1
// volumes (pending lists stay small — single-digit common, low double
// digits at the extreme). Batch lookups can land in Phase 6 polish.
//
// day_count: from the source_event_type='submitted' snapshot's shift_data
// (a jsonb array of rota_shifts rows). Counts distinct shift_date.
//
// submitter_role: looked up against tenant_members. roles join is
// optional — falls back to null when the role isn't resolvable so the
// card can render without "· Role".

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

async function loadOne(item) {
  const ctx = item.source_context || {};
  const rotaId = ctx.rota_id;
  const departmentId = ctx.department_id;

  // Submit-time snapshot for day_count + (Phase 4b) diff baseline.
  let dayCount = 0;
  let shiftCount = ctx.shift_count ?? 0;
  if (rotaId && departmentId) {
    const { data: snap, error: snapErr } = await supabase
      .from('rota_shift_snapshots')
      .select('shift_data, shift_count')
      .eq('rota_id', rotaId)
      .eq('department_id', departmentId)
      .eq('source_event_type', 'submitted')
      .order('snapshot_taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapErr) {
      console.warn('[useReviewItems] snapshot fetch failed:', snapErr);
    } else if (snap) {
      shiftCount = snap.shift_count ?? shiftCount;
      const dates = new Set();
      for (const s of (snap.shift_data || [])) {
        if (s?.shift_date) dates.add(s.shift_date);
      }
      dayCount = dates.size;
    }
  }

  // MLC override count for the (rota, dept) since this submission was
  // raised. Conservative bound: count all mlc_override events for the
  // pair; the rota lifecycle resets between published cycles so this
  // is a useful "edits-in-this-cycle had MLC flags" indicator. Phase 6
  // can refine to "since submitted_at".
  let mlcOverrideCount = 0;
  if (rotaId && departmentId) {
    const { count, error: evErr } = await supabase
      .from('rota_approval_events')
      .select('id', { count: 'exact', head: true })
      .eq('rota_id', rotaId)
      .eq('department_id', departmentId)
      .eq('event_type', 'mlc_override');
    if (evErr) {
      console.warn('[useReviewItems] events count failed:', evErr);
    } else {
      mlcOverrideCount = count || 0;
    }
  }

  // Submitter role: tenant_members.role for the submitter user, scoped
  // to the same tenant the item belongs to. Best-effort.
  let submitterRole = null;
  if (item.submitter_id && item.tenant_id) {
    const { data: tm, error: tmErr } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', item.submitter_id)
      .eq('tenant_id', item.tenant_id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (tmErr) {
      console.warn('[useReviewItems] submitter role fetch failed:', tmErr);
    } else if (tm?.role) {
      submitterRole = tm.role;
    }
  }

  return {
    id: item.id,
    created_at: item.created_at,
    status: item.status,
    rota_id: rotaId || null,
    department_id: departmentId || null,
    rota_name: ctx.rota_name || null,
    department_name: ctx.department_name || null,
    submitter_name: ctx.submitter_name || null,
    submitter_role: submitterRole,
    submitter_id: item.submitter_id,
    shift_count: shiftCount,
    day_count: dayCount,
    mlc_override_count: mlcOverrideCount,
    assignee_tier: item.assignee_tier,
    assignee_department_id: item.assignee_department_id,
  };
}

export function useReviewItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from('review_items')
      .select('id, tenant_id, submitter_id, source_context, assignee_tier, assignee_department_id, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (qErr) {
      console.error('[useReviewItems] fetch failed:', qErr);
      setError(qErr.message || String(qErr));
      setItems([]);
      setLoading(false);
      return;
    }
    const enriched = await Promise.all((data || []).map(loadOne));
    setItems(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { items, loading, error, refetch };
}
