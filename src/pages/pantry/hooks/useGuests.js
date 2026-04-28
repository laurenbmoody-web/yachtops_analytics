import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { buildHistoryEntry, appendToLog } from '../../../utils/guestHistoryLog';

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
    const nextLog = appendToLog(prevGuest.history_log, entry);

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

  // Mood writes stopped populating current_mood_emoji per Phase 2 housekeeping —
  // the avatar derives the emoji from MOOD_BY_KEY[current_mood] so the column
  // was a dead write. Kept in the schema for backwards compatibility with older
  // clients; a future migration can drop it. Null moodKey clears the mood
  // (re-tap unset from the drawer).
  const updateGuestMood = useCallback(async (guestId, moodKey) => {
    const prevGuest = guests.find(g => g.id === guestId);
    if (!prevGuest) return;

    const prevMood = prevGuest.current_mood ?? null;
    const nextMood = moodKey ?? null;
    if (prevMood === nextMood) return;

    const changes = { current_mood: { from: prevMood, to: nextMood } };
    const entry   = buildHistoryEntry('mood_changed', user?.id ?? null, changes);
    const nextLog = appendToLog(prevGuest.history_log, entry);

    setGuests(prev => prev.map(g =>
      g.id === guestId
        ? { ...g, current_mood: nextMood, history_log: nextLog }
        : g
    ));

    const { error: err } = await supabase
      .from('guests')
      .update({ current_mood: nextMood, history_log: nextLog })
      .eq('id', guestId);
    if (err) {
      setError(err.message);
      fetch();
    }
  }, [guests, user, fetch]);

  // Dedicated mutation for the drawer's ashore context form. Writing the
  // context is a separate user intent from flipping state to ashore — the
  // pill tap sets current_state='ashore' immediately, then Save on the
  // inline form fills destination + returning_at. Logs a distinct action
  // ('ashore_context_set') in history_log so the audit trail distinguishes
  // "went ashore" from "pinned context".
  //
  // Pass `null` to clear. Caller is responsible for passing null when the
  // guest's state flips away from ashore (keeps jsonb clean).
  const updateAshoreContext = useCallback(async (guestId, ashoreContext) => {
    const prevGuest = guests.find(g => g.id === guestId);
    if (!prevGuest) return;

    const prevCtx = prevGuest.ashore_context ?? null;
    const nextCtx = ashoreContext ?? null;
    if (JSON.stringify(prevCtx) === JSON.stringify(nextCtx)) return;

    const changes = { ashore_context: { from: prevCtx, to: nextCtx } };
    const entry   = buildHistoryEntry('ashore_context_set', user?.id ?? null, changes);
    const nextLog = appendToLog(prevGuest.history_log, entry);

    setGuests(prev => prev.map(g =>
      g.id === guestId
        ? { ...g, ashore_context: nextCtx, history_log: nextLog }
        : g
    ));

    const { error: err } = await supabase
      .from('guests')
      .update({ ashore_context: nextCtx, history_log: nextLog })
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
    updateAshoreContext,
  };
}
