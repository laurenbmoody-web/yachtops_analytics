import { supabase } from '../../../lib/supabaseClient';

// The captain's own signature + vessel stamp, saved privately (his account
// only — RLS restricts every read/write to the owning user) for producing
// documents he signs off. See 20260703120000_captain_credentials.sql.

const BUCKET = 'captain-credentials';
const ONE_YEAR = 60 * 60 * 24 * 365;

export const fetchCaptainCredentials = async (userId) => {
  if (!userId) return {};
  const { data, error } = await supabase
    ?.from('captain_credentials')
    ?.select('signature_path, stamp_path')
    ?.eq('user_id', userId)
    ?.maybeSingle();
  if (error) { console.error('[captain-credentials] fetch failed', error); return {}; }
  return data || {};
};

export const saveCaptainSignature = async (userId, tenantId, dataUrl) => {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/signature.png`;
  const { error: upErr } = await supabase
    ?.storage?.from(BUCKET)
    ?.upload(path, blob, { cacheControl: '3600', upsert: true, contentType: 'image/png' });
  if (upErr) throw upErr;
  const { error } = await supabase
    ?.from('captain_credentials')
    ?.upsert({ user_id: userId, tenant_id: tenantId, signature_path: path, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  return path;
};

export const saveCaptainStamp = async (userId, tenantId, file) => {
  const ext = file?.type === 'image/png' ? 'png' : 'jpg';
  const path = `${userId}/stamp.${ext}`;
  const { error: upErr } = await supabase
    ?.storage?.from(BUCKET)
    ?.upload(path, file, { cacheControl: '3600', upsert: true, contentType: file?.type || 'image/png' });
  if (upErr) throw upErr;
  const { error } = await supabase
    ?.from('captain_credentials')
    ?.upsert({ user_id: userId, tenant_id: tenantId, stamp_path: path, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  return path;
};

export const clearCaptainSignature = async (userId) => {
  const { data } = await supabase?.from('captain_credentials')?.select('signature_path')?.eq('user_id', userId)?.maybeSingle();
  if (data?.signature_path) await supabase?.storage?.from(BUCKET)?.remove([data.signature_path]);
  const { error } = await supabase
    ?.from('captain_credentials')
    ?.update({ signature_path: null, updated_at: new Date().toISOString() })
    ?.eq('user_id', userId);
  if (error) throw error;
};

export const clearCaptainStamp = async (userId) => {
  const { data } = await supabase?.from('captain_credentials')?.select('stamp_path')?.eq('user_id', userId)?.maybeSingle();
  if (data?.stamp_path) await supabase?.storage?.from(BUCKET)?.remove([data.stamp_path]);
  const { error } = await supabase
    ?.from('captain_credentials')
    ?.update({ stamp_path: null, updated_at: new Date().toISOString() })
    ?.eq('user_id', userId);
  if (error) throw error;
};

export const signedCaptainCredentialUrl = async (path) => {
  if (!path) return null;
  const { data, error } = await supabase?.storage?.from(BUCKET)?.createSignedUrl(path, ONE_YEAR);
  if (error) { console.error('[captain-credentials] sign url failed', error); return null; }
  return data?.signedUrl || null;
};
