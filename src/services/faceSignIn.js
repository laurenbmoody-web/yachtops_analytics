// Face sign-in — data access. Conventions as elsewhere in services/:
// every export returns { data, error } and never throws, explicit column lists,
// never select('*').
//
// The one unusual rule here: this module NEVER reads the `descriptor` column.
// Matching happens inside match_face() in the database so templates don't travel
// to a shared kiosk, and the table's column grants enforce that — a select
// asking for `descriptor` would be refused. What comes back from an enrolment
// read is only whether you are enrolled, and when you consented.

import { supabase } from '../lib/supabaseClient';
import { MATCH_DISTANCE } from './faceGate';

// Bump when the consent wording below materially changes, so it stays possible to
// tell who agreed to what. Stored on every enrolment row.
export const CONSENT_TEXT_VERSION = '2026-10-face-v1';

// The wording crew actually agree to. Lives next to the version string on
// purpose — if one changes without the other, that's the bug.
export const CONSENT_COPY = {
  heading: 'Signing in with your face',
  points: [
    'Cargo stores a mathematical description of your face — 128 numbers — not a photograph. The camera image is discarded as soon as those numbers are worked out.',
    'It is used for one thing: recognising you at the gangway so your aboard/ashore status can be flipped without finding your name in a list.',
    'This is biometric data. You are giving explicit consent for it to be processed for that purpose.',
    'You never have to use it. Tapping your own name on the board always works, and nothing about your job depends on enrolling.',
    'You can delete it yourself at any time, and it is removed when you leave the vessel.',
  ],
  agree: 'I consent to Cargo storing a face template for gangway sign-in',
};

// How many captures to take at enrolment. One is brittle — a different angle or
// the harsh light by the passerelle door and it stops matching. Several, and the
// nearest wins at match time.
export const CAPTURES_WANTED = 5;

const ENROL_SELECT = 'id, tenant_id, user_id, capture_index, consent_at, consent_text_version, created_at';

// ── reads ────────────────────────────────────────────────────────────────────

// Whether the signed-in user has enrolled on this vessel, and when they agreed.
// Note the absence of `descriptor` — see the header.
export async function getMyEnrolment(tenantId) {
  if (!tenantId) return { data: { enrolled: false, captures: 0, consentAt: null }, error: null };
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user?.id) return { data: { enrolled: false, captures: 0, consentAt: null }, error: null };

  const { data, error } = await supabase
    .from('crew_face_enrolments')
    .select(ENROL_SELECT)
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .order('capture_index', { ascending: true });

  if (error) return { data: { enrolled: false, captures: 0, consentAt: null }, error };
  return {
    data: {
      enrolled: (data || []).length > 0,
      captures: (data || []).length,
      consentAt: data?.[0]?.consent_at || null,
      consentVersion: data?.[0]?.consent_text_version || null,
    },
    error: null,
  };
}

// Is face sign-in switched on for this vessel? Default false — a vessel has to
// opt in before the door board offers it at all.
export async function isFaceSignInEnabled(tenantId) {
  if (!tenantId) return { data: false, error: null };
  const { data, error } = await supabase
    .from('vessels')
    .select('face_signin_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { data: false, error };
  return { data: !!data?.face_signin_enabled, error: null };
}

export async function setFaceSignInEnabled(tenantId, on) {
  if (!tenantId) return { data: null, error: new Error('No active vessel') };
  const { data, error } = await supabase
    .from('vessels')
    .update({ face_signin_enabled: !!on })
    .eq('tenant_id', tenantId)
    .select('tenant_id, face_signin_enabled')
    .maybeSingle();
  return { data, error };
}

// ── writes ───────────────────────────────────────────────────────────────────

// Replace the signed-in user's enrolment with a fresh set of captures.
//
// Delete-then-insert rather than update: there is deliberately no UPDATE policy
// on the table, so no code path can edit biometric data in place.
export async function enrolMyFace(tenantId, descriptors) {
  if (!tenantId) return { data: null, error: new Error('No active vessel') };
  const list = (descriptors || []).filter((d) => Array.isArray(d) && d.length === 128);
  if (!list.length) return { data: null, error: new Error('No usable captures') };

  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user?.id) return { data: null, error: new Error('Not signed in') };

  const { error: delErr } = await supabase
    .from('crew_face_enrolments')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id);
  if (delErr) return { data: null, error: delErr };

  const now = new Date().toISOString();
  const rows = list.map((descriptor, i) => ({
    tenant_id: tenantId,
    user_id: user.id,
    descriptor,
    capture_index: i,
    consent_at: now,
    consent_text_version: CONSENT_TEXT_VERSION,
    created_by: user.id,
  }));

  const { data, error } = await supabase
    .from('crew_face_enrolments')
    .insert(rows)
    .select(ENROL_SELECT);
  return { data: data || [], error };
}

// Withdraw consent. Command can also remove someone else's (offboarding) by
// passing userId — the RLS delete policy decides whether that's allowed.
export async function deleteFaceEnrolment(tenantId, userId = null) {
  if (!tenantId) return { error: new Error('No active vessel') };
  let uid = userId;
  if (!uid) {
    const { data: { user } = {} } = await supabase.auth.getUser();
    uid = user?.id;
  }
  if (!uid) return { error: new Error('Not signed in') };

  const { error } = await supabase
    .from('crew_face_enrolments')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', uid);
  return { error };
}

// ── matching ─────────────────────────────────────────────────────────────────

// Ask the database who this descriptor belongs to. Returns the single best
// candidate row (or null), which faceGate then accepts or refuses.
//
// Not wrapped in the offline read cache: the RPC name avoids the get_/fetch_/
// list_/is_/my_ prefixes precisely so a stale answer can never be served. Face
// sign-in needs connectivity; tapping a tile does not.
export async function matchFace(tenantId, descriptor, maxDistance) {
  if (!tenantId || !Array.isArray(descriptor) || descriptor.length !== 128) {
    return { data: null, error: null };
  }
  // ALWAYS send all three arguments. PostgREST resolves an RPC by the set of
  // argument names in the body, and omitting p_max_distance to lean on the SQL
  // default got a flat 404 on the iPad — the function exists, but not under the
  // name/arity pair that was asked for. Sending it explicitly also makes
  // faceGate the single source of the threshold, instead of having one value in
  // JS and another as a SQL default that could drift from it.
  const args = {
    p_tenant: tenantId,
    p_descriptor: descriptor,
    p_max_distance: typeof maxDistance === 'number' ? maxDistance : MATCH_DISTANCE,
  };

  const { data, error } = await supabase.rpc('match_face', args);
  if (error) return { data: null, error };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row || null, error: null };
}
