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
import { fetchInboxPending } from '../../hooks/inboxScope';

export function usePendingReviewCount(rotaId) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const { currentTenantMember, activeTenantId } = useTenant();
  const tier = currentTenantMember?.permission_tier;
  const departmentId = currentTenantMember?.department_id || null;
  const tenantId = activeTenantId || currentTenantMember?.tenant_id || null;

  useEffect(() => {
    if (!rotaId) { setCount(0); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Inbox-scoped (RLS read is tenant-wide), rota source, then this rota.
      const rows = await fetchInboxPending(supabase, {
        tier,
        departmentId,
        tenantId,
        columns: 'id, source_context, assignee_department_id',
        narrow: (q) => q.eq('source_module', 'rota'),
      });
      if (cancelled) return;
      const n = rows.filter((r) => r?.source_context?.rota_id === rotaId).length;
      setCount(n);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [rotaId, tier, departmentId, tenantId]);

  return { count, loading };
}
