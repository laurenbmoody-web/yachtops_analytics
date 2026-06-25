// useInboxCount — live count of pending review items routed to the
// current user. Aggregates across every Reviews surface so the nav
// badge reflects every queue the user owns, not just rotas:
//
//   1. Rota submissions — review_items via inboxScope (RLS is tenant-
//      wide so we scope at the app level: CHIEF → their dept;
//      COMMAND → escalated; everyone else → 0).
//
//   2. Provisioning approval requests — rows in
//      provisioning_approval_requests where approver_id = me and
//      status = 'pending'. RLS already scopes by approver_id so we
//      can ask Postgrest for a head:'exact' count directly.
//
//   3. Sea-time sign-offs — pending sea-service the master signs,
//      counted via the same queue builder the Reviews sidebar uses so
//      the nav badge matches the "Sea-time sign-off" count exactly.
//      Gated to COMMAND (the master is who attests), otherwise a crew
//      member would see their own submitted-but-unsigned days counted.
//
// Polled at 30s; subscribed for realtime on the provisioning queue so
// the badge ticks up the moment an approval request lands. Rotas
// retain the poll-only cadence to match the existing pattern.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { fetchInboxPending } from './inboxScope';
import { useSeaTimeSignoffs } from '../pages/reviews/useSeaTimeSignoffs';

const POLL_MS = 30_000;

export function useInboxCount() {
  const [rotaCount, setRotaCount] = useState(0);
  const [provisioningCount, setProvisioningCount] = useState(0);
  const { user } = useAuth();
  const { currentTenantMember, activeTenantId } = useTenant();
  const tier = currentTenantMember?.permission_tier;
  const departmentId = currentTenantMember?.department_id || null;
  const tenantId = activeTenantId || currentTenantMember?.tenant_id || null;

  // Sea-time sign-off queue — only COMMAND (the master) attests these, so gate
  // the query by tier. Reuses the Reviews queue builder so this count is the
  // same one the "Sea-time sign-off" sidebar badge shows.
  const signerName = currentTenantMember?.full_name || user?.user_metadata?.full_name || null;
  const seatime = useSeaTimeSignoffs(tier === 'COMMAND' ? tenantId : null, signerName);
  useEffect(() => {
    if (tier !== 'COMMAND' || !tenantId) return undefined;
    const id = setInterval(() => { seatime.refetch(); }, POLL_MS);
    return () => clearInterval(id);
  }, [tier, tenantId, seatime.refetch]);

  // Rota queue — existing poll loop.
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      const rows = await fetchInboxPending(supabase, { tier, departmentId, tenantId });
      if (cancelled) return;
      setRotaCount(rows.length);
    };
    fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [tier, departmentId, tenantId]);

  // Provisioning queue — poll + realtime subscription so the badge
  // ticks up the instant a new approval lands. PR1 migration covers
  // the underlying table; PGRST205 / 42P01 (schema not yet migrated)
  // are swallowed silently so the badge defaults to 0.
  useEffect(() => {
    if (!user?.id) { setProvisioningCount(0); return undefined; }
    let cancelled = false;
    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('provisioning_approval_requests')
        .select('id', { count: 'exact', head: true })
        .eq('approver_id', user.id)
        .eq('status', 'pending');
      if (cancelled) return;
      if (error) {
        const code = error.code;
        if (code !== 'PGRST205' && code !== '42P01') {
          console.warn('[useInboxCount] provisioning count failed:', error.message || error);
        }
        setProvisioningCount(0);
        return;
      }
      setProvisioningCount(count || 0);
    };
    fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    const ch = supabase
      .channel(`provisioning-approval-inbox-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provisioning_approval_requests', filter: `approver_id=eq.${user.id}` },
        () => { fetchCount(); },
      )
      .subscribe();
    return () => {
      cancelled = true;
      clearInterval(id);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  return rotaCount + provisioningCount + seatime.items.length;
}
