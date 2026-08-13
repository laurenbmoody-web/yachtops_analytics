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
 * @param {string|null} [params.rosterUserId] - user id of an existing roster crew member (one added
 *        without an email). Set it and acceptance attaches the login to that same record instead of
 *        creating a second account, so their rota/jobs/docs history carries over.
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
  rosterUserId = null,
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
        roster_user_id: rosterUserId || null,
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

/**
 * Add a crew member who has no login — on the roster, but not invited.
 *
 * They get a real user record (auth user with no usable email or password,
 * profile flagged roster_only, tenant_members row), so rota, jobs, hours of
 * rest, laundry, documents and their crew profile all work for them
 * immediately. Only signing in is impossible. `inviteRosterCrewMember` hands
 * them the account later without losing any of that history.
 *
 * Returns { userId, error } — never throws.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.fullName
 * @param {string|null} [params.departmentId]
 * @param {string|null} [params.roleId]         - global roles catalog id
 * @param {string|null} [params.customRoleId]   - tenant_custom_roles id
 * @param {string} [params.permissionTier]      - COMMAND | CHIEF | HOD | CREW (default: CREW)
 * @param {string|null} [params.startDate]      - ISO date; a future one shows them as "Invited" until it arrives
 */
export async function createRosterCrewMember({
  tenantId,
  fullName,
  departmentId = null,
  roleId = null,
  customRoleId = null,
  permissionTier = 'CREW',
  startDate = null,
}) {
  const { data, error } = await supabase.functions.invoke('rosterCrew', {
    body: {
      action: 'create',
      tenantId,
      fullName,
      departmentId,
      roleId,
      customRoleId,
      permissionTier,
      startDate,
    },
  });
  if (error) return { userId: null, error: await readFunctionError(error) };
  if (!data?.success) return { userId: null, error: { message: data?.error || 'Failed to add crew member.' } };
  return { userId: data.userId, error: null };
}

/**
 * Attach a real login to a roster crew member — the "invite them properly,
 * later" step. Creates the invite against their existing user record and
 * emails it.
 *
 * Returns { data, inviteLink, error, emailError } — never throws. `error`
 * means no invite exists; `emailError` means the invite exists but the email
 * didn't go out, so the caller should offer the link.
 */
export async function inviteRosterCrewMember({
  userId,
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
  const { data, inviteLink, error } = await createCrewInvite({
    email,
    tenantId,
    invitedBy,
    departmentId,
    departmentLabel,
    roleId,
    customRoleId,
    roleLabel,
    permissionTier,
    firstName,
    startDate,
    rosterUserId: userId,
  });
  if (error) return { data: null, inviteLink: null, error, emailError: null };

  const { error: sendError } = await sendCrewInvite(data?.id);
  return { data, inviteLink, error: null, emailError: sendError || null };
}

/**
 * Complete a roster crew member's account from the invite link — sets their
 * email and password on the record they already have. No session required;
 * the invite token is the credential.
 */
export async function activateRosterCrewMember({ token, password, fullName }) {
  const { data, error } = await supabase.functions.invoke('rosterCrew', {
    body: { action: 'activate', token, password, fullName },
  });
  if (error) return { data: null, error: await readFunctionError(error) };
  if (!data?.success) return { data: null, error: { message: data?.error || 'Failed to set up your login.' } };
  return { data, error: null };
}

/**
 * supabase.functions.invoke reports a non-2xx as a bare "Edge Function
 * returned a non-2xx status code" — the useful message is in the response
 * body, so dig it out when there is one.
 */
async function readFunctionError(error) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return { message: body.error };
  } catch {
    /* fall through to the generic message */
  }
  return { message: error?.message || 'Something went wrong.' };
}
