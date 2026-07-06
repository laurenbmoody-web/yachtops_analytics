// Pin payload writes — notes, checklist, photos all live in
// scan_hotspots.detail (jsonb). Discipline: read-modify-write against the
// freshest row, merge ONLY the touched key (never overwrite siblings),
// write via .update().in(). Last-write-wins is accepted at this scale.
import { supabase } from '../../../lib/supabaseClient';

// Applies `mutate(currentArray) -> nextArray` to one key of detail and
// persists. Returns { detail } on success or { error } with a friendly
// message — callers surface it, never swallow it.
export async function updateDetailKey(hotspotId, key, mutate) {
  const { data: fresh, error: readError } = await supabase
    .from('scan_hotspots')
    .select('detail')
    .eq('id', hotspotId)
    .single();
  if (readError) {
    console.error('[pin-detail] fresh read error:', readError);
    return { error: readError.message || 'Could not load the latest pin data.' };
  }

  const detail = { ...(fresh?.detail || {}) };
  detail[key] = mutate(Array.isArray(detail[key]) ? detail[key] : []);

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
