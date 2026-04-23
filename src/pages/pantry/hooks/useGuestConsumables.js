// Guest-relevance filter for the /inventory/weekly page body.
//
// Takes the active guest list and the full inventory item list, returns
// items grouped per guest based on whether they match that guest's
// preferences / allergies / health conditions. Irrelevant items drop out —
// generic medical supplies, crew/ops items, anything not tied to an active
// guest stays on the canonical /inventory page, not here.
//
// Matching is pragmatic string / token overlap against three guest signals:
//   1. allergies      — comma-split, lowercased tokens
//   2. health_conditions — same
//   3. guest_preferences rows for this guest — keys + values, tokenised
// Plus a small hardcoded medical cross-reference so e.g. an "Adrenaline
// Auto-Injector" item matches a "Peanuts" allergy without the guest's
// preference text ever mentioning adrenaline by name.
//
// Items that match multiple guests surface in each matching guest's
// section. Duplication is acceptable for v1 — each guest's view is
// "what matters for them" and a shared consumable (coffee, wine) is
// legitimately relevant to both.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

// Allergies / conditions that should surface matching safety/medical items
// regardless of whether the guest's preference text mentions them.
const MEDICAL_CROSS_REF = [
  { match: /\b(peanut|tree\s*nut|nuts?|shellfish|seafood|egg|dairy|bee|wasp|sting|sesame)\b/i,
    items: ['adrenaline', 'epipen', 'jext', 'auto-injector', 'antihistamine'] },
  { match: /\b(asthma|wheeze|bronch)\w*/i,
    items: ['inhaler', 'salbutamol', 'ventolin', 'bronchodilator'] },
  { match: /\b(diabet|hypoglyc)\w*/i,
    items: ['insulin', 'glucose', 'glucagon'] },
  { match: /\b(migraine|headache)\w*/i,
    items: ['paracetamol', 'ibuprofen', 'sumatriptan'] },
];

// Minimal stopword list — just grammar fillers. Content words like
// "morning", "coffee", "regular" stay as signal.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'but', 'etc', 'some', 'that', 'this',
  'are', 'was', 'has', 'have', 'had', 'not', 'any', 'all', 'one', 'two',
  'from', 'into', 'per', 'about', 'over', 'under',
]);

function tokenise(text) {
  if (!text) return new Set();
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  );
}

function splitPills(text) {
  if (!text) return [];
  return String(text).split(',').map(s => s.trim()).filter(Boolean);
}

// Per-guest signal set. Merges allergies + health_conditions + prefs rows
// + the medical cross-reference tokens for this guest's conditions.
function buildGuestSignals(guest, prefsRows) {
  const signals = new Set();

  for (const pill of splitPills(guest?.allergies))        for (const t of tokenise(pill))        signals.add(t);
  for (const pill of splitPills(guest?.health_conditions)) for (const t of tokenise(pill))        signals.add(t);
  for (const t of tokenise(guest?.preferences_summary))   signals.add(t);

  for (const r of prefsRows || []) {
    for (const t of tokenise(r?.key))   signals.add(t);
    for (const t of tokenise(r?.value)) signals.add(t);
  }

  // Medical cross-reference — scan allergy + condition raw text for known
  // triggers, add the corresponding medical item tokens.
  const medText = `${guest?.allergies ?? ''} ${guest?.health_conditions ?? ''}`;
  for (const { match, items } of MEDICAL_CROSS_REF) {
    if (match.test(medText)) {
      for (const name of items) signals.add(name.toLowerCase());
    }
  }

  return signals;
}

// Does this item's name or identifying text overlap with any of the
// guest's signals? Matching is two-way: any signal token that appears as
// a substring of the item name counts. Short signal tokens (len < 3) are
// already filtered by tokenise().
function itemMatchesGuest(item, guestSignals) {
  if (!item?.name || guestSignals.size === 0) return false;
  const haystack = String(item.name).toLowerCase();
  for (const sig of guestSignals) {
    if (haystack.includes(sig)) return true;
  }
  return false;
}

export function useGuestConsumables({ guests, items }) {
  const { user } = useAuth();
  const [prefsByGuest, setPrefsByGuest] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Stable array of active guest IDs — avoids refetching the prefs bundle
  // on every guest-list render when the IDs haven't actually changed.
  const activeGuestIds = useMemo(
    () => (guests ?? []).map(g => g.id).filter(Boolean).sort().join(','),
    [guests]
  );

  // One batched fetch of guest_preferences rows across all active guests.
  useEffect(() => {
    if (!user || !activeGuestIds) {
      setPrefsByGuest({});
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const ids = activeGuestIds.split(',').filter(Boolean);
        if (ids.length === 0) {
          if (!cancelled) setPrefsByGuest({});
          return;
        }
        const { data: member } = await supabase
          .from('tenant_members')
          .select('tenant_id')
          .eq('user_id', user.id)
          .eq('active', true)
          .single();
        if (!member) throw new Error('No active tenant membership');

        const { data, error: err } = await supabase
          .from('guest_preferences')
          .select('guest_id, category, key, value')
          .eq('tenant_id', member.tenant_id)
          .in('guest_id', ids);
        if (err) throw err;

        const bucket = {};
        for (const row of data ?? []) {
          (bucket[row.guest_id] ||= []).push(row);
        }
        if (!cancelled) setPrefsByGuest(bucket);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, activeGuestIds]);

  // Group items by matching guest. Build each guest's signal set once,
  // then scan items against it.
  const byGuest = useMemo(() => {
    const out = {};
    for (const guest of guests ?? []) {
      out[guest.id] = [];
    }
    if (!items?.length || !guests?.length) return out;

    const signalsByGuest = new Map();
    for (const guest of guests) {
      signalsByGuest.set(guest.id, buildGuestSignals(guest, prefsByGuest[guest.id]));
    }

    for (const item of items) {
      for (const guest of guests) {
        const signals = signalsByGuest.get(guest.id);
        if (itemMatchesGuest(item, signals)) {
          out[guest.id].push(item);
        }
      }
    }

    // Per-guest sort: critical first, then qty ascending.
    for (const id of Object.keys(out)) {
      out[id].sort((a, b) => {
        if (a.critical && !b.critical) return -1;
        if (!a.critical && b.critical) return 1;
        return (a.total_qty ?? 0) - (b.total_qty ?? 0);
      });
    }

    return out;
  }, [guests, items, prefsByGuest]);

  return { byGuest, loading, error };
}
