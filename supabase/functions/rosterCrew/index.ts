// Supabase Edge Function: rosterCrew
//
// Crew who are aboard but have no login yet ("roster crew"), and the later
// hand-over of a real account to one of them.
//
//   action: 'create'   — add a crew member with no email. Creates a real auth
//                        user (placeholder @roster.cargo.invalid address, no
//                        password), a profile flagged roster_only, and the
//                        tenant_members row. Because they are a normal user
//                        record, rota / jobs / hours of rest / laundry /
//                        documents all work for them straight away. What they
//                        can't do is sign in.
//
//   action: 'activate' — the invite for a roster crew member has been opened
//                        and they've chosen a password. Attaches the real
//                        email + password to that *same* user record, so all
//                        their history follows them, and marks the invite
//                        accepted. Authenticated by the invite token itself,
//                        not by a session (the invitee has none yet).
//
// 'create' requires a caller with COMMAND / CHIEF / MANAGEMENT on the vessel.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-injected).

import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// RFC 2606 reserves .invalid, so nothing here can ever be delivered or
// registered by someone else. Never shown in the UI — profiles.email stays
// NULL for roster crew.
const PLACEHOLDER_DOMAIN = 'roster.cargo.invalid';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// Mirrors the invite modal: the role's default tier, falling back to CREW.
const TIERS = ['COMMAND', 'CHIEF', 'HOD', 'CREW', 'VIEW_ONLY'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'service role env vars not configured' }, 500);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const action = body?.action;

  // ── Add a crew member who has no login ────────────────────────────────────
  if (action === 'create') {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'missing token' }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const callerId = userData?.user?.id;
    if (userErr || !callerId) return json({ error: 'invalid token' }, 401);

    const tenantId = body?.tenantId;
    const fullName = String(body?.fullName || '').trim();
    if (!tenantId) return json({ error: 'tenantId is required' }, 400);
    if (!fullName) return json({ error: 'A name is required' }, 400);

    const { data: allowed, error: permErr } = await admin.rpc('can_manage_crew', {
      p_user_id: callerId,
      p_tenant_id: tenantId,
    });
    if (permErr) {
      console.error('[rosterCrew] can_manage_crew failed', permErr);
      return json({ error: 'Could not verify your permissions' }, 502);
    }
    if (!allowed) return json({ error: 'You do not have permission to add crew to this vessel' }, 403);

    const departmentId = body?.departmentId || null;
    const roleId = body?.roleId || null;
    const customRoleId = body?.customRoleId || null;
    const startDate: string | null = body?.startDate || null;
    const tier = TIERS.includes(body?.permissionTier) ? body.permissionTier : 'CREW';
    // tenant_members.role / role_legacy predate permission_tier and are still
    // read in places; keep them consistent with how invites derive them.
    const legacyRole = tier === 'COMMAND' ? 'CHIEF' : (tier === 'CHIEF' || tier === 'HOD' ? tier : 'CREW');

    const [first, ...rest] = fullName.split(/\s+/);

    // 1. The auth user — no password, unroutable address, so no way in.
    const placeholder = `roster+${crypto.randomUUID()}@${PLACEHOLDER_DOMAIN}`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: placeholder,
      email_confirm: false,
      user_metadata: { full_name: fullName, roster_only: true },
      app_metadata: { roster_only: true },
    });
    const newUserId = created?.user?.id;
    if (createErr || !newUserId) {
      console.error('[rosterCrew] createUser failed', createErr);
      return json({ error: createErr?.message || 'Failed to create the crew record' }, 502);
    }

    // 2. The profile. handle_new_user() has already inserted the row from the
    //    auth record — blank the placeholder address back out so it can never
    //    reach the UI or an export, and flag them as login-less.
    const { error: profileErr } = await admin
      .from('profiles')
      .update({
        email: null,
        full_name: fullName,
        first_name: first || null,
        last_name: rest.length ? rest.join(' ') : null,
        roster_only: true,
        department_id: departmentId,
        role_id: roleId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', newUserId);
    if (profileErr) {
      console.error('[rosterCrew] profile update failed', profileErr);
      await admin.auth.admin.deleteUser(newUserId);
      return json({ error: profileErr.message || 'Failed to save the crew profile' }, 502);
    }

    // 3. Membership. A future start date shows them as "Invited" until it
    //    arrives, same as an emailed invite with a start date.
    const today = new Date().toISOString().slice(0, 10);
    const { error: memberErr } = await admin.from('tenant_members').insert({
      tenant_id: tenantId,
      user_id: newUserId,
      department_id: departmentId,
      role_id: roleId,
      custom_role_id: customRoleId,
      permission_tier: tier,
      role: legacyRole,
      role_legacy: legacyRole,
      display_name: fullName,
      active: true,
      status: startDate && startDate > today ? 'invited' : 'active',
      start_date: startDate,
      joined_at: new Date().toISOString(),
    });
    if (memberErr) {
      console.error('[rosterCrew] tenant_members insert failed', memberErr);
      await admin.auth.admin.deleteUser(newUserId); // cascades the profile row
      return json({ error: memberErr.message || 'Failed to add them to the vessel' }, 502);
    }

    return json({ success: true, userId: newUserId });
  }

  // ── Give a roster crew member their login ─────────────────────────────────
  if (action === 'activate') {
    const inviteToken = String(body?.token || '');
    const password = String(body?.password || '');
    const fullName = String(body?.fullName || '').trim();
    if (!inviteToken) return json({ error: 'token is required' }, 400);
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    const { data: invite, error: inviteErr } = await admin
      .from('crew_invites')
      .select('id, email, tenant_id, status, expires_at, roster_user_id, department_id, role_id, custom_role_id, permission_tier, invited_role, start_date')
      .eq('token', inviteToken)
      .maybeSingle();

    if (inviteErr) {
      console.error('[rosterCrew] invite lookup failed', inviteErr);
      return json({ error: 'Could not load the invite' }, 502);
    }
    if (!invite || invite.status !== 'PENDING') return json({ error: 'Invite invalid, expired, or already used' }, 400);
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return json({ error: 'Invite invalid, expired, or already used' }, 400);
    if (!invite.roster_user_id) return json({ error: 'This invite is not for an existing crew member' }, 400);
    if (!isEmail(invite.email)) return json({ error: 'This invite has no valid email address' }, 400);

    const userId: string = invite.roster_user_id;
    const email: string = invite.email.toLowerCase().trim();

    // Attach the real credentials to the record they already have. Confirmed
    // on the spot: the vessel vouched for them by inviting them, and they
    // proved they hold the invite link.
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      email,
      password,
      email_confirm: true,
      user_metadata: { ...(fullName ? { full_name: fullName } : {}), roster_only: false },
      app_metadata: { roster_only: false },
    });
    if (updateErr) {
      console.error('[rosterCrew] updateUserById failed', updateErr);
      const taken = /already|exists|registered/i.test(updateErr.message || '');
      return json({
        error: taken
          ? 'An account with this email already exists. Ask your vessel admin to invite you on a different address.'
          : (updateErr.message || 'Failed to set up your login'),
      }, taken ? 409 : 502);
    }

    const { error: profileErr } = await admin
      .from('profiles')
      .update({
        email,
        roster_only: false,
        ...(fullName ? { full_name: fullName } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (profileErr) console.warn('[rosterCrew] profile update after activation failed', profileErr);

    // Fill any employment detail the roster row was missing, and clear an
    // "invited" holding status now that they're really aboard.
    const { data: member } = await admin
      .from('tenant_members')
      .select('department_id, role_id, custom_role_id, permission_tier, status, start_date')
      .eq('tenant_id', invite.tenant_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (member) {
      const today = new Date().toISOString().slice(0, 10);
      const startDate = member.start_date || invite.start_date || null;
      const patch: Record<string, unknown> = {
        department_id: member.department_id ?? invite.department_id,
        permission_tier: member.permission_tier ?? invite.permission_tier,
        start_date: startDate,
        status: startDate && startDate > today ? 'invited' : 'active',
        active: true,
        updated_at: new Date().toISOString(),
      };
      if (!member.role_id && !member.custom_role_id) {
        patch.role_id = invite.role_id;
        patch.custom_role_id = invite.custom_role_id;
      }
      const { error: memberErr } = await admin
        .from('tenant_members')
        .update(patch)
        .eq('tenant_id', invite.tenant_id)
        .eq('user_id', userId);
      if (memberErr) console.warn('[rosterCrew] membership top-up failed', memberErr);
    } else {
      // Roster row was removed between invite and acceptance — put it back so
      // they aren't left with an account and no vessel.
      const { error: reinstateErr } = await admin.from('tenant_members').insert({
        tenant_id: invite.tenant_id,
        user_id: userId,
        department_id: invite.department_id,
        role_id: invite.role_id,
        custom_role_id: invite.custom_role_id,
        permission_tier: invite.permission_tier || 'CREW',
        role: invite.invited_role || 'CREW',
        role_legacy: invite.invited_role || 'CREW',
        active: true,
        status: 'active',
        start_date: invite.start_date,
      });
      if (reinstateErr) console.warn('[rosterCrew] membership reinstate failed', reinstateErr);
    }

    const { error: acceptErr } = await admin
      .from('crew_invites')
      .update({ status: 'ACCEPTED', accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq('id', invite.id);
    if (acceptErr) console.warn('[rosterCrew] invite status update failed', acceptErr);

    await admin.from('profiles').update({ last_active_tenant_id: invite.tenant_id }).eq('id', userId);

    return json({ success: true, userId, email, tenantId: invite.tenant_id });
  }

  return json({ error: 'unknown action' }, 400);
});
