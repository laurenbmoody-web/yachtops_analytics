// reviewerEditsDiff — which shifts did the reviewer change before accepting?
//
// Baseline:  the latest source_event_type='submitted' snapshot (what the HOD
//            sent for review).
// Result:    the latest source_event_type='approved' snapshot (taken at accept
//            time, AFTER any reviewer edits, before the draft→published flip —
//            so its rows are the live published rows, ids included).
//
// A row in the approved snapshot whose (member, date, start, end, type) tuple
// is NOT in the submitted snapshot is a reviewer change (added or reshaped).
// Removed shifts have no surviving cell to highlight and are skipped at v1.
//
// Returns { ids: Set<shift id>, dates: string[] (sorted changed days) } —
// empty when either snapshot is missing.

const keyOf = (s) =>
  `${s.member_id}|${s.shift_date}|${String(s.start_time).slice(0, 5)}|${String(s.end_time).slice(0, 5)}|${s.shift_type}`;

async function latestSnapshot(supabase, rotaId, departmentId, eventType) {
  const { data, error } = await supabase
    .from('rota_shift_snapshots')
    .select('shift_data, snapshot_taken_at')
    .eq('rota_id', rotaId)
    .eq('department_id', departmentId)
    .eq('source_event_type', eventType)
    .order('snapshot_taken_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function computeReviewerEdits(supabase, { rotaId, departmentId }) {
  const empty = { ids: new Set(), dates: [] };
  if (!rotaId || !departmentId) return empty;

  const [submitted, approved] = await Promise.all([
    latestSnapshot(supabase, rotaId, departmentId, 'submitted'),
    latestSnapshot(supabase, rotaId, departmentId, 'approved'),
  ]);
  if (!submitted || !approved) return empty;
  // The approved snapshot must postdate the submission it reviewed.
  if (approved.snapshot_taken_at < submitted.snapshot_taken_at) return empty;

  const submittedKeys = new Set((submitted.shift_data || []).map(keyOf));
  const ids = new Set();
  const dateSet = new Set();
  for (const s of (approved.shift_data || [])) {
    if (!submittedKeys.has(keyOf(s))) {
      if (s.id) ids.add(s.id);
      if (s.shift_date) dateSet.add(s.shift_date);
    }
  }
  return { ids, dates: [...dateSet].sort() };
}
