// Data layer for the drawer's At a glance restructure.
//
// Replaces the prose guests.preferences_summary read with a typed,
// category-bucketed view sourced directly from guest_preferences. Wraps
// bucketing + a small amount of row-specific shaping so the drawer component
// can render the 6-row layout without any knowledge of the preference
// taxonomy.
//
// The bucket config below is declarative (lowercased key lists per row) so a
// new manual pref added via the Edit modal — e.g. { key: 'Matcha',
// category: 'Food & Beverage' } — just needs a one-line entry in
// ROW_BUCKETS.hot_drinks.keys to surface in the drawer. No code change to
// this hook, no new imports elsewhere.
//
// FOOD · AVOID, DAILY ROUTINE, and GUEST NOTES don't fit the simple
// (category, key) shape — they each have their own narrow filter below.
//
// TODO(phase-4): add a Supabase realtime subscription on
// guest_preferences changes for this guestId so edits made on other pages
// propagate live. Today the hook refetches on mount only.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

// ────────────────────────────────────────────────────────────────────────────
// Row bucket config — case-insensitive key match within a set of categories.
// Add a key here to surface a manually-created pref row in the drawer.
// ────────────────────────────────────────────────────────────────────────────
const ROW_BUCKETS = {
  hot_drinks: {
    categories: ['Food & Beverage'],
    keys: ['coffee', 'tea'],
  },
  drinks: {
    categories: ['Food & Beverage', 'Wine/Spirits'],
    keys: ['wine', 'cocktail', 'spirits', 'beer', 'evening drink', 'aperitif'],
  },
  ambience: {
    categories: ['Cabin'],
    keys: ['music', 'music volume', 'ambience', 'favourite spaces'],
  },
};

function findBucketFor(pref) {
  const key = (pref?.key ?? '').toLowerCase().trim();
  if (!key) return null;
  for (const [bucket, config] of Object.entries(ROW_BUCKETS)) {
    if (!config.categories.includes(pref.category)) continue;
    if (config.keys.includes(key)) return bucket;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Row-specific shaping helpers
// ────────────────────────────────────────────────────────────────────────────

// FOOD · AVOID — pref_type='avoid' rows within Food & Beverage, plus any
// Dietary-category row (category exists but wizard doesn't populate it;
// reserved for manual dietary restrictions).
function isFoodAvoidRow(pref) {
  if (pref?.category === 'Dietary') return true;
  if (pref?.category === 'Food & Beverage' && pref?.pref_type === 'avoid') return true;
  return false;
}

// DAILY ROUTINE — only ROUTINE-category rows whose value parses as HH:MM.
// Free-text keys like 'Morning Routine' / 'Late Night Behaviour' / 'Nap
// Habits' are excluded. Gym Time, if added manually, will pick up here too.
const HHMM = /^\s*(\d{1,2}):(\d{2})\s*$/;

function parseRoutineAnchor(pref) {
  if (pref?.category !== 'Routine') return null;
  const val = (pref?.value ?? '').trim();
  const m = val.match(HHMM);
  if (!m) return null;
  const hh = String(Math.min(23, Math.max(0, parseInt(m[1], 10)))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, parseInt(m[2], 10)))).padStart(2, '0');
  return {
    time:  `${hh}:${mm}`,
    label: pref.key,          // stable label for matching to moments (e.g. 'Breakfast Time')
    short: shortRoutineLabel(pref.key), // display label for timeline (e.g. 'BREAKFAST')
    sortKey: parseInt(hh, 10) * 60 + parseInt(mm, 10),
  };
}

function shortRoutineLabel(key) {
  if (!key) return '';
  // Canonical wizard keys → concise all-caps display labels.
  const k = key.toLowerCase();
  if (k === 'wake up time')    return 'WAKE';
  if (k === 'breakfast time')  return 'BREAKFAST';
  if (k === 'lunch time')      return 'LUNCH';
  if (k === 'dinner time')     return 'DINNER';
  if (k === 'bed time')        return 'BED';
  if (k.includes('gym'))       return 'GYM';
  if (k.includes('nap'))       return 'NAP';
  // Fallback: strip a trailing "Time" and uppercase.
  return key.replace(/\s+time\s*$/i, '').toUpperCase();
}

