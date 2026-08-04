// Cargo — the shore office's access to a vessel, from both ends.
//
// A management company is a workspace with its own team, the same shape
// supplier_profiles / supplier_contacts already use in this app. Two sides:
//
//   the vessel   engages a firm and says what it covers, and can end that
//                engagement on its own — six yachts with the same firm is six
//                engagements, not one relationship holding six boats hostage
//   the firm     runs its own team, so a new hire reaches the vessels the firm
//                is engaged on without six captains re-granting
//
// The trade is deliberate: the vessel controls the engagement and its scopes;
// the firm controls who its people are. What that buys is per-person identity —
// a month signed off names the human who signed it, not a shared mailbox.
//
// Every call is an RPC that checks for itself. A management login holds no table
// privileges in this schema at all. See
// supabase/migrations/20260804185607_management_workspaces.sql.

import { supabase } from '../lib/supabaseClient';

// ── the vessel's side (COMMAND) ──────────────────────────────────────────────
// The firms engaged on this vessel, each with the people currently at it. The
// boat gave access to a company, so it is entitled to see which humans that
// turned out to be, at any moment.
export async function listManagementAccess(tenantId) {
  if (!tenantId) return { data: [], error: null };
  const { data, error } = await supabase.rpc('list_management_access', { p_tenant_id: tenantId });
  return { data: data || [], error };
}

// One call whether the firm is new or already on Cargo. If the address already
// belongs to a firm, this engages THAT firm — the name typed here can't fork it
// into a duplicate. Otherwise the firm is created with this address as its first
// owner, and they run their own team from there.
export async function grantManagementAccess(tenantId, email, companyName, scopes = ['accounts']) {
  if (!tenantId) return { data: null, error: new Error('No vessel') };
  const { data, error } = await supabase.rpc('grant_management_access', {
    p_tenant_id: tenantId,
    p_email: (email || '').trim(),
    p_company_name: (companyName || '').trim() || null,
    p_scopes: scopes,
  });
  return { data: data || null, error };
}

// Ends the engagement. Deactivated, never deleted — months this firm signed off
// name their people, and the vessel keeps that history.
export async function revokeManagementAccess(engagementId) {
  if (!engagementId) return { data: null, error: new Error('No engagement to end') };
  const { data, error } = await supabase.rpc('revoke_management_access', { p_id: engagementId });
  return { data: data || null, error };
}

// ── the firm's side ──────────────────────────────────────────────────────────
// Which firm the caller acts for. Almost always exactly one; empty for crew,
// which is how the app knows not to offer the management surface at all.
export async function listMyManagementCompanies() {
  const { data, error } = await supabase.rpc('my_management_companies');
  return { data: data || [], error };
}

export async function listManagementTeam(companyId) {
  if (!companyId) return { data: [], error: null };
  const { data, error } = await supabase.rpc('management_team', { p_company_id: companyId });
  return { data: data || [], error };
}

// Owner/admin only, enforced in the database. A colleague can be added before
// they have a Cargo login — the row grants nothing until they claim it, which is
// what makes per-person identity affordable instead of a favour to ask a captain.
export async function addManagementTeamMember(companyId, email, tier = 'MEMBER') {
  if (!companyId) return { data: null, error: new Error('No company') };
  const { data, error } = await supabase.rpc('management_team_add', {
    p_company_id: companyId, p_email: (email || '').trim(), p_tier: tier,
  });
  return { data: data || null, error };
}

export async function removeManagementTeamMember(memberId) {
  if (!memberId) return { data: null, error: new Error('No team member') };
  const { data, error } = await supabase.rpc('management_team_remove', { p_member_id: memberId });
  return { data: data || null, error };
}

// Run once a session. Someone added to a firm before they had a login picks up
// their place, and with it every vessel that firm is engaged on. A no-op for
// everyone else, which is almost everyone.
export async function claimManagementAccess() {
  const { data, error } = await supabase.rpc('claim_management_access');
  return { claimed: data || 0, error };
}
