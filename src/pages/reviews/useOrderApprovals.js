import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';

// useOrderApprovals — pending chat-order sign-offs the current user is entitled
// to approve, for the "Orders, to approve" queue. Shaped to overlap the board
// approval item (id / board_title / board_type / submitter_name / created_at) so
// they render side by side in the same list, with `kind: 'order'` marking them
// for the right pane. Tier gating is enforced server-side by the RPC.
export function useOrderApprovals() {
  const { activeTenantId } = useTenant();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    if (!activeTenantId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rErr } = await supabase
        .rpc('fetch_pending_order_approvals', { p_tenant_id: activeTenantId });
      if (rErr) throw rErr;
      const rows = (data || []).map((r) => ({
        kind:           'order',
        id:             r.order_id,
        order_id:       r.order_id,
        board_id:       r.board_id,
        board_title:    r.supplier_name || 'Supplier order',
        board_type:     'ORDER',
        primary_dept:   null,
        submitter_name: r.requested_by || 'Someone',
        created_at:     r.created_at,
        total:          r.total != null ? Number(r.total) : 0,
        currency:       r.currency || 'EUR',
        item_count:     r.item_count || 0,
      }));
      setItems(rows);
    } catch (err) {
      console.error('[useOrderApprovals] load error:', err);
      setError(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return { items, loading, error, refetch: load };
}
