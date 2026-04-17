import { supabase } from '../lib/supabaseClient';

function generateToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Insert a single crew invite row into crew_invites.
 *
 * Returns { data, inviteLink, error, existingInvite }.
 * Never throws — all error paths are returned via the error field.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.tenantId
 * @param {string} params.invitedBy          - user.id of the inviter
 * @param {string} params.departmentId       - UUID of the department
 * @param {string} params.departmentLabel    - human-readable department name
 * @param {string|null} [params.roleId]      - UUID from the global roles catalog (null for custom/other roles)
 * @param {string|null} [params.customRoleId] - UUID from tenant_custom_roles (null when roleId is set)
 * @param {string} params.roleLabel          - human-readable role name
 * @param {string} [params.permissionTier]   - COMMAND | CHIEF | HOD | CREW (default: CREW)
 * @param {string|null} [params.firstName]  - invitee's name written to invitee_name for the greeting email
 * @param {string|null} [params.startDate]  - ISO date string (YYYY-MM-DD); sets status='invited' until that date
 */
export async function createCrewInvite({
  email,
  tenantId,
  invitedBy,
  departmentId,
  departmentLabel,
  roleId = null,
  customRoleId = null,
  roleLabel,
  permissionTier = 'CREW',
  firstName = null,
  startDate = null,
}) {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Check for an existing PENDING invite for the same tenant + email.
    const { data: existing, error: checkError } = await supabase
      .from('crew_invites')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email', normalizedEmail)
      .eq('status', 'PENDING');

    if (checkError) {
      return { data: null, inviteLink: null, error: checkError };
    }
    if (existing && existing.length > 0) {
      return {
        data: null,
        inviteLink: null,
        error: { message: `An invite for ${normalizedEmail} is already pending.` },
        existingInvite: existing[0],
      };
    }

    // Derive invited_role from permission_tier for backward compatibility.
    let invitedRole = 'CREW';
    if (permissionTier === 'COMMAND') invitedRole = 'CHIEF'; // COMMAND cannot be invited directly
    else if (permissionTier === 'CHIEF') invitedRole = 'CHIEF';
    else if (permissionTier === 'HOD') invitedRole = 'HOD';

    const token = generateToken();

    const { data, error: insertError } = await supabase
      .from('crew_invites')
      .insert({
        email: normalizedEmail,
        invitee_name: firstName ? firstName.trim() || null : null,
        tenant_id: tenantId,
        department_id: departmentId,
        role_id: roleId,
        custom_role_id: customRoleId,
        department_label: departmentLabel,
        role_label: roleLabel,
        permission_tier: permissionTier,
        status: 'PENDING',
        invited_role: invitedRole,
        token,
        invited_by: invitedBy,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        start_date: startDate || null,
      })
      .select()
      .single();

    if (insertError) {
      return { data: null, inviteLink: null, error: insertError };
    }

    const inviteLink = `${window.location.origin}/invite-accept?token=${token}`;
    return { data, inviteLink, error: null };
  } catch (err) {
    return { data: null, inviteLink: null, error: err };
  }
}

/**
 * Trigger the sendCrewInvite edge function to send an invitation email via Resend.
 * Returns { data, error } — same shape as supabase.functions.invoke.
 *
 * @param {string} crewInviteId - UUID of the crew_invites row
 */
export async function sendCrewInvite(crewInviteId) {
  return supabase.functions.invoke('sendCrewInvite', { body: { crewInviteId } });
}