// GUEST NOTES — merges four targeted reads into one capped string array.
// Top Things to Remember is stored as a pipe-joined string; split here so
// the component can render individual bullets. If the storage shape changes
// later (e.g. to a real array or to separate rows), only this function
// needs updating — the UI contract stays guest_notes.top_things: string[].
function buildGuestNotes(allPrefs) {
  const byKey = {
    top_things:        allPrefs.filter(p => p.category === 'Other'   && p.key === 'Top Things to Remember'),
    communication:     allPrefs.filter(p => p.category === 'Service' && p.key === 'Communication Style'),
    familiarity:       allPrefs.filter(p => p.category === 'Service' && p.key === 'Crew Familiarity'),
    priority_flagged:  allPrefs.filter(p => p.priority === 'high'),
  };

  const topThings = (byKey.top_things[0]?.value ?? '')
    .split(' | ')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    top_things:      topThings,
    communication:   byKey.communication[0]?.value ?? null,
    familiarity:     byKey.familiarity[0]?.value ?? null,
    priority_notes:  byKey.priority_flagged
      .filter(p => p.key !== 'Top Things to Remember'
                && p.key !== 'Communication Style'
                && p.key !== 'Crew Familiarity')
      .map(p => p.value)
      .filter(Boolean),
  };
}

// HOT DRINKS / DRINKS / AMBIENCE — bucketed values. Each preserves
// key->value so the component can choose to show keys or just values.
function collectBucketValues(bucketedRows) {
  return bucketedRows.map(p => ({
    key:   p.key ?? '',
    value: (p.value ?? '').trim(),
  })).filter(r => r.value);
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

export function useGuestDrawerPrefs(guestId) {
  const { user } = useAuth();
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });

  const fetch = useCallback(async () => {
    if (!user || !guestId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState(s => ({ ...s, loading: true, error: null }));

    try {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();
      if (!member) throw new Error('No active tenant membership');

      // One fetch pulls everything we need. Cheaper than six targeted reads
      // and lets us bucket client-side consistently.
      const [prefsRes, guestRes] = await Promise.all([
        supabase
          .from('guest_preferences')
          .select('id, category, key, value, pref_type, priority, tags, source, created_at')
          .eq('tenant_id', member.tenant_id)
          .eq('guest_id', guestId),
        supabase
          .from('guests')
          .select('allergies, health_conditions')
          .eq('id', guestId)
          .single(),
      ]);

      if (prefsRes.error) throw prefsRes.error;
      if (guestRes.error) throw guestRes.error;

      // Filter out any legacy auto-synced aggregate rows defensively —
      // matches the guard in preferencesSync so a stray row can't poison
      // the drawer either. (Cleanup migration 20260421130000 removed these
      // from existing data; this is belt-and-braces.)
      const prefs = (prefsRes.data ?? []).filter(p => {
        if (p.source === 'guest_profile') return false;
        const tags = Array.isArray(p.tags) ? p.tags : [];
        return !(tags.includes('auto-synced') || tags.includes('auto_synced'));
      });

      // Bucket the (category, key)-driven rows
      const buckets = { hot_drinks: [], drinks: [], ambience: [] };
      const foodAvoidRows = [];
      const routineAnchors = [];

      for (const p of prefs) {
        if (isFoodAvoidRow(p)) { foodAvoidRows.push(p); continue; }
        const anchor = parseRoutineAnchor(p);
        if (anchor) { routineAnchors.push(anchor); continue; }
        const bucket = findBucketFor(p);
        if (bucket) buckets[bucket].push(p);
      }

      // Sort routine anchors by time for the mini-timeline
      routineAnchors.sort((a, b) => a.sortKey - b.sortKey);

      const splitPills = (txt) => (txt ?? '').split(',').map(s => s.trim()).filter(Boolean);

      const data = {
        allergies:          splitPills(guestRes.data?.allergies),
        health_conditions:  splitPills(guestRes.data?.health_conditions),
        hot_drinks:         collectBucketValues(buckets.hot_drinks),
        drinks:             collectBucketValues(buckets.drinks),
        food_avoid:         foodAvoidRows.map(p => ({
          key:   p.key ?? '',
          value: (p.value ?? '').trim(),
          category: p.category,
        })).filter(r => r.value),
        routine:            routineAnchors,
        guest_notes:        buildGuestNotes(prefs),
        ambience:           collectBucketValues(buckets.ambience),
      };

      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: e.message });
    }
  }, [user, guestId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { ...state, refetch: fetch };
}
