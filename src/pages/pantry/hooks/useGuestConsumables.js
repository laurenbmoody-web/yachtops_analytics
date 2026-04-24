// Guest-relevance filter for the /inventory/weekly page body.
//
// This page is a "things tied to THIS guest" view. Not a food page. Not a
// medical page. Scope spans everything a guest might have logged — coffee,
// wine, toiletries, bedding, candles, spa oils, gym gear, cigars, smoking
// accessories, children's snacks, pet food. Any category. If it's in the
// guest's guest_preferences rows, it shows.
//
// Plus ONE emergency device per triggering condition.
//
// Allowlist rule — an item appears under a guest IF AND ONLY IF:
//
//   1. The item's name token-overlaps with any of that guest's
//      guest_preferences rows (key or value), across ALL categories
//      (Food & Beverage, Cabin, Service, Routine, Activities, Other…).
//      Word-boundary only — "cap" won't match "capsicum".
//
//   2. The item is the SINGLE emergency-response device mapped to one
//      of that guest's allergies or health_conditions. Strict 1-device-
//      per-condition cap. No antihistamines. No ancillary kit (swabs,
//      ampoules, syringes, lancets, test strips, spacers, peak-flow
//      meters, cleaning supplies). Those live on the full inventory
//      page.
//
// Condition → device map (per spec, stew-administrable device only):
//
//   peanut / tree nut / nut / shellfish / anaphylaxis → adrenaline
//     auto-injector.  Age-matched: 0.3mg adult when age >=12 or
//     unknown, 0.15mg paediatric only when age <12.
//   asthma                 → inhaler
//   diabetes               → glucose (monitor or glucagon)
//   angina / cardiac       → GTN (glyceryl trinitrate)
//
// Results returned as { preferences, emergency } per guest. Page renders
// a subsection header for each.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

// Grammar fillers + generic preference metadata that add no signal.
// Intentionally short — over-filtering loses legitimate matches on
// brand names and item categories.
const STOPWORDS = new Set([
  'the','and','for','with','but','etc','some','that','this',
  'are','was','has','have','had','not','any','all','one','two',
  'from','into','per','about','over','under','each',
  'preferred','favourite','favorite','preference','preferences',
  'prefers','avoid','tolerance','frequency',
]);

// ────────────────────────────────────────────────────────────────────────────
// Preference-based matching (Rule 1) — all categories contribute.
// ────────────────────────────────────────────────────────────────────────────

function tokenise(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

function buildPrefSignals(prefsRows) {
  const signals = new Set();
  for (const r of prefsRows || []) {
    for (const t of tokenise(r?.key))   signals.add(t);
    for (const t of tokenise(r?.value)) signals.add(t);
  }
  return signals;
}

function itemMatchesAnySignal(itemName, signals) {
  if (!itemName || !signals || signals.size === 0) return false;
  const haystack = stripSentinels(String(itemName)).toLowerCase();
  for (const sig of signals) {
    if (!sig) continue;
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Emergency device matchers (Rule 2) — ONE device per condition.
// Each matcher answers the narrow question: "is this THE single
// stew-administrable response device for this condition?"
// ────────────────────────────────────────────────────────────────────────────

function isAdrenalineAutoInjector(name, paediatricGuest) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  // Auto-injector form only — vial/ampoule/syringe forms are medic-only.
  const isInjector = /\b(auto[-\s]?injector|jext|epipen|adrenaline\s+pen)\b/.test(lc);
  if (!isInjector) return false;
  if (/\b(vial|ampoule|amp)\b/.test(lc)) return false;
  if (/\b(needle|syringe)\b/.test(lc)) return false;
  const paedMarker = /\b(paed|pediatric|junior|kid|child|0\.15\s*mg|0\.15mg)\b/.test(lc);
  return paediatricGuest ? paedMarker : !paedMarker;
}

function isInhaler(name) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  if (!/\b(inhaler|salbutamol|ventolin|bronchodilator|puffer)\b/.test(lc)) return false;
  // Accessories that aren't the rescue item itself.
  if (/\b(spacer|chamber|peak[-\s]?flow|flow\s*meter|cleaner|case)\b/.test(lc)) return false;
  return true;
}

function isGlucoseDevice(name) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  return /\b(glucose\s*(monitor|meter)|glucometer|glucagon)\b/.test(lc);
}

