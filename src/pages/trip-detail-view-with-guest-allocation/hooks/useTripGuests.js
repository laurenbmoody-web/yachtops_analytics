// useTripGuests — fetch full guest records for the guests allocated to a trip.
//
// trip.guests is an embedded array of { guestId, isActive, activatedAt } and
// gives only ids. Join against the `guests` table for full records (name,
// cabin, allergies, current_state, etc.) so the Aboard section can render
// the operational manifest.
//
// Returns full guest rows for active (isActive=true) trip guests. Inactive
// allocations are filtered out — they're guests removed from this trip but
// kept on the embedded array for history.

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

export function useTripGuests(trip) {
  const { user, activeTenantId } = useAuth();
  const [guests, setGuests]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;

    const activeIds = (trip?.guests || [])
      .filter(g => g?.isActive !== false)
      .map(g => g?.guestId)
      .filter(Boolean);

    if (!user || !activeTenantId || activeIds.length === 0) {
      setGuests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('guests')
          .select('*')
          .eq('tenant_id', activeTenantId)
          .in('id', activeIds);

        if (cancelled) return;
        if (err) { setError(err.message); setGuests([]); return; }
        setGuests(data ?? []);
      } catch (e) {
        if (!cancelled) { setError(e?.message ?? String(e)); setGuests([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, activeTenantId, trip?.id, trip?.guests]);

  return { guests, loading, error };
}
