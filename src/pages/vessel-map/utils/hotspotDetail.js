// Pin payload writes — notes, checklist, photos all live in
// scan_hotspots.detail (jsonb). Discipline: read-modify-write against the
// freshest row, merge ONLY the touched key (never overwrite siblings),
// write via .update().in(). Last-write-wins is accepted at this scale.
import { supabase } from '../../../lib/supabaseClient';

// Applies `mutate(freshDetail) -> nextDetail` and persists. Returns
// { detail } on success or { error } with a friendly message — callers
// surface it, never swallow it.
export async function updateDetail(hotspotId, mutate) {
  const { data: fresh, error: readError } = await supabase
    .from('scan_hotspots')
    .select('detail')
    .eq('id', hotspotId)
    .single();
  if (readError) {
    console.error('[pin-detail] fresh read error:', readError);
    return { error: readError.message || 'Could not load the latest pin data.' };
  }

  const detail = mutate({ ...(fresh?.detail || {}) });

  const { error: writeError } = await supabase
    .from('scan_hotspots')
    .update({ detail })
    .in('id', [hotspotId]);
  if (writeError) {
    console.error('[pin-detail] write error:', writeError);
    return { error: writeError.message || 'Could not save the change.' };
  }
  return { detail };
}

// Single-key convenience: mutate one array of detail, siblings untouched.
export function updateDetailKey(hotspotId, key, mutateArray) {
  return updateDetail(hotspotId, (detail) => ({
    ...detail,
    [key]: mutateArray(Array.isArray(detail[key]) ? detail[key] : []),
  }));
}
