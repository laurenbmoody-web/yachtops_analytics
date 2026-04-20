import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

export function useStewNotes({ limit = 3 } = {}) {
  const { user } = useAuth();
  const [notes, setNotes]     = useState([]);
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
        .from('stew_notes')
        .select('*')
        .eq('tenant_id', member.tenant_id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (err) throw err;
      setNotes(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  const addNote = useCallback(async (content, opts = {}) => {
    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .single();

    const { error: err } = await supabase
      .from('stew_notes')
      .insert({
        tenant_id:        member.tenant_id,
        content,
        author_id:        user.id,
        source:           opts.source ?? 'typed',
        related_guest_id: opts.relatedGuestId ?? null,
      });

    if (err) throw err;
    fetch();
  }, [user, fetch]);

  return { notes, loading, error, refetch: fetch, addNote };
}
