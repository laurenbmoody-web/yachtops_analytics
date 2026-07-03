// Master signature & stamp — saved once per user, reused on crew lists.
//
// Images live in the private 'master-signatures' bucket under the owner's
// {auth.uid()}/ folder (storage RLS from 20260703120000). The object PATHs are
// persisted on public.master_signatures so they survive signed-URL expiry;
// fellow tenant members may read them (to apply the master's stamp).

import { supabase } from '../../../lib/supabaseClient';

const BUCKET = 'master-signatures';
const SIGNED_URL_TTL = 60 * 60; // 1h

/**
 * Fetch a user's saved signature/stamp paths (null if none). Checks this
 * feature's master_signatures store first, then falls back to the parallel
 * captain_credentials store — so a signature saved by either uploader pulls
 * through. The returned `bucket` tells the loader which storage bucket to read.
 */
export async function getMasterSignatureRow(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('master_signatures')
    .select('user_id, signature_path, stamp_path, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (data && (data.signature_path || data.stamp_path)) return { ...data, bucket: BUCKET };

  const { data: cc } = await supabase
    .from('captain_credentials')
    .select('user_id, signature_path, stamp_path, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (cc && (cc.signature_path || cc.stamp_path)) return { ...cc, bucket: 'captain-credentials' };

  return data ? { ...data, bucket: BUCKET } : null;
}

/** A signed, viewable URL for a stored path in the given bucket (null on failure). */
export async function signedUrl(path, bucket = BUCKET) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) { console.error('[master-sig] signedUrl failed', path, error); return null; }
  return data?.signedUrl || null;
}

/**
 * Load a stored path into a base64 data-URL for jsPDF.addImage. Fetched as a
 * blob and read with FileReader (NOT drawn to a canvas) so a private signed URL
 * can't taint a canvas and blank the signature. Preserves the original format.
 */
export async function loadImageForPdf(path, bucket = BUCKET) {
  const url = await signedUrl(path, bucket);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('[master-sig] loadImageForPdf failed', path, e);
    return null;
  }
}

const extFor = (file) => {
  const t = (file.type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  return 'jpg';
};

/**
 * Upload a signature or stamp image (a File from an <input type=file>) for the
 * current user, persist its path on master_signatures, and return the new path.
 * `kind` is 'signature' | 'stamp'.
 */
export async function uploadMasterImage(file, kind, tenantId) {
  if (!file) throw new Error('No file selected.');
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not authenticated.');

  const path = `${uid}/${kind}-${Date.now()}.${extFor(file)}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'image/png', upsert: true });
  if (upErr) throw upErr;

  const column = kind === 'stamp' ? 'stamp_path' : 'signature_path';
  const { error: rowErr } = await supabase
    .from('master_signatures')
    .upsert(
      { user_id: uid, tenant_id: tenantId || null, [column]: path, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (rowErr) throw rowErr;
  return path;
}

/** Remove a saved signature/stamp for the current user. */
export async function clearMasterImage(kind) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;
  const column = kind === 'stamp' ? 'stamp_path' : 'signature_path';
  await supabase.from('master_signatures').update({ [column]: null, updated_at: new Date().toISOString() }).eq('user_id', uid);
}