function isGTN(name) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  return /\b(gtn|glyceryl\s+trinitrate|nitroglycerin|nitrolingual|nitro\s*spray)\b/.test(lc);
}

// Condition triggers — each pattern tested against the combined
// allergies + health_conditions text.
const EMERGENCY_MATCHERS = [
  {
    id:    'anaphylaxis',
    match: /\b(peanut|tree\s*nut|nuts?|shellfish|anaphylax)\w*/i,
    pick:  (items, { paediatric }) => items.find(it => isAdrenalineAutoInjector(it.name, paediatric)),
  },
  {
    id:    'asthma',
    match: /\basthma\w*/i,
    pick:  (items) => items.find(it => isInhaler(it.name)),
  },
  {
    id:    'diabetes',
    match: /\bdiabet\w*/i,
    pick:  (items) => items.find(it => isGlucoseDevice(it.name)),
  },
  {
    id:    'cardiac',
    match: /\b(angina|cardiac)\w*/i,
    pick:  (items) => items.find(it => isGTN(it.name)),
  },
];

function emergencyDevicesForGuest(guest, items) {
  const medText = `${guest?.allergies ?? ''} ${guest?.health_conditions ?? ''}`;
  if (!medText.trim()) return [];

  const age = computeAgeYears(guest?.date_of_birth);
  const paediatric = age != null && age < 12;

  const devices = [];
  const seen = new Set();

  for (const rule of EMERGENCY_MATCHERS) {
    if (seen.has(rule.id)) continue;
    if (!rule.match.test(medText)) continue;
    const picked = rule.pick(items || [], { paediatric });
    if (picked) {
      devices.push(picked);
      seen.add(rule.id);
    }
  }

  return devices;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// :SELECTED: / :UNSELECTED: / :ANY: sentinels leak from variant rows
// where the picker hasn't settled. Strip from any field we display or
// match against.
export function stripSentinels(str) {
  if (str == null) return str;
  return String(str).replace(/:[A-Z_]+:/g, '').replace(/\s{2,}/g, ' ').trim();
}

function computeAgeYears(dobStr) {
  if (!dobStr) return null;
  const d = new Date(String(dobStr));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

// Dedup multiple SKUs of the same named item. qty sums; par/reorder sum
// (combined threshold); unit keeps the first non-empty; critical
// re-derived from merged totals.
function dedupeByName(items) {
  const byKey = new Map();
  for (const it of items) {
    const key = stripSentinels(String(it?.name ?? '')).toLowerCase().trim();
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...it,
        name: stripSentinels(it.name),
        unit: stripSentinels(it.unit),
      });
      continue;
    }
    const merged = byKey.get(key);
    merged.total_qty     = (merged.total_qty     ?? 0) + (it.total_qty     ?? 0);
    merged.par_level     = ((merged.par_level     ?? 0) + (it.par_level     ?? 0)) || null;
    merged.reorder_point = ((merged.reorder_point ?? 0) + (it.reorder_point ?? 0)) || null;
    if (!merged.unit && it.unit) merged.unit = stripSentinels(it.unit);
  }
  const out = [];
  for (const item of byKey.values()) {
    const threshold = item.reorder_point ?? (item.par_level ? item.par_level / 2 : 2);
    item.critical = (item.total_qty ?? 0) <= threshold;
    out.push(item);
  }
  return out;
}

function sortCriticalFirst(a, b) {
  if (a.critical && !b.critical) return -1;
  if (!a.critical && b.critical) return 1;
  return (a.total_qty ?? 0) - (b.total_qty ?? 0);
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

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
    for (const guest of guests ?? []) out[guest.id] = { preferences: [], emergency: [] };
    if (!items?.length || !guests?.length) return out;

    for (const guest of guests) {
      const signals = buildPrefSignals(prefsByGuest[guest.id]);
      const prefMatches = items.filter(it => itemMatchesAnySignal(it.name, signals));
      const preferences = dedupeByName(prefMatches).sort(sortCriticalFirst);

      // Emergency devices aren't deduped — one device per condition is
      // already enforced upstream. Still sanitise name/unit.
      const emergency = emergencyDevicesForGuest(guest, items).map(it => ({
        ...it,
        name: stripSentinels(it.name),
        unit: stripSentinels(it.unit),
      }));

      out[guest.id] = { preferences, emergency };
    }

    return out;
  }, [guests, items, prefsByGuest]);

  return { byGuest, loading, error };
}
