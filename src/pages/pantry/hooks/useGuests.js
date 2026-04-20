import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

export function useGuests() {
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

      if (!member) throw new Error('No active tenant membership found');

      const { data, error: err } = await supabase
        .from('guests')
        .select('*')
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

  const updateGuestState = useCallback(async (guestId, nextState, ashoreContext = null) => {
    setGuests(prev => prev.map(g =>
      g.id === guestId
        ? { ...g, current_state: nextState, ashore_context: ashoreContext }
        : g
    ));
    const { error: err } = await supabase
      .from('guests')
      .update({ current_state: nextState, ashore_context: ashoreContext })
      .eq('id', guestId);
    if (err) {
      setError(err.message);
      fetch();
    }
  }, [fetch]);

  const updateGuestMood = useCallback(async (guestId, moodKey, moodEmoji) => {
    setGuests(prev => prev.map(g =>
      g.id === guestId
        ? { ...g, current_mood: moodKey, current_mood_emoji: moodEmoji }
        : g
    ));
    const { error: err } = await supabase
      .from('guests')
      .update({ current_mood: moodKey, current_mood_emoji: moodEmoji })
      .eq('id', guestId);
    if (err) {
      setError(err.message);
      fetch();
    }
  }, [fetch]);

  // Group by cabin_location_id
  const cabins = guests.reduce((acc, g) => {
    const key = g.cabin_location_id ?? '__unassigned__';
    if (!acc[key]) {
      acc[key] = {
        id: key,
        label: g.cabin_location_label ?? g.cabin_location_path ?? 'Unassigned',
        path: g.cabin_location_path ?? '',
        guests: [],
      };
    }
    acc[key].guests.push(g);
    return acc;
  }, {});

  return {
    guests,
    cabins: Object.values(cabins),
    loading,
    error,
    refetch: fetch,
    updateGuestState,
    updateGuestMood,
  };
}
