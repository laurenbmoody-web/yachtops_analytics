// Guest-relevance filter for the /inventory/weekly page body.
//
// Per-guest item list. An item surfaces under a specific guest ONLY if
// one of two narrow rules fires:
//
//   RULE 1 — Food & beverage match.
//   Token overlap between the guest's FOOD & BEVERAGE preference rows
//   (Coffee, Tea, Wine, Favourite Cuisines, Favourite Meals etc) and
//   the item name. Word-boundary only — "cap" won't match "capsicum".
//   Non-food preference categories are excluded (lifestyle attributes,
//   not inventory).
//
//   RULE 2 — Emergency medical response.
//   If the guest has an anaphylaxis trigger, asthma, or diabetes in
//   allergies / health_conditions, a condition-specific matcher picks
//   out ONLY the stew-administrable emergency items. Not the broader
//   medical kit that supports them.
//
//     anaphylaxis triggers → auto-injector (age-matched) + antihistamines
//     asthma               → inhaler  (NOT spacer / peak-flow meter)
//     diabetes             → glucose monitor + insulin pen (NOT lancets,
//                            test strips, alcohol wipes)
//
//   Pre-injection swabs, adrenaline ampoules / vials, magnifying glasses,
//   dental gels, splints, generic first-aid kit contents — none of
//   these surface. They live on the canonical /inventory page. The
//   principle: rows under a guest are "what the stew grabs in an
//   emergency response", not the full medical kit.
//
// Results are deduplicated by (lowercased) item name. If the catalogue
// has multiple SKUs of the same named item, qty/par/reorder sum and
// critical is recomputed from the merged totals.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

const FOOD_PREF_CATEGORY = 'Food & Beverage';

// Stopwords for food-pref tokenisation. Wizard enum fillers that would
// otherwise match unrelated items.
const PREF_STOPWORDS = new Set([
  'the','and','for','with','but','etc','some','that','this',
  'are','was','has','have','had','not','any','all','one','two',
  'from','into','per','about','over','under','each',
  'regular','none','mild','medium','hot','cold','low','moderate','high',
  'small','large','generous','once','twice','slow','quick','fast',
  'daily','weekly','occasional',
  'morning','evening','night','afternoon','breakfast','lunch','dinner',
  'avoid','tolerance','frequency','preference','preferences',
  'prefers','preferred','favourite','favorite','style','type',
]);

// ────────────────────────────────────────────────────────────────────────────
// Food-preference matching (Rule 1)
// ────────────────────────────────────────────────────────────────────────────

function tokeniseForPref(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !PREF_STOPWORDS.has(w));
}

function buildFoodSignals(prefsRows) {
  const signals = new Set();
  for (const r of prefsRows || []) {
    if (r?.category !== FOOD_PREF_CATEGORY) continue;
    for (const t of tokeniseForPref(r?.key))   signals.add(t);
    for (const t of tokeniseForPref(r?.value)) signals.add(t);
  }
  return signals;
}

