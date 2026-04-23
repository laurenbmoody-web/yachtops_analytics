// Client-side AI-insights fetcher for the /inventory/weekly page.
//
// Wraps the generate-inventory-insights Supabase Edge Function with a
// localStorage cache keyed per tenant. Two invalidation rules run on every
// cache hit:
//
//   1. Age. Anything older than 30 minutes is stale. Covers the "crew came
//      back from lunch, guest prefs shifted, refresh the insights" case.
//   2. Inventory change. We include max(updated_at) from the currently-
//      loaded items in the cache key + re-check on every read. A delivery
//      ledger entry or manual qty correction bumps an item's updated_at;
//      the next render sees a newer max and busts the cache. Honest data
//      with one extra max() computation per cache check.
//
// Intentionally NOT invalidated by:
//   - Guest preference changes mid-window. Low signal-to-noise; Refresh
//     button handles it manually. If this proves too loose in testing, we
//     can add a guest-side max(updated_at) check the same way.
//   - Realtime subscriptions on inventory_items. Phase 4 scope.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

const CACHE_TTL_MS = 30 * 60 * 1000;       // 30 min hard cap
const CACHE_VERSION = 'v1';                // bump to invalidate all clients
const CACHE_KEY_PREFIX = `cargo.inventoryInsights.${CACHE_VERSION}.`;

function readCache(tenantId) {
  if (!tenantId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + tenantId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(tenantId, payload) {
  if (!tenantId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY_PREFIX + tenantId, JSON.stringify(payload));
  } catch {
    /* quota / private mode — silently skip; the feature degrades to always
       calling the edge function which is correct behaviour. */
  }
}

// Max updated_at across the item set, as a millisecond timestamp. Used to
// detect inventory changes since the cached insights were generated.
function maxUpdatedAtMs(items) {
  let max = 0;
  for (const it of items || []) {
    const t = Date.parse(it?.updated_at ?? '');
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

// Flagged items are the ones worth sending to the LLM. Mirrors the standby
// Stock widget's criticality rule (see useInventoryThisWeek.js).
function isFlagged(item) {
  if (item?.total_qty == null) return false;
  const threshold = item.reorder_point ?? (item.par_level ? item.par_level / 2 : 2);
  return item.total_qty <= threshold || (item.par_level != null && item.total_qty < item.par_level);
}

// Shape a guest row for the edge function's context block. Drops anything
// the prompt doesn't use to keep the token footprint tight.
function mapGuestForPrompt(g) {
  return {
    name: g.first_name ?? '',
    role: g.guest_type ?? null,
    preferences_summary: g.preferences_summary ?? '',
    allergies: g.allergies ?? '',
  };
}

function mapItemForPrompt(it) {
  return {
    name:    it.name ?? '',
    qty:     it.total_qty ?? null,
    unit:    it.unit ?? null,
    par:     it.par_level ?? null,
    reorder: it.reorder_point ?? null,
  };
}

export function useInventoryInsights({ guests, items }) {
  const { user } = useAuth();
  const [insights, setInsights] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [tenantId, setTenantId] = useState(null);

  // Resolve tenant_id once — scopes the cache correctly.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();
      if (!cancelled) setTenantId(member?.tenant_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Flagged items — the LLM only sees the worth-mentioning subset. Memoised
  // so the fetch effect doesn't retrigger on every render.
  const flaggedItems = useMemo(() => (items ?? []).filter(isFlagged), [items]);
  const currentMaxUpdatedAt = useMemo(() => maxUpdatedAtMs(items), [items]);

  // Latest request guard — an older in-flight fetch shouldn't overwrite a
  // newer one's result. Useful if the Refresh button is mashed.
  const reqIdRef = useRef(0);

  // Core fetch. `bypassCache` forces an edge-function call regardless of
  // cache state — the Refresh button calls this path.
  const callEdgeFunction = useCallback(async (bypassCache = false) => {
    if (!tenantId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    try {
      if (!bypassCache) {
        const cached = readCache(tenantId);
        const now = Date.now();
        const ageOk     = cached && (now - cached.fetchedAt) < CACHE_TTL_MS;
        const invOk     = cached && cached.itemsMaxUpdatedAt >= currentMaxUpdatedAt;
        if (cached && ageOk && invOk) {
          if (reqId !== reqIdRef.current) return;
          setInsights(cached.insights ?? []);
          setFetchedAt(cached.fetchedAt);
          setLoading(false);
          return;
        }
      }

      const body = {
        guests:          (guests ?? []).map(mapGuestForPrompt),
        inventory_items: flaggedItems.map(mapItemForPrompt),
      };

      const { data, error: fnError } = await supabase.functions.invoke(
        'generate-inventory-insights',
        { body }
      );

      if (fnError) throw fnError;
      if (reqId !== reqIdRef.current) return;

      const nextInsights = Array.isArray(data?.insights) ? data.insights : [];
      const now = Date.now();

      setInsights(nextInsights);
      setFetchedAt(now);
      writeCache(tenantId, {
        insights:            nextInsights,
        fetchedAt:           now,
        itemsMaxUpdatedAt:   currentMaxUpdatedAt,
      });
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      // Graceful degradation: keep displaying the last-cached insights if
      // we have them. The page can surface the error in a muted line
      // without blowing away the content.
      setError(e?.message ?? 'Failed to generate insights');
      const cached = readCache(tenantId);
      if (cached?.insights) {
        setInsights(cached.insights);
        setFetchedAt(cached.fetchedAt);
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [tenantId, guests, flaggedItems, currentMaxUpdatedAt]);

  // Auto-fetch when tenant + items are known. Deps include currentMaxUpdatedAt
  // so a delivery that bumps items' updated_at invalidates implicitly here.
  useEffect(() => {
    if (!tenantId) return;
    if (!items) return; // items still loading upstream
    callEdgeFunction(false);
  }, [tenantId, items, currentMaxUpdatedAt, callEdgeFunction]);

  const refetch = useCallback(() => callEdgeFunction(true), [callEdgeFunction]);

  return {
    insights,
    loading,
    error,
    fetchedAt,
    flaggedCount: flaggedItems.length,
    refetch,
  };
}
