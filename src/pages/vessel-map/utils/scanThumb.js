// Poster-frame refresh — any orient approval regenerates the scan's
// thumbnail so it never drifts stale from the room's canonical orientation.
// Discipline mirrors replace-file: the new object is uploaded and the row
// repointed BEFORE the old object is removed; the bucket has no UPDATE
// policy, so paths are versioned rather than overwritten in place.
import { supabase } from '../../../lib/supabaseClient';

// Returns the new thumb_path on success, null on any failure (the thumbnail
// is a nicety — failures are logged, never surfaced as blocking errors).
export async function refreshScanThumb({ scan, tenantId, blob }) {
  if (!scan || !tenantId || !blob) return null;

  const path = `${tenantId}/thumbs/${scan.id}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('vessel-scans')
    .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (uploadError) {
    console.error('[scan-thumb] upload error:', uploadError);
    return null;
  }

  const { error: rowError } = await supabase
    .from('vessel_scans')
    .update({ thumb_path: path })
    .in('id', [scan.id]);
  if (rowError) {
    console.error('[scan-thumb] row update error:', rowError);
    // The row still points at the old thumb — remove the orphaned new object.
    const { error: rmError } = await supabase.storage.from('vessel-scans').remove([path]);
    if (rmError) console.error('[scan-thumb] orphan cleanup error:', rmError);
    return null;
  }

  if (scan.thumb_path && scan.thumb_path !== path) {
    const { error: rmOldError } = await supabase.storage.from('vessel-scans').remove([scan.thumb_path]);
    if (rmOldError) console.error('[scan-thumb] old thumb cleanup error:', rmOldError); // non-fatal
  }
  return path;
}
