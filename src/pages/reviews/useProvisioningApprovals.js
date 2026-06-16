import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

// useProvisioningApprovals — pulls pending approval_requests assigned
// to the current user, hydrated with the submitter's display name and
// the board's title + primary department for the list-strip card.
//
// PR1 schema doesn't enforce a FK from profiles → tenant_members on the
// submitter, and provisioning_lists' department is a text[] (no FK to
// departments), so we do two lightweight follow-up fetches rather than
// asking PostgREST to embed everything in one shot. Stable enough for
// the inbox queue size.
//
// Refresh modes:
//   * polled every 60s while mounted (matches rotas' polling rhythm)
//   * `refetch()` returned so the panel can re-run after a decision

export function useProvisioningApprovals() {
  const { user } = useAuth();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // 1. Open requests for me.
      const { data: reqs, error: rErr } = await supabase
        .from('provisioning_approval_requests')
        .select('id, list_id, submitter_id, status, comment, created_at, prev_status')
        .eq('approver_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (rErr) throw rErr;
      const rows = reqs || [];

      if (rows.length === 0) { setItems([]); return; }

      // 2. Hydrate with board + submitter profile in two parallel fetches.
      const listIds      = [...new Set(rows.map(r => r.list_id))];
      const submitterIds = [...new Set(rows.map(r => r.submitter_id))];

      const [{ data: lists }, { data: profiles }] = await Promise.all([
        supabase
          .from('provisioning_lists')
          .select('id, title, department, board_type, currency')
          .in('id', listIds),
        supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', submitterIds),
      ]);

      const listMap    = new Map((lists    || []).map(l => [l.id, l]));
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const enriched = rows.map(r => {
        const list = listMap.get(r.list_id) || {};
        const submitter = profileMap.get(r.submitter_id) || {};
        const depts = Array.isArray(list.department)
          ? list.department.filter(Boolean)
          : (list.department ? [list.department] : []);
        return {
          id:               r.id,
          list_id:          r.list_id,
          status:           r.status,
          comment:          r.comment,
          created_at:       r.created_at,
          prev_status:      r.prev_status || null,
          is_re_approval:   r.prev_status === 'quote_received',
          board_title:      list.title || 'Untitled board',
          board_type:       list.board_type || 'general',
          primary_dept:     depts[0] || null,
          submitter_name:   submitter.full_name
            || (submitter.email ? submitter.email.split('@')[0] : 'Someone'),
        };
      });

      setItems(enriched);
    } catch (err) {
      console.error('[useProvisioningApprovals] load error:', err);
      setError(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return { items, loading, error, refetch: load };
}
