import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

export function useInventoryThisWeek({ limit = 4 } = {}) {
  const { user } = useAuth();
  const [items, setItems]     = useState([]);
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

      // updated_at is included so downstream callers (InventoryWeeklyPage +
      // useInventoryInsights) can use max(updated_at) as a cache-freshness
      // signal without a second round-trip.
      let query = supabase
        .from('inventory_items')
        .select('id, name, unit, total_qty, par_level, reorder_point, updated_at')
        .eq('tenant_id', member.tenant_id)
        .not('total_qty', 'is', null)
        .order('total_qty', { ascending: true });

      // limit=null → fetch all flagged items for the weekly page. Widget
      // callers still pass a numeric limit and get top-N.
      if (limit != null) query = query.limit(limit * 2);

      const { data, error: err } = await query;

      if (err) throw err;

      // Simple v1 criticality: critical when total_qty <= reorder_point (or par_level / 2)
      const scored = (data ?? []).map(item => {
        const threshold = item.reorder_point ?? (item.par_level ? item.par_level / 2 : 2);
        return { ...item, critical: item.total_qty <= threshold };
      });

      // Sort: critical first, then by qty ascending
      scored.sort((a, b) => {
        if (a.critical && !b.critical) return -1;
        if (!a.critical && b.critical) return 1;
        return (a.total_qty ?? 0) - (b.total_qty ?? 0);
      });

      setItems(limit != null ? scored.slice(0, limit) : scored);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  return { items, loading, error, refetch: fetch };
}