function itemMatchesAnySignal(itemName, signals) {
  if (!itemName || !signals || signals.size === 0) return false;
  const haystack = String(itemName).toLowerCase();
  for (const sig of signals) {
    if (!sig) continue;
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Medical-response matching (Rule 2) — targeted per-condition matchers.
// Each matcher asks the narrow question: "is this item the emergency
// response article for this condition, in a form the stew administers?"
// ────────────────────────────────────────────────────────────────────────────

// Ampoule / vial / 1mg-1ml forms are medic-only — exclude.
function isVialOrAmpouleForm(lc) {
  return /\b(vial|ampoule|amp\b|1\s*mg\s*\/\s*1\s*ml|1mg\/1ml)\b/.test(lc);
}

// Paediatric markers on auto-injectors: 0.15mg, junior, paediatric, kid/child.
function isPaediatricMarker(lc) {
  return /\b(paed|pediatric|junior|kid|child|0\.15\s*mg|0\.15mg)\b/.test(lc);
}

function isAutoInjector(name, paediatricGuest) {
  if (!name) return false;
  const lc = String(name).toLowerCase();
  // Must be the auto-injector form. Brand names (Jext, EpiPen) or the
  // explicit "adrenaline pen" / "auto-injector" form.
  const isInjector = /\b(auto[-\s]?injector|jext|epipen|adrenaline\s+pen)\b/.test(lc);
  if (!isInjector) return false;
  // Exclude medic-only forms.
  if (isVialOrAmpouleForm(lc)) return false;
  const paed = isPaediatricMarker(lc);
  // Age match: paediatric guest gets paediatric only; adult / unknown age
  // gets adult default (exclude paediatric products).
  return paediatricGuest ? paed : !paed;
}

function isAntihistamine(name) {
  if (!name) return false;
  return /\b(antihistamine|piriton|clarityn|zyrtec|benadryl|loratadine|cetirizine|chlorphenamine|diphenhydramine|fexofenadine)\b/i.test(name);
}

function isInhaler(name) {
  if (!name) return false;
  const lc = String(name).toLowerCase();
  const isBronch = /\b(inhaler|salbutamol|ventolin|bronchodilator|puffer)\b/.test(lc);
  if (!isBronch) return false;
  // Accessories that aren't the rescue item itself.
  if (/\b(spacer|chamber|peak[-\s]?flow|flow\s*meter|cleaner|case)\b/.test(lc)) return false;
  return true;
}

function isGlucoseMonitor(name) {
  if (!name) return false;
  return /\b(glucose\s*(monitor|meter)|glucometer|blood\s*glucose\s*(monitor|meter))\b/i.test(name);
}

function isInsulinPen(name) {
  if (!name) return false;
  const lc = String(name).toLowerCase();
  if (!/\binsulin\b/.test(lc)) return false;
  // Pen / auto-pen / flex-pen / injector — NOT lancet / needle / strip / wipe.
  return /\b(pen|injector|flexpen|quickpen)\b/.test(lc);
}

// Condition triggers. Each returns true when the guest has that
// condition in their allergies or health_conditions text.
function hasAnaphylaxisTrigger(medText) {
  return /\b(peanut|tree\s*nut|nuts?|shellfish|seafood|egg|dairy|bee|wasp|sting|sesame|anaphylax)\w*/i.test(medText);
}
function hasAsthma(medText) {
  return /\b(asthma|wheeze|bronch)\w*/i.test(medText);
}
function hasDiabetes(medText) {
  return /\b(diabet|hypoglyc)\w*/i.test(medText);
}

function medicalItemsForGuest(guest, allItems) {
  const medText = `${guest?.allergies ?? ''} ${guest?.health_conditions ?? ''}`;
  if (!medText.trim()) return [];

  const age = computeAgeYears(guest?.date_of_birth);
  const paed = age != null && age < 12;

  const matchers = [];
  if (hasAnaphylaxisTrigger(medText)) {
    matchers.push((it) => isAutoInjector(it.name, paed));
    matchers.push((it) => isAntihistamine(it.name));
  }
  if (hasAsthma(medText))   matchers.push((it) => isInhaler(it.name));
  if (hasDiabetes(medText)) {
    matchers.push((it) => isGlucoseMonitor(it.name));
    matchers.push((it) => isInsulinPen(it.name));
  }

  if (matchers.length === 0) return [];

  const picked = new Set();
  const out = [];
  for (const it of allItems || []) {
    if (picked.has(it.id)) continue;
    if (matchers.some(m => m(it))) {
      picked.add(it.id);
      out.push(it);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Age parser — guests.date_of_birth is TEXT with inconsistent formats in
// the wild. Parse defensively; fall through to null → adult default.
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Dedup by name — collapse multiple SKUs. qty sums; par/reorder take the
// sum too (multiple SKU thresholds add up to a combined minimum); unit
// keeps the first non-sentinel; critical is re-derived from the merged
// totals.
// ────────────────────────────────────────────────────────────────────────────

function dedupeByName(items) {
  const byKey = new Map();
  for (const it of items) {
    const key = String(it?.name ?? '').toLowerCase().trim();
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, { ...it });
      continue;
    }
    const merged = byKey.get(key);
    merged.total_qty     = (merged.total_qty     ?? 0) + (it.total_qty     ?? 0);
    merged.par_level     = (merged.par_level     ?? 0) + (it.par_level     ?? 0) || null;
    merged.reorder_point = (merged.reorder_point ?? 0) + (it.reorder_point ?? 0) || null;
    if (!merged.unit && it.unit) merged.unit = it.unit;
  }
  const out = [];
  for (const item of byKey.values()) {
    const threshold = item.reorder_point ?? (item.par_level ? item.par_level / 2 : 2);
    item.critical = (item.total_qty ?? 0) <= threshold;
    out.push(item);
  }
  return out;
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
    for (const guest of guests ?? []) out[guest.id] = [];
    if (!items?.length || !guests?.length) return out;

    for (const guest of guests) {
      const foodSignals = buildFoodSignals(prefsByGuest[guest.id]);
      const foodMatches = items.filter(it => itemMatchesAnySignal(it.name, foodSignals));
      const medMatches  = medicalItemsForGuest(guest, items);

      // Merge, dedup by name, sort critical-first then qty ascending.
      const merged = dedupeByName([...foodMatches, ...medMatches]);
      merged.sort((a, b) => {
        if (a.critical && !b.critical) return -1;
        if (!a.critical && b.critical) return 1;
        return (a.total_qty ?? 0) - (b.total_qty ?? 0);
      });
      out[guest.id] = merged;
    }

    return out;
  }, [guests, items, prefsByGuest]);

  return { byGuest, loading, error };
}
