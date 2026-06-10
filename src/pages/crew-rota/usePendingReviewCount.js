// usePendingReviewCount — small read-only hook that counts the
// review_items currently routed for THIS rota's lifecycle decisions.
//
// Used by the rota page footer (Phase 2) to render a live notice for
// CHIEF/COMMAND viewers when their inbox has work on this rota.
//
// Query shape:
//   review_items WHERE source_module = 'rota'
//                  AND status = 'pending'
//                  AND source_context.rota_id = <current rotaId>
//
// The source_context filter is applied client-side after pulling the
// (small) set of pending rota items in the tenant — PostgREST's jsonb
// operators add cognitive overhead for not much gain at this volume.
// Pending counts per rota are typically 0-5; the round-trip is cheap.
//
// RLS already scopes the SELECT to tenant_members.tenant_id, so
// cross-tenant leakage isn't a concern.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { inboxScopeFor, matchesInboxScope } from '../../hooks/inboxScope';

export function usePendingReviewCount(rotaId) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const { currentTenantMember } = useTenant();
  const tier = currentTenantMember?.permission_tier;
  const departmentId = currentTenantMember?.department_id || null;

  useEffect(() => {
    const scope = inboxScopeFor(tier, departmentId);
    if (!rotaId || scope.kind === 'none') { setCount(0); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('review_items')
        .select('id, source_context, assignee_department_id')
        .eq('source_module', 'rota')
        .eq('status', 'pending');
      if (cancelled) return;
      if (error) {
        console.error('[usePendingReviewCount] fetch failed:', error);
        setCount(0);
      } else {
        // Scope to the routed assignee (RLS read is tenant-wide) AND this rota.
        const n = (data || []).filter(
          (r) => r?.source_context?.rota_id === rotaId && matchesInboxScope(r, scope),
        ).length;
        setCount(n);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [rotaId, tier, departmentId]);

  return { count, loading };
}
