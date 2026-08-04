// Cargo Accounts — who in the shore office can see this vessel's month-end.
//
// The grant runs the right way round: the vessel's COMMAND lets the office in,
// and can withdraw it on its own. A company managing six yachts holds six
// independent grants, because a boat changing management company must not have
// to ask five other boats' permission to cut access.
//
// Access is granted to an EMAIL rather than to a user, because the office is
// routinely added before they have a Cargo login. That row sits pending and
// grants nothing until someone signs in with the address and claims it.
//
// Every call is an RPC that checks COMMAND for itself — see
// supabase/migrations/20260804163225_management_access_grants.sql.

import { supabase } from '../lib/supabaseClient';

export async function listManagementAccess(tenantId) {
  if (!tenantId) return { data: [], error: null };
  const { data, error } = await supabase.rpc('list_management_access', { p_tenant_id: tenantId });
  return { data: data || [], error };
}

export async function grantManagementAccess(tenantId, email, companyName) {
  if (!tenantId) return { data: null, error: new Error('No vessel') };
  const { data, error } = await supabase.rpc('grant_management_access', {
    p_tenant_id: tenantId,
    p_email: (email || '').trim(),
    p_company_name: (companyName || '').trim() || null,
  });
  return { data: data || null, error };
}

export async function revokeManagementAccess(id) {
  if (!id) return { data: null, error: new Error('No access to withdraw') };
  const { data, error } = await supabase.rpc('revoke_management_access', { p_id: id });
  return { data: data || null, error };
}

// Run once a session. A grant made before the person had a login is inert until
// this attaches it to them; it is a no-op for everyone else, which is almost
// everyone, so it costs one cheap round trip at boot.
export async function claimManagementAccess() {
  const { data, error } = await supabase.rpc('claim_management_access');
  return { claimed: data || 0, error };
}

// How a row reads on screen lives in managementView, which imports nothing and
// can therefore be tested: accessState, accessLabel, accessSub, sortAccess.
