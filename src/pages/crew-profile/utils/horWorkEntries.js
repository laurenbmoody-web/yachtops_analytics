// horWorkEntries — DB-backed HOR work ACTUALS (Phase 5 part 2).
//
// The system of record for each crew member's logged on-duty 30-min blocks per
// day (hor_work_entries). Replaces the localStorage 'cargo_hor_entries' store as
// the source of truth; localStorage now serves only as a synchronous hydrated
// cache for the (sync) compliance engine. Only actuals are persisted — the rota
// baseline is recomputed on read (see horBaseline), never stored here.
//
// Dates are 'YYYY-MM-DD' strings (the HOR calendar day keys); Postgres casts to
// `date`. work_segments is an int[] of 30-min block indices (0–47).

import { supabase } from '../../../lib/supabaseClient';

const pad2 = (n) => String(n).padStart(2, '0');

// All actuals for one crew member in a given month (JS month 0–11).
// → [{ entry_date, work_segments, source, updated_at, ... }]
export async function fetchWorkEntriesForMonth({ tenantId, subjectUserId, year, jsMonth }) {
  if (!tenantId || !subjectUserId) return [];
  const start = `${year}-${pad2(jsMonth + 1)}-01`;
  const end = `${year}-${pad2(jsMonth + 1)}-${pad2(new Date(year, jsMonth + 1, 0).getDate())}`;
  const { data, error } = await supabase
    .from('hor_work_entries')
    .select('entry_date, work_segments, source, updated_at')
    .eq('tenant_id', tenantId)
    .eq('subject_user_id', subjectUserId)
    .gte('entry_date', start)
    .lte('entry_date', end);
  if (error || !data) return [];
  return data;
}

// Upsert one day's actual (replaces the prior row for that date).
export async function upsertWorkEntryDay({ tenantId, subjectUserId, date, workSegments }) {
  if (!tenantId || !subjectUserId || !date) return null;
  const { data, error } = await supabase
    .from('hor_work_entries')
    .upsert(
      {
        tenant_id: tenantId,
        subject_user_id: subjectUserId,
        entry_date: date,
        work_segments: workSegments || [],
        source: 'edited',
        updated_by: (await supabase.auth.getUser())?.data?.user?.id || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,subject_user_id,entry_date' },
    )
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Delete one day's actual (the baseline reasserts for that date on next load).
export async function deleteWorkEntryDay({ tenantId, subjectUserId, date }) {
  if (!tenantId || !subjectUserId || !date) return;
  const { error } = await supabase
    .from('hor_work_entries')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('subject_user_id', subjectUserId)
    .eq('entry_date', date);
  if (error) throw error;
}
