// Item-first hook for /inventory/weekly. Replaces the per-guest
// usePreferenceLinks view with a flat, cross-guest-aggregated list.
//
// Why: two bottles of Tignanello looked fine on John's card in the
// per-guest view but was actually critical when John, Jane, and Susan
// all drank it. The pivot groups by the thing the stew has to act on
// (an inventory item to reorder, or a preference to source), not by
// the guest. Contributing guests are listed below each row.
//
// Architecture notes:
//   - Interior scope only (v1). interior_relevance tags from the Edge
//     Function are filtered at link-ingest time — chef_only links are
//     dropped before pivoting so their daily_consumption doesn't skew
//     the aggregated totals. A future galley dashboard calls the same
//     Edge Function with the same cache and filters to its own scope.
//   - Trip days remaining per item = MIN across contributing guests
//     (soonest-ending trip is the binding constraint). Passes null
//     through when no trip has an end date — assessItem skips
//     projected-need math in that case.
//   - Gap dedup uses subset-word matching: "Tignanello, Super Tuscans"
//     collapses with "Tignanello" when one's significant-word set is a
//     subset of the other's. Simple pairwise O(n²) walk; n is small.
//
// Output shape:
//   {
//     items: [
//       { type: 'inventory', item, guests, total_daily_need,
//         projected_total_need, status, reason, model_note,
//         interior_relevance }
//       | { type: 'gap', preference_summary, guests, model_note,
//           interior_relevance }
//     ],
//     emergency: [
//       { guest_id, guest_name, first_name, condition, device }
//     ],
//     loading, error, refetch
//   }

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { emergencyResponsesForGuest } from '../utils/emergencyDevices';
import { tripDaysRemainingForGuest } from '../utils/tripDaysRemaining';

// Interior scope filter. A future chef dashboard would use
// { 'shared', 'chef_only' } — same Edge Function, same cache,
// different scope here.
const INTERIOR_SCOPE = new Set(['primary', 'shared']);

// Mirror of the Edge Function's deterministic pre-filter. Must stay in
// lockstep with PROVISIONING_KEYS on the server — the hook uses this only
// to short-circuit the Edge Function call when a guest has zero
// provisioning prefs (saves a round-trip + an LLM call on cache miss).
const PROVISIONING_KEYS = new Set([
  'Tea', 'Coffee', 'Wine', 'Wines to Stock', 'Spirits', 'Cocktail',
  'Evening Drink', 'Morning Drink', 'Champagne', 'Beer',
  'Non-Alcoholic Drinks', 'Hot Drinks',
  'Favourite Snacks', 'Late Night Snacks', 'Snacks to Pre-Order',
  'Dessert Preferences', 'Favourite Meals', 'Favourite Cuisines',
  'Bathroom Products',
]);
function isConsumablePreference(p) {
  if (!p?.key) return false;
  if (p?.pref_type === 'avoid') return false;
  if (p?.category === 'Allergies') return false;
  return PROVISIONING_KEYS.has(p.key);
}

function toPayloadItem(row) {
  return {
    id:   row.id,
    name: row.name ?? '',
    qty:  Number.isFinite(row.total_qty) ? row.total_qty : 0,
    par:  Number.isFinite(row.par_level) ? row.par_level : null,
  };
}

function ageFromDob(dobStr) {
  if (!dobStr) return null;
  const d = new Date(String(dobStr));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

// Tokenise a preference value into significant words for subset matching
// on gap dedup. Strips punctuation, stopwords, and words <3 chars.
const GAP_STOPWORDS = new Set([
  'the','and','for','with','or','of','to','in','a','an','at','on','by',
]);
function gapWords(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !GAP_STOPWORDS.has(w));
}

