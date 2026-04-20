import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

export function useAllergies() {
  const { user } = useAuth();
  const [guests, setGuests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();

      if (!member) throw new Error('No active tenant membership');

      const { data, error: err } = await supabase
        .from('guests')
        .select('id, first_name, last_name, allergies, health_conditions')
        .eq('tenant_id', member.tenant_id)
        .eq('is_deleted', false)
        .eq('charter_status', 'active')
        .order('last_name');

      if (err) throw err;
      setGuests(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  // Split into those with restrictions and those without
  const withRestrictions = guests.filter(g => g.allergies || g.health_conditions);
  const withoutRestrictions = guests.filter(g => !g.allergies && !g.health_conditions);

  return { withRestrictions, withoutRestrictions, loading, error };
}
