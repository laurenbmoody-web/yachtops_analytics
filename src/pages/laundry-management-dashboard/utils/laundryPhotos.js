// Laundry photos live in the private `laundry-photos` Storage bucket (not the
// DB). Rows store the object path (e.g. `<tenantId>/<folder>/<uuid>.jpg`); we
// upload compressed files on save and mint short-lived signed URLs on read.
//
// Backward-compatible: legacy items still hold base64 data URLs inline — those
// pass through untouched, so nothing breaks while old photos age out.

import { supabase } from '../../../lib/supabaseClient';

const BUCKET = 'laundry-photos';
const SIGN_TTL = 3600; // 1 hour

export const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');
export const isStoredPath = (v) => typeof v === 'string' && !!v && !isDataUrl(v) && !v.startsWith('http');

// Normalise any stored/displayed value back to what belongs in the DB:
// data URL → kept for upload; a signed/public bucket URL → its object path;
// an existing path → unchanged; a foreign URL → left as-is.
export function pathFromValue(v) {
  if (!v || typeof v !== 'string') return null;
  if (isDataUrl(v)) return v;
  if (v.startsWith('http')) {
    const m = v.match(/\/object\/(?:sign|public)\/laundry-photos\/([^?]+)/);
    return m ? decodeURIComponent(m[1]) : v;
  }
  return v;
}

const rid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`);

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Upload any data-URL entries to the bucket, return the stored value list
// (paths for uploads, unchanged for anything already a path/url).
export async function uploadLaundryPhotos(tenantId, values) {
  const normed = (values || []).map(pathFromValue).filter(Boolean);
  if (!tenantId) return normed.filter((v) => !isDataUrl(v));
  const folder = rid();
  const out = [];
  for (const v of normed) {
    if (!isDataUrl(v)) { out.push(v); continue; }
    try {
      const blob = dataUrlToBlob(v);
      const path = `${tenantId}/${folder}/${rid()}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (error) { console.error('[laundry] photo upload failed', error); continue; }
      out.push(path);
    } catch (e) { console.error('[laundry] photo upload error', e); }
  }
  return out;
}

// Best-effort remove of orphaned files (e.g. photos dropped on edit).
export async function deleteLaundryPhotos(paths) {
  const real = (paths || []).filter(isStoredPath);
  if (!real.length) return;
  try { await supabase.storage.from(BUCKET).remove(real); } catch (e) { /* non-fatal */ }
}

// Resolve a list of stored values → displayable URLs (signed for paths,
// pass-through for data URLs / http). Returns a Map keyed by the stored value.
export async function signLaundryValues(values) {
  const map = new Map();
  const toSign = [];
  for (const v of values || []) {
    if (!v) continue;
    if (isStoredPath(v)) toSign.push(v);
    else map.set(v, v); // data URL or already an http URL
  }
  const uniq = [...new Set(toSign)];
  if (uniq.length) {
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(uniq, SIGN_TTL);
      (data || []).forEach((d) => { if (d?.signedUrl && d?.path) map.set(d.path, d.signedUrl); });
    } catch (e) { console.error('[laundry] sign failed', e); }
  }
  return map;
}

// Attach display URLs to items in place of raw paths: sets item.photos (URLs)
// and item.photo (first URL). Batches signing across all items.
export async function resolveLaundryPhotos(items) {
  const list = items || [];
  const all = [];
  list.forEach((i) => (i.photos || []).forEach((p) => all.push(p)));
  if (!all.length) return list;
  const map = await signLaundryValues(all);
  return list.map((i) => {
    const urls = (i.photos || []).map((p) => map.get(p) || p).filter(Boolean);
    return { ...i, photos: urls, photo: urls[0] || '' };
  });
}
