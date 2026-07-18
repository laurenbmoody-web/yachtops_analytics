// Guest share links for a laundry case. A crew member mints a link (token) and
// a secret (the guest's surname); the guest opens /case/<token>, enters the
// surname, and sees the case contents. All access goes through the two
// SECURITY DEFINER RPCs — the shares table is never read directly by the guest.

import { supabase } from '../../../lib/supabaseClient';

export const shareUrlFor = (token) => {
  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
  return `${origin}/case/${token}`;
};

// Mint a share link for a case. `secret` is the gate (guest surname).
// `expiresAt` is an ISO string or null (no expiry).
export const createCaseShare = async (caseId, secret, expiresAt = null) => {
  const { data, error } = await supabase.rpc('create_laundry_case_share', {
    p_case_id: caseId,
    p_secret: secret,
    p_expires_at: expiresAt,
  });
  if (error) { console.error('[case-share] mint failed', error); return null; }
  const token = data;
  return { token, url: shareUrlFor(token) };
};

// Public read (used by the guest page). Returns { ok, case, items } or
// { ok:false, reason }.
export const fetchCaseShare = async (token, secret) => {
  const { data, error } = await supabase.rpc('fetch_laundry_case_share', {
    p_token: token,
    p_secret: secret,
  });
  if (error) { console.error('[case-share] fetch failed', error); return { ok: false, reason: 'error' }; }
  return data || { ok: false, reason: 'error' };
};

// Existing (non-revoked) shares for a case, so crew can copy or revoke a link.
export const loadCaseShares = async (caseId) => {
  if (!caseId) return [];
  const { data, error } = await supabase
    .from('laundry_case_shares')
    .select('id, token, expires_at, revoked, created_at')
    .eq('case_id', caseId)
    .eq('revoked', false)
    .order('created_at', { ascending: false });
  if (error) { console.error('[case-share] load failed', error); return []; }
  return (data || []).map((r) => ({ id: r.id, token: r.token, url: shareUrlFor(r.token), expiresAt: r.expires_at, createdAt: r.created_at }));
};

export const revokeCaseShare = async (id) => {
  const { error } = await supabase.from('laundry_case_shares').update({ revoked: true }).eq('id', id);
  if (error) { console.error('[case-share] revoke failed', error); return false; }
  return true;
};
