import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

// History entries live inside guests.history_log (jsonb). Keep the shape aligned
// with the existing guestStorage.js convention: `actorUserId` (camelCase) so
// downstream readers (GuestDetailPanel, pantry GuestHistoryPage) see one format.
function buildHistoryEntry(action, actorUserId, changes) {
  return {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    at: new Date().toISOString(),
    action,
    actorUserId,
    changes,
  };
}

function appendHistory(existing, entry) {
  const log = Array.isArray(existing) ? existing : [];
  return [...log, entry];
}

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
        .eq('is_active_on_trip', true)
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
    const prevGuest = guests.find(g => g.id === guestId);
    if (!prevGuest) return;

    const prevState  = prevGuest.current_state ?? 'awake';
    const prevAshore = prevGuest.ashore_context ?? null;
    const stateChanged  = prevState !== nextState;
    const ashoreChanged = JSON.stringify(prevAshore) !== JSON.stringify(ashoreContext);
    if (!stateChanged && !ashoreChanged) return;

    const changes = {};
    if (stateChanged)  changes.current_state  = { from: prevState,  to: nextState };
    if (ashoreChanged) changes.ashore_context = { from: prevAshore, to: ashoreContext };

    // Primary action picks the most meaningful transition; nested changes carry the rest.
    const action = stateChanged
      ? 'state_changed'
      : (ashoreContext ? 'ashore_set' : 'ashore_cleared');

    const entry = buildHistoryEntry(action, user?.id ?? null, changes);
    const nextLog = appendHistory(prevGuest.history_log, entry);

    setGuests(prev => prev.map(g =>
      g.id === guestId
        ? { ...g, current_state: nextState, ashore_context: ashoreContext, history_log: nextLog }
        : g
    ));

    const { error: err } = await supabase
      .from('guests')
      .update({ current_state: nextState, ashore_context: ashoreContext, history_log: nextLog })
      .eq('id', guestId);
    if (err) {
      setError(err.message);
      fetch();
    }
  }, [guests, user, fetch]);

  const updateGuestMood = useCallback(async (guestId, moodKey, moodEmoji) => {
    const prevGuest = guests.find(g => g.id === guestId);
    if (!prevGuest) return;

    const prevMood = prevGuest.current_mood ?? null;
    if (prevMood === moodKey) return;

    const changes = { current_mood: { from: prevMood, to: moodKey } };
    const entry   = buildHistoryEntry('mood_changed', user?.id ?? null, changes);
    const nextLog = appendHistory(prevGuest.history_log, entry);

    setGuests(prev => prev.map(g =>
      g.id === guestId
        ? { ...g, current_mood: moodKey, current_mood_emoji: moodEmoji, history_log: nextLog }
        : g
    ));

    const { error: err } = await supabase
      .from('guests')
      .update({ current_mood: moodKey, current_mood_emoji: moodEmoji, history_log: nextLog })
      .eq('id', guestId);
    if (err) {
      setError(err.message);
      fetch();
    }
  }, [guests, user, fetch]);

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
