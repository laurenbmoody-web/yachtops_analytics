// useCurrentRota — resolves the active rota for the current page context.
//
// Phase 1 scope: the /crew page operates on the VESSEL STANDING ROTA only
// (one per tenant, owner_type='vessel', auto-created by the
// ensure_vessel_standing_rota trigger — see migration
// 20260518000002_auto_create_standing_rotas_trigger.sql). Trip rotas are a
// later phase; this hook already returns owner_type/trip_id so callers can
// branch when trip context is introduced.
//
// Returns { rota, loading, error }. rota = { id, ownerType, tripId,
// vesselId, tenantId } or null.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

export function useCurrentRota() {
  const { user, activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  const [rota, setRota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!user || !tenantId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Standing rota: vessel_id == tenant_id by the trigger's id-reuse.
        const { data, error: rErr } = await supabase
          .from('rotas')
          .select('id, owner_type, trip_id, vessel_id, tenant_id')
          .eq('tenant_id', tenantId)
          .eq('owner_type', 'vessel')
          .limit(1)
          .maybeSingle();
        if (rErr) throw rErr;
        if (cancelled) return;
        setRota(
          data
            ? {
                id: data.id,
                ownerType: data.owner_type,
                tripId: data.trip_id,
                vesselId: data.vessel_id,
                tenantId: data.tenant_id,
              }
            : null,
        );
      } catch (e) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, tenantId]);

  return { rota, loading, error };
}
