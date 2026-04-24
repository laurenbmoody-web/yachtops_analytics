// Per-guest hook for the /inventory/weekly page body. Replaces the
// tokeniser-era useGuestConsumables.
//
// Returns the three populated buckets the page renders:
//   atRisk      — matched items below par OR projected to run out before
//                 trip end. Each row carries the inventory item + reason.
//   notTracked  — preferences with no matching inventory. Each row carries
//                 the link note as reason.
//   emergency   — stew-administrable single devices from the existing
//                 emergency-device map (imported from ../utils/emergencyDevices).
//                 Unchanged logic — untouched per spec.
//
// Data flow:
//   1. Fetch this guest's row (for allergies / DOB / role) and their
//      guest_preferences rows, tenant-scoped.
//   2. Fetch current inventory items.
//   3. Compute trip_days_remaining from localStorage trips.
//   4. Call the generate-preference-links Edge Function. Edge Function
//      handles deterministic category allowlist + per-snapshot cache.
//   5. Run assessLink() on each returned link against the matched
//      inventory item + trip_days_remaining. Bucket into atRisk /
//      notTracked. Drop items coming back as 'ok'.
//   6. Compute emergency devices via the existing util.
//
// Loading/error semantics:
//   loading: true while any of (data fetches, edge function call) in flight.
//   error:   Error instance on failure. atRisk/notTracked empty in that
//            state so the parent renders a fallback; emergency still
//            populates if the preceding data fetches succeeded (it
//            doesn't depend on the Edge Function).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { emergencyDevicesForGuest } from '../utils/emergencyDevices';
import { tripDaysRemainingForGuest } from '../utils/tripDaysRemaining';

// Normalise the inventory fetch into the shape the Edge Function expects
// + assessLink consumes. One mapping, two consumers.
function toPayloadItem(row) {
  return {
    id:   row.id,
    name: row.name ?? '',
    qty:  Number.isFinite(row.total_qty) ? row.total_qty : 0,
    par:  Number.isFinite(row.par_level) ? row.par_level : null,
  };
}

// Deterministic post-LLM assessment. Pure function — no React, no
// fetches — easy to unit-test later if we want to.
//
// Status outcomes:
//   not_tracked  → no matched inventory item. reason = link.note.
//   at_risk      → below par, OR projected trip need exceeds stock.
//                  reason describes which.
//   ok           → stocked and covered. Dropped by the caller.
export function assessLink(link, inventoryItem, tripDaysRemaining) {
  if (!inventoryItem) {
    return { status: 'not_tracked', reason: link.note ?? '' };
  }

  const qty = Number.isFinite(inventoryItem.qty) ? inventoryItem.qty : 0;
  const par = Number.isFinite(inventoryItem.par) ? inventoryItem.par : null;

  // Par check fires when par is known AND qty < par. Par=null (no par set)
  // skips the par check — trip-need math alone decides.
  if (par != null && qty < par) {
    const projectedNeed = tripDaysRemaining != null && link.daily_consumption_estimate > 0
      ? link.daily_consumption_estimate * tripDaysRemaining
      : 0;
    return {
      status: 'at_risk',
      reason: `Below par (${qty} / par ${par})`,
      projectedNeed,
    };
  }

  // Trip-need check only runs when we have days remaining AND the link has
  // a positive daily consumption rate. Open-ended trips (null) fall through
  // to 'ok' on the par path only.
  if (tripDaysRemaining != null && link.daily_consumption_estimate > 0) {
    const projectedNeed = link.daily_consumption_estimate * tripDaysRemaining;
    if (qty < projectedNeed) {
      return {
        status: 'at_risk',
        reason: `Trip needs ~${Math.ceil(projectedNeed)}, have ${qty}`,
        projectedNeed,
      };
    }
  }

  return { status: 'ok' };
}

