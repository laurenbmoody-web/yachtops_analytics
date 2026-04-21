// Back-syncs structured columns on the guests table from guest_preferences
// rows, for every category — not just allergies.
//
// The preferences page has been a write-only island: rows land in
// guest_preferences, but downstream widgets (standby AllergiesWidget reads
// guests.allergies; drawer's At-a-glance reads guests.preferences_summary;
// history page reads guests.history_log) all read structured guests.*
// columns that no mutation updates. This module closes that loop.
//
// Category → structured column mapping:
//
//   'Allergies', key !== 'Health Conditions'   -> guests.allergies
//   'Allergies', key === 'Health Conditions'   -> guests.health_conditions
//   everything else                            -> guests.preferences_summary
//
// The sync runs on every create/update/delete in preferencesStorage. It
// recomputes the target column(s) from the full current set of rows in the
// affected category for that guest, so adds / edits / deletes all converge
// to the correct aggregate without per-operation diffing.
//
// Each non-empty sync writes a typed entry to guests.history_log via the
// shared appendGuestHistory helper. Action names keep the Section 2
// classifier happy (keys off current_* / *_conditions / preferences* inside
// changes) so history page filter tabs light up automatically.

import { appendGuestHistory } from './guestHistoryLog';

const ALLERGIES_CATEGORY = 'Allergies';
const HEALTH_KEY         = 'Health Conditions';

// Builds a narrative summary string from non-allergies preference rows.
// Each row becomes "key: value" if key is present, else just "value".
// Rows are grouped by category for stable ordering, joined with ". ".
function buildPreferencesSummary(rows) {
  const sentences = (rows || [])
    .slice()
    .sort((a, b) => {
      const ca = a.category || '';
      const cb = b.category || '';
      if (ca !== cb) return ca.localeCompare(cb);
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      return ta.localeCompare(tb);
    })
    .map(r => {
      const v = (r.value ?? '').trim();
      if (!v) return null;
      const k = (r.key ?? '').trim();
      return k ? `${k}: ${v}` : v;
    })
    .filter(Boolean);
  if (sentences.length === 0) return '';
  // Trailing period only if the last fragment doesn't already end with one.
  const joined = sentences.join('. ');
  return /[.!?]$/.test(joined) ? joined : `${joined}.`;
}

// Aggregates comma-separated values from allergy-like rows.
function buildAllergyColumn(rows) {
  return (rows || [])
    .map(r => (r.value ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

// category is the category that was just written / updated / deleted.
// The full set of current rows is re-read so the aggregate is always correct.
export async function syncPreferencesForGuest(supabase, { guestId, tenantId, actorUserId = null, category }) {
  if (!supabase || !guestId || !tenantId || !category) return;

  if (category === ALLERGIES_CATEGORY) {
    await syncAllergiesColumns(supabase, { guestId, tenantId, actorUserId });
  } else {
    await syncPreferencesSummary(supabase, { guestId, tenantId, actorUserId });
  }
}

async function syncAllergiesColumns(supabase, { guestId, tenantId, actorUserId }) {
  const { data: prefRows, error } = await supabase
    .from('guest_preferences')
    .select('key, value')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guestId)
    .eq('category', ALLERGIES_CATEGORY);
  if (error) { console.error('[preferencesSync] read allergies prefs failed:', error); return; }

  const rows = prefRows || [];
  const nextAllergies = buildAllergyColumn(rows.filter(r => r.key !== HEALTH_KEY));
  const nextHealth    = buildAllergyColumn(rows.filter(r => r.key === HEALTH_KEY));

  const { data: guest, error: readErr } = await supabase
    .from('guests')
    .select('allergies, health_conditions')
    .eq('id', guestId)
    .single();
  if (readErr) { console.error('[preferencesSync] read guest allergies failed:', readErr); return; }

  const currentAllergies = guest?.allergies ?? '';
  const currentHealth    = guest?.health_conditions ?? '';
  const allergiesChanged = currentAllergies !== nextAllergies;
  const healthChanged    = currentHealth    !== nextHealth;
  if (!allergiesChanged && !healthChanged) return;

  const changes = {};
  const columnUpdates = {};
  if (allergiesChanged) {
    changes.allergies = { from: currentAllergies || null, to: nextAllergies || null };
    columnUpdates.allergies = nextAllergies;
  }
  if (healthChanged) {
    changes.health_conditions = { from: currentHealth || null, to: nextHealth || null };
    columnUpdates.health_conditions = nextHealth;
  }

  // Primary action: allergies change wins when both moved; health_conditions
  // only when it's the sole change. The Section 2 classifier looks at
  // changes keys, so both nested entries get picked up regardless.
  const action = allergiesChanged ? 'allergies_changed' : 'health_conditions_changed';

  try {
    await appendGuestHistory(supabase, { guestId, action, actorUserId, changes, columnUpdates });
  } catch (e) {
    console.error('[preferencesSync] appendGuestHistory (allergies) failed:', e);
  }
}

async function syncPreferencesSummary(supabase, { guestId, tenantId, actorUserId }) {
  const { data: prefRows, error } = await supabase
    .from('guest_preferences')
    .select('category, key, value, created_at')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guestId)
    .neq('category', ALLERGIES_CATEGORY);
  if (error) { console.error('[preferencesSync] read non-allergy prefs failed:', error); return; }

  const nextSummary = buildPreferencesSummary(prefRows);

  const { data: guest, error: readErr } = await supabase
    .from('guests')
    .select('preferences_summary')
    .eq('id', guestId)
    .single();
  if (readErr) { console.error('[preferencesSync] read guest summary failed:', readErr); return; }

  const current = guest?.preferences_summary ?? '';
  if (current === nextSummary) return;

  try {
    await appendGuestHistory(supabase, {
      guestId,
      action: 'preferences_changed',
      actorUserId,
      changes: {
        preferences_summary: { from: current || null, to: nextSummary || null },
      },
      columnUpdates: { preferences_summary: nextSummary },
    });
  } catch (e) {
    console.error('[preferencesSync] appendGuestHistory (summary) failed:', e);
  }
}