// Are two gap values the same real-world preference? True when one's
// word set is a subset of the other's. Catches "Tignanello" ↔
// "Tignanello, Super Tuscans" and "Molton Brown" ↔ "Molton Brown and
// Redken". Fails gracefully when both sides have disjoint vocabulary
// (keeps them as separate rows, which is correct).
function isSameGapPreference(a, b) {
  if (!a || !b) return false;
  const wa = gapWords(a);
  const wb = gapWords(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const setA = new Set(wa);
  const setB = new Set(wb);
  const aSubsetB = wa.every(w => setB.has(w));
  const bSubsetA = wb.every(w => setA.has(w));
  return aSubsetB || bSubsetA;
}

// When two gap values merge, display the more specific one — longer
// significant-word list wins.
function pickCanonicalGapValue(a, b) {
  const wa = gapWords(a);
  const wb = gapWords(b);
  if (wb.length > wa.length) return b;
  if (wa.length > wb.length) return a;
  // Tie-break on raw length — more characters = more context.
  return String(a).length >= String(b).length ? a : b;
}

function aggregateRelevance(rels) {
  if (rels.some(r => r === 'primary')) return 'primary';
  if (rels.some(r => r === 'shared'))  return 'shared';
  return 'chef_only';
}

// Same guest can contribute multiple links to one bucket — e.g. John has
// "Late Night Snacks · Popcorn, Dark Chocolate" AND a separate dessert
// preference both linking to the same chocolate item. Without dedup the
// row reads "for John and John" and his daily_consumption gets counted
// twice. First contribution wins for original_preference_key + the note
// + the daily_consumption — keeps the math honest.
function dedupeContributorsByGuest(contributors) {
  const seen = new Set();
  const out  = [];
  for (const c of contributors) {
    const id = c?.guest?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}

function pickBestNote(notes, confidences) {
  // Pick the note tied to the highest-confidence link. If tied, first one.
  const order = { high: 3, medium: 2, low: 1, none: 0 };
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < notes.length; i++) {
    const s = order[confidences[i]] ?? 0;
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return notes[bestIdx] ?? '';
}

function assessItem(item, tripDaysRemaining) {
  const qty = Number.isFinite(item.item.qty) ? item.item.qty : 0;
  const par = Number.isFinite(item.item.par) ? item.item.par : null;

  if (par != null && qty < par) {
    return { status: 'at_risk', reason: `Below par (${qty}/${par})` };
  }
  if (tripDaysRemaining != null && item.total_daily_need > 0) {
    const need = item.total_daily_need * tripDaysRemaining;
    if (qty < need) {
      const n = item.guests.length;
      return {
        status: 'at_risk',
        reason: `Trip needs ~${Math.ceil(need)} for ${n} guest${n === 1 ? '' : 's'}, have ${qty}`,
      };
    }
  }
  return { status: 'ok' };
}

function guestSummary(guest) {
  return {
    id:         guest.id,
    name:       [guest.first_name, guest.last_name].filter(Boolean).join(' ').trim(),
    first_name: guest.first_name ?? '',
    role:       guest.guest_type ?? null,
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useInventoryConsumables() {
  const { user } = useAuth();
  const [state, setState] = useState({
    items:     [],
    emergency: [],
    loading:   true,
    error:     null,
  });

  const reqIdRef = useRef(0);

  const run = useCallback(async () => {
    if (!user) {
      setState({ items: [], emergency: [], loading: false, error: null });
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

      // Fetch active guests + all inventory in parallel. Inventory is
      // shared across guests so we fetch once, not per-guest.
      const [guestsRes, invRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, first_name, last_name, guest_type, date_of_birth, allergies, health_conditions')
          .eq('tenant_id', member.tenant_id)
          .eq('is_deleted', false)
          .eq('is_active_on_trip', true)
          .order('last_name'),
        supabase
          .from('inventory_items')
          .select('id, name, unit, total_qty, par_level, reorder_point')
          .eq('tenant_id', member.tenant_id)
          .not('total_qty', 'is', null),
      ]);
      if (guestsRes.error) throw guestsRes.error;
      if (invRes.error)    throw invRes.error;

      const guests = guestsRes.data ?? [];
      const invRows = invRes.data ?? [];
      const invById = new Map(invRows.map(r => [r.id, r]));
      const payloadItems = invRows.map(toPayloadItem);

      if (guests.length === 0) {
        if (reqId !== reqIdRef.current) return;
        setState({ items: [], emergency: [], loading: false, error: null });
        return;
      }

      // Per-guest: fetch prefs + call Edge Function in parallel.
      const perGuestResults = await Promise.all(guests.map(async guest => {
        try {
          const { data: prefsRows, error: prefsErr } = await supabase
            .from('guest_preferences')
            .select('category, key, value, pref_type')
            .eq('tenant_id', member.tenant_id)
            .eq('guest_id', guest.id);
          if (prefsErr) throw prefsErr;

          const tripDays = tripDaysRemainingForGuest(guest.id);
          const hasConsumable = (prefsRows ?? []).some(isConsumablePreference);

          let links = [];
          if (hasConsumable) {
            const { data, error: fnError } = await supabase.functions.invoke(
              'generate-preference-links',
              {
                body: {
                  guest_id:            guest.id,
                  guest_name:          [guest.first_name, guest.last_name].filter(Boolean).join(' ').trim() || null,
                  guest_role:          guest.guest_type ?? null,
                  guest_age:           ageFromDob(guest.date_of_birth),
                  trip_days_remaining: tripDays,
                  preferences:         (prefsRows ?? []).map(p => ({
                    key:       p.key ?? '',
                    value:     p.value ?? '',
                    category:  p.category ?? '',
                    pref_type: p.pref_type ?? null,
                  })),
                  inventory_items:     payloadItems,
                },
              },
            );
            if (fnError) throw fnError;
            links = Array.isArray(data?.links) ? data.links : [];
          }

          const emergency = emergencyResponsesForGuest(guest, invRows);
          return { guest, tripDays, links, emergency, error: null };
        } catch (e) {
          // Per-guest failure: emergency still attempts to compute
          // against the already-fetched inventory.
          const emergency = emergencyResponsesForGuest(guest, invRows);
          return {
            guest, tripDays: tripDaysRemainingForGuest(guest.id),
            links: [], emergency,
            error: e instanceof Error ? e : new Error(String(e?.message ?? e)),
          };
        }
      }));

      if (reqId !== reqIdRef.current) return;

      // Surface the first per-guest error to the caller. Partial data
      // still returns (other guests might have succeeded) — the page
      // can render what it has alongside a soft error state.
      const firstError = perGuestResults.find(r => r.error)?.error ?? null;

      // ── Pivot ────────────────────────────────────────────────────────
      // 1. Collect all interior-scope links across all guests.
      // 2. Bucket by matched_item_id (inventory type) or subset-word
      //    match (gap type).
      // 3. Assess each inventory bucket, drop OK rows.
      // 4. Filter chef_only buckets from the output entirely.

      const inventoryBuckets = new Map(); // matched_item_id → bucket

      // Gap buckets are an array with pairwise subset matching — not a
      // Map since normalised keys don't cleanly identify "same thing".
      const gapBuckets = [];

      for (const r of perGuestResults) {
        if (!r.links?.length) continue;
        for (const link of r.links) {
          // Early filter: drop chef_only links before aggregation so
          // their consumption doesn't skew interior-scope totals.
          if (!INTERIOR_SCOPE.has(link.interior_relevance)) continue;

          const contributor = {
            guest:                     guestSummary(r.guest),
            daily_consumption:         link.daily_consumption_estimate ?? 0,
            original_preference_key:   link.preference_key ?? '',
            original_preference_value: link.preference_value ?? '',
            interior_relevance:        link.interior_relevance,
            confidence:                link.match_confidence,
            note:                      link.note ?? '',
            trip_days_remaining:       r.tripDays,
          };

          if (link.matched_item_id && invById.has(link.matched_item_id)) {
            const id = link.matched_item_id;
            if (!inventoryBuckets.has(id)) {
              inventoryBuckets.set(id, {
                type:         'inventory',
                item:         invById.get(id),
                contributors: [],
              });
            }
            inventoryBuckets.get(id).contributors.push(contributor);
          } else {
            // Gap — look for an existing bucket with a matching
            // preference value (subset-word). If none, new bucket.
            const pv = link.preference_value ?? '';
            let matched = null;
            for (const b of gapBuckets) {
              if (isSameGapPreference(b.preference_value, pv)) {
                matched = b; break;
              }
            }
            if (!matched) {
              matched = {
                type:             'gap',
                preference_value: pv,
                contributors:     [],
              };
              gapBuckets.push(matched);
            }
            matched.contributors.push(contributor);
            // Upgrade the canonical value to the more-specific one.
            matched.preference_value = pickCanonicalGapValue(matched.preference_value, pv);
          }
        }
      }

      // Shape + assess inventory rows.
      const inventoryItems = [];
      for (const bucket of inventoryBuckets.values()) {
        const contributors = dedupeContributorsByGuest(bucket.contributors);
        const tripDaysList = contributors
          .map(c => c.trip_days_remaining)
          .filter(v => v != null);
        const itemTripDays = tripDaysList.length > 0 ? Math.min(...tripDaysList) : null;

        const totalDailyNeed = contributors
          .reduce((sum, c) => sum + (c.daily_consumption || 0), 0);

        const assessable = {
          item: {
            qty: Number.isFinite(bucket.item.total_qty) ? bucket.item.total_qty : 0,
            par: Number.isFinite(bucket.item.par_level) ? bucket.item.par_level : null,
          },
          total_daily_need: totalDailyNeed,
          guests:           contributors,
        };
        const assessment = assessItem(assessable, itemTripDays);
        if (assessment.status === 'ok') continue;

        inventoryItems.push({
          type:   'inventory',
          item: {
            id:   bucket.item.id,
            name: bucket.item.name,
            unit: bucket.item.unit,
            qty:  assessable.item.qty,
            par:  assessable.item.par,
          },
          guests: contributors.map(c => ({
            ...c.guest,
            daily_consumption:       c.daily_consumption,
            original_preference_key: c.original_preference_key,
          })),
          total_daily_need:      totalDailyNeed,
          projected_total_need:  itemTripDays != null ? totalDailyNeed * itemTripDays : null,
          trip_days_remaining:   itemTripDays,
          status:                assessment.status,
          reason:                assessment.reason,
          model_note:            pickBestNote(
            contributors.map(c => c.note),
            contributors.map(c => c.confidence),
          ),
          interior_relevance:    aggregateRelevance(contributors.map(c => c.interior_relevance)),
        });
      }

      const gapItems = gapBuckets.map(b => {
        const contributors = dedupeContributorsByGuest(b.contributors);
        return {
          type:               'gap',
          preference_summary: b.preference_value,
          guests:             contributors.map(c => ({
            ...c.guest,
            original_preference_key: c.original_preference_key,
          })),
          model_note:         pickBestNote(
            contributors.map(c => c.note),
            contributors.map(c => c.confidence),
          ),
          interior_relevance: aggregateRelevance(contributors.map(c => c.interior_relevance)),
        };
      });

      // ── Sort ─────────────────────────────────────────────────────────
      // Inventory rows: guests count descending, then qty/par gap desc.
      // Gap rows: guests count descending, then alpha on canonical value.
      inventoryItems.sort((a, b) => {
        if (b.guests.length !== a.guests.length) return b.guests.length - a.guests.length;
        const aGap = (a.item.par ?? 0) - (a.item.qty ?? 0);
        const bGap = (b.item.par ?? 0) - (b.item.qty ?? 0);
        return bGap - aGap;
      });
      gapItems.sort((a, b) => {
        if (b.guests.length !== a.guests.length) return b.guests.length - a.guests.length;
        return String(a.preference_summary).localeCompare(String(b.preference_summary));
      });

      // ── Emergency — flatten per-guest responses ──────────────────────
      const emergency = [];
      for (const r of perGuestResults) {
        for (const resp of r.emergency) {
          emergency.push({
            guest_id:        r.guest.id,
            guest_name:      [r.guest.first_name, r.guest.last_name].filter(Boolean).join(' ').trim(),
            first_name:      r.guest.first_name ?? '',
            role:            r.guest.guest_type ?? null,
            condition:       resp.condition,
            condition_label: resp.condition_label,
            device:          resp.device,
          });
        }
      }

      if (reqId !== reqIdRef.current) return;

      setState({
        items:     [...inventoryItems, ...gapItems],
        emergency,
        loading:   false,
        error:     firstError,
      });
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setState({
        items:     [],
        emergency: [],
        loading:   false,
        error:     e instanceof Error ? e : new Error(String(e?.message ?? e)),
      });
    }
  }, [user]);

  useEffect(() => { run(); }, [run]);

  const refetch = useCallback(() => run(), [run]);

  return useMemo(() => ({
    ...state,
    refetch,
  }), [state, refetch]);
}