export function usePreferenceLinks(guestId) {
  const { user } = useAuth();
  const [state, setState] = useState({
    atRisk:     [],
    notTracked: [],
    emergency:  [],
    loading:    true,
    error:      null,
  });

  // Latest-request guard so a stale fetch can't overwrite a fresher one
  // if the guestId changes rapidly.
  const reqIdRef = useRef(0);

  const run = useCallback(async () => {
    if (!user || !guestId) {
      setState({ atRisk: [], notTracked: [], emergency: [], loading: false, error: null });
      return;
    }
    const reqId = ++reqIdRef.current;
    setState(s => ({ ...s, loading: true, error: null }));

    try {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();
      if (!member) throw new Error('No active tenant membership');

      const [guestRes, prefsRes, invRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, first_name, last_name, guest_type, date_of_birth, allergies, health_conditions')
          .eq('id', guestId)
          .single(),
        supabase
          .from('guest_preferences')
          .select('category, key, value')
          .eq('tenant_id', member.tenant_id)
          .eq('guest_id', guestId),
        supabase
          .from('inventory_items')
          .select('id, name, unit, total_qty, par_level, reorder_point')
          .eq('tenant_id', member.tenant_id)
          .not('total_qty', 'is', null),
      ]);

      if (guestRes.error) throw guestRes.error;
      if (prefsRes.error) throw prefsRes.error;
      if (invRes.error)   throw invRes.error;

      const guest        = guestRes.data ?? null;
      const prefsRows    = prefsRes.data ?? [];
      const invRows      = invRes.data ?? [];
      const payloadItems = invRows.map(toPayloadItem);
      const inventoryById = new Map(payloadItems.map(i => [i.id, i]));

      // Emergency devices: compute regardless of the Edge Function outcome.
      // Even if the LLM call fails we still want to surface rescue items.
      const emergency = emergencyDevicesForGuest(guest, invRows);

      if (reqId !== reqIdRef.current) return;

      const tripDaysRemaining = tripDaysRemainingForGuest(guestId);

      // Call Edge Function. If it fails, we still render emergency rows +
      // the error state so the page doesn't go blank.
      let links = [];
      let cacheFlag = null;
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          'generate-preference-links',
          {
            body: {
              guest_id:              guest?.id,
              guest_name:            [guest?.first_name, guest?.last_name].filter(Boolean).join(' ').trim() || null,
              guest_role:            guest?.guest_type ?? null,
              guest_age:             ageFromDob(guest?.date_of_birth),
              trip_days_remaining:   tripDaysRemaining,
              preferences:           prefsRows.map(p => ({
                key:      p.key ?? '',
                value:    p.value ?? '',
                category: p.category ?? '',
              })),
              inventory_items:       payloadItems,
            },
          },
        );
        if (fnError) throw fnError;
        links = Array.isArray(data?.links) ? data.links : [];
        cacheFlag = data?.cache ?? null;
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        // Soft failure: render emergency-only with an error badge on the
        // page. atRisk/notTracked stay empty. User can retry.
        setState({
          atRisk:     [],
          notTracked: [],
          emergency,
          loading:    false,
          error:      e instanceof Error ? e : new Error(String(e?.message ?? e)),
        });
        return;
      }

      if (reqId !== reqIdRef.current) return;

      // Dev-only cache visibility per spec §Phase 4. Gated so it's silent
      // in production builds (Vite import.meta.env.PROD = true in prod).
      if (typeof import.meta !== 'undefined' && !import.meta.env?.PROD) {
        // eslint-disable-next-line no-console
        console.log(`[usePreferenceLinks] guest=${guestId.slice(0,8)} cache=${cacheFlag} links=${links.length} tripDays=${tripDaysRemaining}`);
      }

      // Assess + bucket.
      const atRisk     = [];
      const notTracked = [];
      for (const link of links) {
        const item      = link.matched_item_id ? inventoryById.get(link.matched_item_id) ?? null : null;
        const assessed  = assessLink(link, item, tripDaysRemaining);
        if (assessed.status === 'at_risk') {
          atRisk.push({ link, item, reason: assessed.reason, projectedNeed: assessed.projectedNeed });
        } else if (assessed.status === 'not_tracked') {
          notTracked.push({ link, reason: assessed.reason });
        }
        // 'ok' drops silently.
      }

      // Stable order: at_risk sorted by qty ascending (biggest gap first),
      // notTracked in preference-input order.
      atRisk.sort((a, b) => {
        const qa = a.item?.qty ?? 0;
        const qb = b.item?.qty ?? 0;
        return qa - qb;
      });

      setState({ atRisk, notTracked, emergency, loading: false, error: null });
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setState({
        atRisk:     [],
        notTracked: [],
        emergency:  [],
        loading:    false,
        error:      e instanceof Error ? e : new Error(String(e?.message ?? e)),
      });
    }
  }, [user, guestId]);

  useEffect(() => { run(); }, [run]);

  const refetch = useCallback(() => run(), [run]);

  return useMemo(() => ({
    ...state,
    refetch,
  }), [state, refetch]);
}

// Tiny age helper mirrored from emergencyDevices for the Edge Function
// payload. Kept local because the Edge Function prefers a number, null,
// or undefined — not an empty string or NaN.
function ageFromDob(dobStr) {
  if (!dobStr) return null;
  const d = new Date(String(dobStr));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}
