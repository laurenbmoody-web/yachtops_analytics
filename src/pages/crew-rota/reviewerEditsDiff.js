// reviewerEditsDiff — which GRID CELLS did the reviewer touch before accepting?
//
// Compares two snapshots at the half-hour-slot level:
//   submitted : source_event_type='submitted' — exactly what the HOD sent.
//   approved  : source_event_type='approved'  — taken at accept, after the
//               reviewer's edits.
// A (member, date, slot) cell is a reviewer change when its covering shift
// type differs between the two snapshots — which captures cells the chief
// ADDED (none→type), RETYPED (duty→watch), or ERASED (type→none). The HOD's
// own work is baked into the submitted baseline, so it never highlights.
//
// Erased cells are empty in the live (approved) rota, so the diff is keyed by
// cell coordinates — not shift ids — letting the grid ring empty cells too.
//
// Returns { slots: Set<"memberId|YYYY-MM-DD|slot">, dates: string[] }.

const GRID_START_HOUR = 6;   // must match RotaTodayGrid / RotaWorkspace
const SLOTS = 48;            // 48 half-hour slots per day

function toDec(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
}

// Inclusive-start, exclusive-end slot range a shift covers within [0, SLOTS).
function slotRange(s) {
  let st = toDec(s.start_time);
  let en = toDec(s.end_time);
  if (st == null || en == null || st === en) return null; // equal = unfixed row
  if (en <= st) en += 24;
  const lo = Math.max(0, Math.round((st - GRID_START_HOUR) * 2));
  const hi = Math.min(SLOTS, Math.round((en - GRID_START_HOUR) * 2));
  return hi > lo ? [lo, hi] : null;
}

// Map of cell key → covering shift type for one snapshot's rows.
function buildOccupancy(rows) {
  const occ = new Map();
  for (const s of (rows || [])) {
    if (!s?.member_id || !s?.shift_date) continue;
    const range = slotRange(s);
    if (!range) continue;
    for (let i = range[0]; i < range[1]; i += 1) {
      occ.set(`${s.member_id}|${s.shift_date}|${i}`, s.shift_type || 'duty');
    }
  }
  return occ;
}

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

// Pure cell-level diff for two already-fetched snapshot row arrays. Returns
// the set of "memberId|YYYY-MM-DD" GRID CELLS the reviewer changed (added,
// retyped, or erased) + the sorted affected dates. Used by the read-only
// History view, which already has both snapshots in hand.
export function reviewerEditCells(submittedRows, approvedRows) {
  const occSub = buildOccupancy(submittedRows);
  const occApp = buildOccupancy(approvedRows);
  const cells = new Set();
  const dateSet = new Set();
  const allKeys = new Set([...occSub.keys(), ...occApp.keys()]);
  for (const key of allKeys) {
    if (occSub.get(key) !== occApp.get(key)) {
      const parts = key.split('|');
      cells.add(`${parts[0]}|${parts[1]}`);
      dateSet.add(parts[1]);
    }
  }
  return { cells, dates: [...dateSet].sort() };
}

export async function computeReviewerEdits(supabase, { rotaId, departmentId }) {
  const empty = { slots: new Set(), dates: [] };
  if (!rotaId || !departmentId) return empty;

  const [submitted, approved] = await Promise.all([
    latestSnapshot(supabase, rotaId, departmentId, 'submitted'),
    latestSnapshot(supabase, rotaId, departmentId, 'approved'),
  ]);
  if (!submitted || !approved) return empty;
  if (approved.snapshot_taken_at < submitted.snapshot_taken_at) return empty;

  const occSub = buildOccupancy(submitted.shift_data);
  const occApp = buildOccupancy(approved.shift_data);

  const slots = new Set();
  const dateSet = new Set();
  const allKeys = new Set([...occSub.keys(), ...occApp.keys()]);
  for (const key of allKeys) {
    if (occSub.get(key) !== occApp.get(key)) {
      slots.add(key);
      dateSet.add(key.split('|')[1]);
    }
  }
  return { slots, dates: [...dateSet].sort() };
}
