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
import { outbox } from '../../../lib/offline/queue';
import { storedUserId } from '../../../lib/offline/session';

const pad2 = (n) => String(n).padStart(2, '0');

// All actuals for one crew member in a given month (JS month 0–11).
// → [{ entry_date, work_segments, source, updated_at, ... }]
export async function fetchWorkEntriesForMonth({ tenantId, subjectUserId, year, jsMonth }) {
  if (!tenantId || !subjectUserId) return [];
  const start = `${year}-${pad2(jsMonth + 1)}-01`;
  const end = `${year}-${pad2(jsMonth + 1)}-${pad2(new Date(year, jsMonth + 1, 0).getDate())}`;
  const { data, error } = await supabase
    .from('hor_work_entries')
    .select('entry_date, work_segments, segment_types, source, updated_at')
    .eq('tenant_id', tenantId)
    .eq('subject_user_id', subjectUserId)
    .gte('entry_date', start)
    .lte('entry_date', end);
  if (error || !data) return [];
  return data;
}

// Writes go through the offline outbox (lib/offline/outbox.js): online they
// run immediately and a real rejection (RLS, locked month) still throws;
// with no network the day is saved on the device, shows everywhere the month
// is read, and syncs when the link returns. One day = one row, so only the
// latest edit of each day is sent.
const dayKey = (tenantId, subjectUserId, date) => `hor_work_entries|${tenantId}|${subjectUserId}|${date}`;
const fmtDay = (date) => date.split('-').reverse().join('/');

// Upsert one day's actual (replaces the prior row for that date).
// → the saved row, or { ..., queued: true } when it's waiting to sync.
export async function upsertWorkEntryDay({ tenantId, subjectUserId, date, workSegments, segmentTypes }) {
  if (!tenantId || !subjectUserId || !date) return null;
  const row = {
    tenant_id: tenantId,
    subject_user_id: subjectUserId,
    entry_date: date,
    work_segments: workSegments || [],
    segment_types: segmentTypes || {},
    source: 'edited',
    // From the stored session: auth.getUser() is a network call.
    updated_by: storedUserId(),
    updated_at: new Date().toISOString(),
  };
  const res = await outbox.submit({
    key: dayKey(tenantId, subjectUserId, date),
    table: 'hor_work_entries',
    type: 'upsert',
    row,
    onConflict: 'tenant_id,subject_user_id,entry_date',
    match: { tenant_id: tenantId, subject_user_id: subjectUserId, entry_date: date },
    label: `Hours of rest for ${fmtDay(date)}`,
  });
  return res.queued ? { ...row, queued: true } : row;
}

// Delete one day's actual (the baseline reasserts for that date on next load).
export async function deleteWorkEntryDay({ tenantId, subjectUserId, date }) {
  if (!tenantId || !subjectUserId || !date) return;
  await outbox.submit({
    key: dayKey(tenantId, subjectUserId, date),
    table: 'hor_work_entries',
    type: 'delete',
    match: { tenant_id: tenantId, subject_user_id: subjectUserId, entry_date: date },
    label: `Clearing hours of rest for ${fmtDay(date)}`,
  });
}

// ── User-scoped shift templates ──────────────────────────────────────────────
// Each crew member keeps their own reusable patterns (RLS: owner = auth.uid()).
// Not vessel- or role-scoped. Shape mirrors a logged day so a template applies
// exactly like one: { work_segments:int[], segment_types:{seg:type} }.

export async function fetchShiftTemplates() {
  const { data, error } = await supabase
    .from('hor_shift_templates')
    .select('id, name, work_segments, segment_types, created_at')
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data;
}

export async function saveShiftTemplate({ name, workSegments, segmentTypes }) {
  const { data, error } = await supabase
    .from('hor_shift_templates')
    .insert({
      name: (name || 'Untitled').trim(),
      work_segments: workSegments || [],
      segment_types: segmentTypes || {},
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteShiftTemplate(id) {
  if (!id) return;
  const { error } = await supabase.from('hor_shift_templates').delete().eq('id', id);
  if (error) throw error;
}
