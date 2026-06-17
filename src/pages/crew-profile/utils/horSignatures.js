// horSignatures — drawn-signature capture for the HOR month sign-off workflow.
//
// A signature is a small PNG (from the canvas SignaturePad) stored in the
// private 'hor-signatures' bucket under the SIGNER's own {auth.uid()}/ folder
// (matches the storage RLS from 20260616120000). We persist the object PATH on
// the month-status row and re-sign it on display, so the record stays valid
// past any signed-URL expiry. Reads are scoped to tenant members by RLS.

import { supabase } from '../../../lib/supabaseClient';

const BUCKET = 'hor-signatures';
const SIGNED_URL_TTL = 60 * 60; // 1h — re-signed each time the record is viewed.

// Turn a `data:image/png;base64,...` URL into a Blob for upload.
const dataUrlToBlob = (dataUrl) => {
  const [meta, b64] = String(dataUrl).split(',');
  const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

// Upload a drawn signature PNG and return its storage path (to persist on the
// month row via the writer RPC). `kind` is 'submit' | 'approve' — purely for a
// readable filename; the folder is always the signer's own uid.
export async function uploadSignature(dataUrl, kind = 'submit') {
  if (!dataUrl) throw new Error('No signature to upload.');
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not authenticated.');

  const path = `${uid}/${kind}-${Date.now()}.png`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, dataUrlToBlob(dataUrl), { contentType: 'image/png', upsert: false });
  if (error) throw error;
  return path;
}

// Re-sign a stored signature path for display. Returns null on any failure so
// a missing/expired signature never breaks the surrounding record view.
export async function getSignatureUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) {
    // Don't break the record view, but surface why a signature didn't render
    // (e.g. storage RLS) instead of silently showing a blank panel.
    console.error('[HOR] getSignatureUrl failed for', path, error);
    return null;
  }
  return data?.signedUrl || null;
}

// Best-effort public IP for the audit trail. The network policy may block the
// lookup — that's fine, we return null and the signature still records name +
// server timestamp + user agent. Short timeout so submit never hangs on it.
export async function bestEffortIp() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.ip || null;
  } catch {
    return null;
  }
}

// The browser user agent at the moment of signing (audit trail).
export const currentUserAgent = () =>
  (typeof navigator !== 'undefined' ? navigator.userAgent : null) || null;
