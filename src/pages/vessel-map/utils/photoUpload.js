// Pin photos — client-side compression before upload. Phone-camera capture
// is the real use case: originals run 3-12MB and never leave the device.
// Longest edge 1600px, JPEG ~0.8 → a few hundred KB per photo.
import { supabase } from '../../../lib/supabaseClient';

const MAX_EDGE = 1600;
const QUALITY = 0.8;

export async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally {
    bitmap.close?.();
  }
}

// Compress + upload one photo. Returns { path } or { error } — the caller
// appends to detail.photos only after the object is confirmed uploaded,
// and removes the object if the row write then fails (no orphans).
export async function uploadHotspotPhoto({ tenantId, hotspotId, photoId, file }) {
  let blob;
  try {
    blob = await compressPhoto(file);
  } catch (err) {
    console.error('[pin-photos] compression error:', err);
    return { error: 'That image could not be read — try a JPEG or PNG.' };
  }

  const path = `${tenantId}/hotspot-photos/${hotspotId}/${photoId}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('vessel-scans')
    .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (uploadError) {
    console.error('[pin-photos] upload error:', uploadError);
    return { error: uploadError.message || 'The photo could not be uploaded.' };
  }
  return { path };
}
