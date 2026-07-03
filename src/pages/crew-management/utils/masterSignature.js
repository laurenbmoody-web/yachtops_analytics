// Master signature & stamp — saved once per user, reused on crew lists.
//
// Images live in the private 'master-signatures' bucket under the owner's
// {auth.uid()}/ folder (storage RLS from 20260703120000). The object PATHs are
// persisted on public.master_signatures so they survive signed-URL expiry;
// fellow tenant members may read them (to apply the master's stamp).

import { supabase } from '../../../lib/supabaseClient';
import { loadLogoForPdf } from './guestBookExport';

const BUCKET = 'master-signatures';
const SIGNED_URL_TTL = 60 * 60; // 1h

/** Fetch the saved signature/stamp paths for a user (null if none). */
export async function getMasterSignatureRow(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('master_signatures')
    .select('user_id, signature_path, stamp_path, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

/** A signed, viewable URL for a stored path (null on failure). */
export async function signedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) { console.error('[master-sig] signedUrl failed', path, error); return null; }
  return data?.signedUrl || null;
}

/** Load a stored path into a PNG data-URL for jsPDF.addImage (null on failure). */
export async function loadImageForPdf(path) {
  const url = await signedUrl(path);
  if (!url) return null;
  const img = await loadLogoForPdf(url);
  return img?.dataUrl || null;
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
