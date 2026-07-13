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
// `items` is the PENDING queue (what drives the sidebar/bell badges). Resolved
// rows persist in the same table with status/decided_by/decided_at, so history
// is a second, opt-in query — call loadResolved() to populate `resolved`.
//
// The table may not exist yet on environments where the migration hasn't run —
// PGRST205 / 42P01 are swallowed so the queue quietly reads empty.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const SWALLOW = (e, where) => {
  const code = e?.code;
  if (code !== 'PGRST205' && code !== '42P01') console.warn(`[useCrewRequests] ${where}`, e);
};

export function useCrewRequests() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolved, setResolved] = useState([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);

  // Resolve requester particulars (name + avatar, email via the restricted
  // crew_emails RPC) and any decider names for a set of rows. Returns an
  // id → profile map; requester ids carry an email, deciders just a name.
  const enrich = useCallback(async (requesterIds, deciderIds = []) => {
    const reqIds = [...new Set(requesterIds.filter(Boolean))];
    const allIds = [...new Set([...reqIds, ...deciderIds.filter(Boolean)])];
    if (allIds.length === 0) return new Map();
    const [{ data: profs }, { data: emails }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url').in('id', allIds),
      reqIds.length ? supabase.rpc('crew_emails', { p_ids: reqIds }) : Promise.resolve({ data: [] }),
    ]);
    const emailMap = new Map((emails || []).map((e) => [e.id, e.email]));
    return new Map((profs || []).map((p) => [p.id, { ...p, email: emailMap.get(p.id) || null }]));
  }, []);

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
      const map = await enrich(rows.map((r) => r.user_id));
      setItems(rows.map((r) => ({
        ...r,
        kind: 'notification_email',
        requester: map.get(r.user_id) || null,
      })));
    } catch (e) {
      SWALLOW(e, 'load failed');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, enrich]);

  // Resolved history — approved/declined rows, most-recently-decided first.
  // Opt-in (the hub calls it) so the badge-only consumers don't pay for it.
  const loadResolved = useCallback(async () => {
    if (!user?.id) { setResolved([]); return; }
    setResolvedLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_email_requests')
        .select('id, user_id, requested_email, requested_at, status, decided_by, decided_at')
        .in('status', ['approved', 'declined'])
        .neq('user_id', user.id)
        .order('decided_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) { setResolved([]); setResolvedLoading(false); return; }
      const map = await enrich(rows.map((r) => r.user_id), rows.map((r) => r.decided_by));
      setResolved(rows.map((r) => ({
        ...r,
        kind: 'notification_email',
        requester: map.get(r.user_id) || null,
        decider: (r.decided_by && map.get(r.decided_by)) || null,
      })));
    } catch (e) {
      SWALLOW(e, 'resolved load failed');
      setResolved([]);
    } finally {
      setResolvedLoading(false);
    }
  }, [user?.id, enrich]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id, approve) => {
    const { error } = await supabase.rpc('decide_notification_email_request', {
      p_request_id: id, p_approve: approve,
    });
    if (error) throw error;
    setItems((prev) => prev.filter((r) => r.id !== id));
    // Freshly-decided row now belongs to history (and the KPIs).
    loadResolved();
  }, [loadResolved]);

  return { items, loading, resolved, resolvedLoading, loadResolved, refetch: load, decide };
}
