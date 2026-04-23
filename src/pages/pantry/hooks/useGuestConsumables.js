// Guest-relevance filter for the /inventory/weekly page body.
//
// Takes the active guest list and the full inventory item list, returns
// items grouped per guest. An item surfaces under a specific guest ONLY if:
//
//   1. Its name matches a token from that guest's FOOD & BEVERAGE
//      preference rows (Coffee, Tea, Wine, Favourite Cuisines,
//      Favourite Meals, etc). Non-food preference categories (Cabin,
//      Service, Routine, Activities) are intentionally excluded — their
//      values describe lifestyle/service attributes, not inventory
//      items, and tokenising them leaks noise words like "regular" and
//      "moderate" that collide with unrelated item names.
//
//   2. The item is a known medical response to that guest's specific
//      allergy (Peanuts → Adrenaline Auto-Injector / Jext / EpiPen)
//      or health condition (Asthma → inhaler) via a hardcoded cross-
//      reference map. The allergy/condition words themselves are NOT
//      added as signals — we don't want "Peanuts" as an allergy to
//      match "Peanut butter"; only the medical response items.
//
// Everything else — generic first-aid, crew supplies, ops/maintenance,
// bandages / splints / gels without a condition correspondence — is
// filtered out. Those stay on the canonical /inventory page.
//
// Guest preferences_summary prose is NOT tokenised. It's a narrative
// field and using it as match signal was too loose — was the root cause
// of random medical supplies showing up under guests who had none of
// those conditions.
//
// Matching uses word-boundary regex, not substring, so a 3-letter
// token like "cap" doesn't spuriously match "capsicum" or "mildew".

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

// The only guest_preferences category that contributes signal tokens.
// Other categories describe lifestyle, not inventory items.
const FOOD_PREF_CATEGORY = 'Food & Beverage';

// Explicit allergy / health-condition → medical-response item map.
// Extend one-line per new trigger. Order matters only for readability;
// each is tested independently.
const MEDICAL_CROSS_REF = [
  { match: /\b(peanut|tree\s*nut|nuts?|shellfish|seafood|egg|dairy|bee|wasp|sting|sesame|anaphylax)\w*\b/i,
    items: ['adrenaline', 'epipen', 'jext', 'auto-injector', 'antihistamine'] },
  { match: /\b(asthma|wheeze|bronch)\w*\b/i,
    items: ['inhaler', 'salbutamol', 'ventolin', 'bronchodilator', 'spacer'] },
  { match: /\b(diabet|hypoglyc)\w*\b/i,
    items: ['insulin', 'glucose', 'glucagon', 'monitor'] },
  { match: /\b(migraine|headache)\w*\b/i,
    items: ['paracetamol', 'ibuprofen', 'sumatriptan'] },
];

// Stopwords applied to pref-value tokenisation. Common wizard enum values
// ('regular', 'moderate', 'mild') and generic food descriptors that would
// cause cross-guest noise matches.
const PREF_STOPWORDS = new Set([
  // grammar fillers
  'the', 'and', 'for', 'with', 'but', 'etc', 'some', 'that', 'this',
  'are', 'was', 'has', 'have', 'had', 'not', 'any', 'all', 'one', 'two',
  'from', 'into', 'per', 'about', 'over', 'under', 'each',
  // wizard enum values / generic descriptors that match too broadly
  'regular', 'none', 'mild', 'medium', 'hot', 'cold', 'low', 'moderate',
  'high', 'small', 'large', 'generous', 'once', 'twice', 'slow', 'quick',
  'fast', 'daily', 'weekly', 'occasional',
  'morning', 'evening', 'night', 'afternoon', 'breakfast', 'lunch', 'dinner',
  'avoid', 'tolerance', 'frequency', 'preference', 'preferences',
  'prefers', 'preferred', 'favourite', 'favorite', 'style', 'type',
]);

function tokeniseForPref(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !PREF_STOPWORDS.has(w));
}

// Word-boundary match against a single item name. A signal token has to
// appear as a whole word — "cap" won't match "capsicum", "mild" won't
// match "mildew". Signals are already lowercased.
function itemMatchesSignal(itemName, signals) {
  if (!itemName || !signals || signals.size === 0) return false;
  const haystack = String(itemName).toLowerCase();
  for (const sig of signals) {
    if (!sig) continue;
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(haystack)) return true;
  }
  return false;
}

function buildGuestSignals(guest, prefsRows) {
  const signals = new Set();

  // Rule 1: food-prefs only. Other category rows intentionally excluded
  // (see module doc comment). Both key and value tokenised so a generic
  // Wine row surfaces Wine-named items even if the value is a brand.
  for (const r of prefsRows || []) {
    if (r?.category !== FOOD_PREF_CATEGORY) continue;
    for (const t of tokeniseForPref(r?.key))   signals.add(t);
    for (const t of tokeniseForPref(r?.value)) signals.add(t);
  }

  // Rule 2 + 3: medical cross-reference. Scan the guest's allergies +
  // health_conditions text for known triggers, add only the response
  // item tokens. The raw trigger word (e.g. "peanut") is deliberately
  // NOT added — allergen substrings shouldn't cause the allergen
  // itself to surface under the affected guest.
  const medText = `${guest?.allergies ?? ''} ${guest?.health_conditions ?? ''}`;
  if (medText.trim()) {
    for (const { match, items } of MEDICAL_CROSS_REF) {
      if (match.test(medText)) {
        for (const name of items) signals.add(name.toLowerCase());
      }
    }
  }

  return signals;
}

export function useGuestConsumables({ guests, items }) {
  const { user } = useAuth();
  const [prefsByGuest, setPrefsByGuest] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const activeGuestIds = useMemo(
    () => (guests ?? []).map(g => g.id).filter(Boolean).sort().join(','),
    [guests]
  );

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

  const byGuest = useMemo(() => {
    const out = {};
    for (const guest of guests ?? []) out[guest.id] = [];
    if (!items?.length || !guests?.length) return out;

    const signalsByGuest = new Map();
    for (const guest of guests) {
      signalsByGuest.set(guest.id, buildGuestSignals(guest, prefsByGuest[guest.id]));
    }

    for (const item of items) {
      for (const guest of guests) {
        const signals = signalsByGuest.get(guest.id);
        if (itemMatchesSignal(item.name, signals)) {
          out[guest.id].push(item);
        }
      }
    }

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
