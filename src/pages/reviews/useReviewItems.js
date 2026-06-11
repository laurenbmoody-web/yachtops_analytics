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
// day_count / shift_count / date_start / date_end describe the SUBMISSION —
// i.e. the unpublished (draft) shifts for the (rota, dept), which are the
// changes the chief is approving. Already-published shifts are excluded so
// the review opens on the first changed day and the counts reflect only the
// changes (computed from live rota_shifts). Defensive fallback to all shifts
// only if a submission carries no draft rows.
//
// submitter_role: looked up against tenant_members. roles join is
// optional — falls back to null when the role isn't resolvable so the
// card can render without "· Role".

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { fetchInboxPending } from '../../hooks/inboxScope';

async function loadOne(item) {
  const ctx = item.source_context || {};
  const rotaId = ctx.rota_id;
  const departmentId = ctx.department_id;

  // What the chief is approving = the UNPUBLISHED (draft) shifts: the actual
  // changes. Already-published shifts are the live rota and don't need
  // re-reviewing, so they're excluded from the day/shift counts AND from the
  // date range that decides where the review opens — otherwise an old
  // published day pulls the opening date back and the new changes get buried
  // (you'd have to scroll to find them). Computed from live rota_shifts so it
  // reflects any reviewer edits. Defensive fallback to all shifts only if a
  // submission somehow carries no draft rows, so the card never reads "0 days".
  let dayCount = 0;
  let shiftCount = 0;
  let dateStart = null;   // earliest CHANGED day — the review opens here.
  let dateEnd = null;
  if (rotaId && departmentId && item.tenant_id) {
    const { data: members, error: mErr } = await supabase
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', item.tenant_id)
      .eq('department_id', departmentId)
      .eq('active', true);
    if (mErr) {
      console.warn('[useReviewItems] dept members fetch failed:', mErr);
    } else {
      const memberIds = (members || []).map((m) => m.id);
      if (memberIds.length > 0) {
        const { data: shifts, error: sErr } = await supabase
          .from('rota_shifts')
          .select('shift_date, status')
          .eq('rota_id', rotaId)
          .in('member_id', memberIds);
        if (sErr) {
          console.warn('[useReviewItems] shifts fetch failed:', sErr);
        } else {
          const rows = shifts || [];
          const draft = rows.filter((s) => s?.status === 'draft' && s?.shift_date);
          const scoped = draft.length > 0 ? draft : rows.filter((s) => s?.shift_date);
          const dates = new Set();
          for (const s of scoped) dates.add(s.shift_date);
          shiftCount = scoped.length;
          dayCount = dates.size;
          const sorted = [...dates].sort();
          dateStart = sorted[0] ?? null;
          dateEnd = sorted[sorted.length - 1] ?? null;
        }
      }
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
    date_start: dateStart,
    date_end: dateEnd,
    mlc_override_count: mlcOverrideCount,
    assignee_tier: item.assignee_tier,
    assignee_department_id: item.assignee_department_id,
  };
}

export function useReviewItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { currentTenantMember, activeTenantId } = useTenant();
  const tier = currentTenantMember?.permission_tier;
  const departmentId = currentTenantMember?.department_id || null;
  const tenantId = activeTenantId || currentTenantMember?.tenant_id || null;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Scope to the routed assignee — RLS read is tenant-wide, so without
    // this a submitting HOD would see their own pending item. CHIEF → their
    // dept; COMMAND → CHIEF-less submissions (fallback). (inboxScope.js)
    const data = await fetchInboxPending(supabase, {
      tier,
      departmentId,
      tenantId,
      columns: 'id, tenant_id, submitter_id, source_context, assignee_tier, assignee_department_id, status, created_at',
      narrow: (q) => q.order('created_at', { ascending: false }),
    });
    const enriched = await Promise.all((data || []).map(loadOne));
    setItems(enriched);
    setLoading(false);
  }, [tier, departmentId, tenantId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { items, loading, error, refetch };
}
