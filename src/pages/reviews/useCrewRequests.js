// useCrewRequests — the "Crew requests" review queue.
//
// A crew member raises a request that a COMMAND user of their vessel must
// action (currently: change where a vessel's alerts are sent — a
// notification_email_requests row). Unlike a rota or an order these carry no
// heavy payload, so the queue is a flat list of small, self-describing items.
//
// SCOPE: notification_email_requests RLS returns a row to (a) its requester and
// (b) any COMMAND member of the row's tenant. This is a REVIEWER surface, so we
// drop the caller's own requests (.neq user_id) — what's left is exactly the
// set the viewer can act on. A non-COMMAND crew member therefore sees nothing.
//
// The table may not exist yet on environments where the migration hasn't run —
// PGRST205 / 42P01 are swallowed so the queue quietly reads empty.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

export function useCrewRequests() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_email_requests')
        .select('id, user_id, requested_email, requested_at')
        .eq('status', 'pending')
        .neq('user_id', user.id)
        .order('requested_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) { setItems([]); setLoading(false); return; }
      const ids = [...new Set(rows.map((r) => r.user_id))];
      const { data: profs } = await supabase
        .from('profiles').select('id, full_name').in('id', ids);
      // email is column-restricted; Command reads it via the crew_emails RPC.
      const { data: emails } = await supabase.rpc('crew_emails', { p_ids: ids });
      const emailMap = new Map((emails || []).map((e) => [e.id, e.email]));
      const nameMap = new Map((profs || []).map((p) => [p.id, { ...p, email: emailMap.get(p.id) || null }]));
      setItems(rows.map((r) => ({
        ...r,
        kind: 'notification_email',
        requester: nameMap.get(r.user_id) || null,
      })));
    } catch (e) {
      const code = e?.code;
      if (code !== 'PGRST205' && code !== '42P01') {
        console.warn('[useCrewRequests] load failed', e);
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id, approve) => {
    const { error } = await supabase.rpc('decide_notification_email_request', {
      p_request_id: id, p_approve: approve,
    });
    if (error) throw error;
    setItems((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { items, loading, refetch: load, decide };
}
