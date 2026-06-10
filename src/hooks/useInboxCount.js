// useInboxCount — live count of pending review_items routed to the
// current user. review_items_tenant_read (RLS) is tenant-wide, so the
// count must be scoped to the user's inbox at the app level (see
// inboxScope.js); without it the badge counted every member's items,
// including a submitter's own. CHIEF → their dept; COMMAND → escalated
// (NULL-dept); everyone else → 0.
//
// Polled at 30s. No realtime channel — matches the established cadence.
// SELECT uses count:'exact', head:true — single round-trip, no payload.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { inboxScopeFor, applyInboxScope } from './inboxScope';

const POLL_MS = 30_000;

export function useInboxCount() {
  const [count, setCount] = useState(0);
  const { currentTenantMember } = useTenant();
  const tier = currentTenantMember?.permission_tier;
  const departmentId = currentTenantMember?.department_id || null;

  useEffect(() => {
    const scope = inboxScopeFor(tier, departmentId);
    if (scope.kind === 'none') { setCount(0); return undefined; }
    let cancelled = false;
    const fetchCount = async () => {
      const base = supabase
        .from('review_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      const { count: n, error } = await applyInboxScope(base, scope);
      if (cancelled) return;
      if (error) {
        console.error('[useInboxCount] fetch failed:', error);
        return;
      }
      setCount(n || 0);
    };
    fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [tier, departmentId]);

  return count;
}
