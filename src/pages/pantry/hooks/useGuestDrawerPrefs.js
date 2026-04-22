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
// Every value returned from this hook runs through cleanseValue() so the
// drawer never renders raw wizard storage strings (snake_case enums,
// pipe-joined key:value pairs, "Avoid foo" instructional prefixes). Adding
// new rules here means every bucket benefits automatically.
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
    keys: ['coffee', 'tea', 'matcha', 'hot chocolate', 'chai'],
  },
  drinks: {
    categories: ['Food & Beverage', 'Wine/Spirits'],
    keys: ['wine', 'cocktail', 'spirits', 'beer', 'evening drink', 'aperitif'],
  },
  ambience: {
    categories: ['Cabin'],
    // Cabin temperature intentionally NOT bucketed here — it's a cabin-setup
    // concern rather than an ambience one, and renders as a bare unitless
    // number ("20") that reads as noise without context. Still visible on
    // the full preferences page.
    keys: [
      'music', 'music volume', 'ambience', 'favourite spaces',
      'lighting', 'scent',
    ],
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
// Display-value cleansing
// ────────────────────────────────────────────────────────────────────────────
// The wizard writes verbose machine-shaped values — pipe-joined key:value
// pairs ("Milk: Regular | Frequency: once_per_day"), snake_case enums
// ("very_conversational"), and instructional prefixes ("Avoid spicy food
// (tolerance: mild)"). cleanseValue() turns each into something a stew can
// read at a glance. Rules:
//
//   1. If the value is a pipe-joined K:V list, drop the keys and join the
//      cleansed values with commas.
//   2. Snake_case and kebab-case tokens → spaces.
//   3. Strip leading instructional verbs (Avoid / Don't / Under / etc.).
//   4. Re-shape inline parentheticals of the form (label: value) →
//      (value label) so "(tolerance: mild)" reads as "(mild tolerance)".
//   5. Sentence-case the first letter.

const INSTRUCTION_PREFIX = /^(avoid|do not|don't|dislikes?|dislike|under|no )\s+/i;

function snakeToSpace(str) {
  return String(str ?? '').replace(/[_-]+/g, ' ');
}

function sentenceCase(str) {
  const s = String(str ?? '');
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function reshapeParenthetical(str) {
  // (tolerance: mild) → (mild tolerance); (severity: severe) → (severe severity)
  return String(str ?? '').replace(/\(\s*([a-z][a-z\s]*?)\s*:\s*([a-z0-9_\-\s]+?)\s*\)/gi,
    (_, label, val) => `(${snakeToSpace(val).trim().toLowerCase()} ${label.trim().toLowerCase()})`);
}

function parsePipeJoined(value) {
  const s = String(value ?? '').trim();
  if (!s.includes(' | ')) return null;
  const parts = s.split(' | ').map(p => p.trim()).filter(Boolean);
  if (!parts.every(p => p.includes(':'))) return null;
  const vals = parts
    .map(p => p.slice(p.indexOf(':') + 1).trim())
    .map(v => snakeToSpace(v).trim())
    .filter(Boolean);
  return vals.length > 0 ? vals.join(', ') : null;
}

function cleanseValue(value) {
  if (value == null) return '';
  const piped = parsePipeJoined(value);
  let v = piped != null ? piped : snakeToSpace(String(value));
  v = reshapeParenthetical(v);
  v = v.replace(INSTRUCTION_PREFIX, '');
  return sentenceCase(v.trim());
}

// FOOD · AVOID rows: prefer the row's KEY when it's a concrete noun
// (Coriander, Gluten, Nuts) — the value there tends to be an intensity
// modifier ("Under any circumstance"). When the key is a generic bucket
// ('Spice', 'Dietary', 'Food'), show the cleansed value instead; that's
// where the substance lives for wizard-produced avoid rows.
const GENERIC_AVOID_KEYS = new Set(['spice', 'dietary', 'food', 'avoid', 'other']);

function formatAvoidSubject({ key, value }) {
  const k = String(key ?? '').trim();
  const cleansedValue = cleanseValue(value);
  const keyIsGeneric = !k || GENERIC_AVOID_KEYS.has(k.toLowerCase());

  if (!keyIsGeneric) {
    // Specific concrete subject lives in the key. If the cleansed value
    // carries a parenthetical modifier (e.g. "(severe)"), keep it on.
    const paren = cleansedValue.match(/\(([^)]+)\)/);
    return paren ? `${k} ${paren[0]}` : k;
  }
  return cleansedValue;
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
//
// Ordering in parseRoutineAnchor matters: the HHMM regex is the gate. If
// a row's value doesn't parse as a clock time we return null BEFORE
// shortRoutineLabel is ever called, so free-text keys never reach the
// display-label function. Keep the `if (!m) return null;` above the label
// resolution below.
const HHMM = /^\s*(\d{1,2}):(\d{2})\s*$/;

// Wizard stores Bed Time as a casual 12h value ("11:00" meaning 11pm). When
// the parsed hour is in the 0-14 range for a bed-like anchor, coerce to the
// evening by adding 12h so timeline ordering stays right.
//
// TODO(backlog): fix at storage — wizard should normalise all routine times
// to 24h format on write. Once the migration runs, delete this coercion.
const EVENING_ANCHOR_KEYS = new Set(['bed time', 'turndown time']);

function coerceEveningHour(key, hh) {
  const k = String(key ?? '').toLowerCase().trim();
  if (EVENING_ANCHOR_KEYS.has(k) && hh < 14) return hh + 12;
  return hh;
}

function parseRoutineAnchor(pref) {
  if (pref?.category !== 'Routine') return null;
  const val = (pref?.value ?? '').trim();
  const m = val.match(HHMM);
  if (!m) return null;                    // gate: non-time rows bail here
  let hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  hh = coerceEveningHour(pref.key, hh);
  const hhStr = String(hh).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  return {
    time:  `${hhStr}:${mmStr}`,
    label: pref.key,                      // stable label for matching to moments (e.g. 'Breakfast Time')
    short: shortRoutineLabel(pref.key),   // only called after HHMM match
    sortKey: hh * 60 + mm,
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
//
// priority_flagged intentionally excludes any pref already captured by
// another bucket (claimedIds set built upstream). Otherwise a Coriander
// row (Food & Beverage, pref_type='avoid', priority='high') would appear
// in both FOOD · AVOID and GUEST NOTES — which is exactly the bug the
// screenshot caught. Also excludes pref_type='avoid' globally so an avoid
// row never reads as a "note".
function buildGuestNotes(allPrefs, claimedIds) {
  const topThingsRow = allPrefs.find(p => p.category === 'Other'   && p.key === 'Top Things to Remember');
  const communicationRow = allPrefs.find(p => p.category === 'Service' && p.key === 'Communication Style');
  const familiarityRow   = allPrefs.find(p => p.category === 'Service' && p.key === 'Crew Familiarity');

  const topThings = (topThingsRow?.value ?? '')
    .split(' | ')
    .map(s => cleanseValue(s))
    .filter(Boolean)
    .slice(0, 3);

  const priorityNotes = allPrefs
    .filter(p =>
      p.priority === 'high' &&
      p.pref_type !== 'avoid' &&
      !claimedIds.has(p.id) &&
      p.key !== 'Top Things to Remember' &&
      p.key !== 'Communication Style'   &&
      p.key !== 'Crew Familiarity'
    )
    .map(p => cleanseValue(p.value))
    .filter(Boolean);

  return {
    top_things:      topThings,
    communication:   cleanseValue(communicationRow?.value) || null,
    familiarity:     cleanseValue(familiarityRow?.value)   || null,
    priority_notes:  priorityNotes,
  };
}

// HOT DRINKS / DRINKS / AMBIENCE — bucketed values. Every value runs through
// cleanseValue so pipe-joined and snake_case storage shapes become readable.
// A single wizard row sometimes stores a list (e.g. Favourite Spaces is
// stored as "beach_club, main_salon") — we split those on comma so the
// DrawerRow can surface each entry as its own " · "-separated fragment.
// Side-effect: a Coffee value like "Milk: Regular | Frequency: once per day"
// is first pipe-parsed into "Regular, once per day" and then split into
// ["Regular", "Once per day"]. That loses attribute grouping for the coffee
// case, but keeps the list-y cases right. Acceptable trade-off for v1.
function collectBucketValues(bucketedRows) {
  const out = [];
  for (const p of bucketedRows) {
    const cleansed = cleanseValue(p.value);
    if (!cleansed) continue;
    const parts = cleansed
      .split(/,\s*/)
      .map(s => sentenceCase(s.trim()))
      .filter(Boolean);
    for (const part of parts) out.push({ key: p.key ?? '', value: part });
  }
  return out;
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

      // Guard against phantom auto-synced rows — see Section 3 cleanup
      // (migration 20260421130000). The legacy forward-sync effect used to
      // write an aggregate pref row with source='guest_profile' + tag
      // 'auto-synced', which fed back into its own column recomputation and
      // compounded values on every mutation. The effect is gone, the data is
      // cleaned, but this filter stays as defence against any surviving
      // or re-introduced row polluting the drawer. Do not remove without
      // re-reading the Section 3 commit history.
      const prefs = (prefsRes.data ?? []).filter(p => {
        if (p.source === 'guest_profile') return false;
        const tags = Array.isArray(p.tags) ? p.tags : [];
        return !(tags.includes('auto-synced') || tags.includes('auto_synced'));
      });

      // Bucket the (category, key)-driven rows. Track claimedIds so
      // buildGuestNotes can exclude rows already surfaced elsewhere.
      const buckets = { hot_drinks: [], drinks: [], ambience: [] };
      const foodAvoidRows = [];
      const routineAnchors = [];
      const claimedIds = new Set();

      for (const p of prefs) {
        if (isFoodAvoidRow(p)) { foodAvoidRows.push(p); claimedIds.add(p.id); continue; }
        const anchor = parseRoutineAnchor(p);
        if (anchor) { routineAnchors.push(anchor); claimedIds.add(p.id); continue; }
        const bucket = findBucketFor(p);
        if (bucket) { buckets[bucket].push(p); claimedIds.add(p.id); continue; }
      }

      // Sort routine anchors by (coerced) time for the mini-timeline
      routineAnchors.sort((a, b) => a.sortKey - b.sortKey);

      const splitPills = (txt) => (txt ?? '').split(',').map(s => s.trim()).filter(Boolean);

      const data = {
        allergies:          splitPills(guestRes.data?.allergies),
        health_conditions:  splitPills(guestRes.data?.health_conditions),
        hot_drinks:         collectBucketValues(buckets.hot_drinks),
        drinks:             collectBucketValues(buckets.drinks),
        food_avoid:         foodAvoidRows
          .map(p => ({ key: p.key ?? '', value: formatAvoidSubject({ key: p.key, value: p.value }), category: p.category }))
          .filter(r => r.value),
        routine:            routineAnchors,
        guest_notes:        buildGuestNotes(prefs, claimedIds),
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
