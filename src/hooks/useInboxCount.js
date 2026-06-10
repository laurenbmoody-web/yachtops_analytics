// useInboxCount — live count of pending review_items routed to the
// current user. Reads under the user's own RLS predicates (see Phase 1
// review_items_assignee_update policy), so we just SELECT status='pending'
// and Postgres returns only the ones the user can act on.
//
// Polled at 30s. No realtime channel — the codebase doesn't use
// realtime subscriptions for similar live counts (notifications
// poll-refresh via Header.jsx's useEffect-on-mount + onOpen pattern),
// so this matches the established cadence.
//
// SELECT uses count:'exact', head:true — single round-trip, no payload.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const POLL_MS = 30_000;

export function useInboxCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      const { count: n, error } = await supabase
        .from('review_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (cancelled) return;
      if (error) {
        console.error('[useInboxCount] fetch failed:', error);
        return;
      }
      setCount(n || 0);
    };
    fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return count;
}
