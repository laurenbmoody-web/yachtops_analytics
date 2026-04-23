import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { vesselLocalDate } from '../../../utils/vesselLocalTime';

export function useGuestDayNotes(guestId) {
  const { user } = useAuth();
  const [notes, setNotes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Vessel-local date — see src/utils/vesselLocalTime.js. Previously this
  // was `new Date().toISOString().split('T')[0]` which wrote UTC dates and
  // dropped late-night notes onto tomorrow's date.
  const today = vesselLocalDate();

  const fetch = useCallback(async () => {
    if (!user || !guestId) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('guest_day_notes')
        .select('*')
        .eq('guest_id', guestId)
        .eq('note_date', today)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setNotes(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, guestId, today]);

  useEffect(() => { fetch(); }, [fetch]);

  const addNote = useCallback(async (content) => {
    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .single();

    const { error: err } = await supabase
      .from('guest_day_notes')
      .insert({
        tenant_id: member.tenant_id,
        guest_id:  guestId,
        content,
        author_id: user.id,
        note_date: today,
      });

    if (err) throw err;
    fetch();
  }, [user, guestId, today, fetch]);

  return { notes, loading, error, addNote, refetch: fetch };
}
