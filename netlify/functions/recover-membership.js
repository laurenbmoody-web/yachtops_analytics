// Netlify Function: recover-membership
//
// Called from /onboarding when the user successfully set their password
// but the Stripe webhook failed to create their tenant_members row.
//
// Flow:
//   1. Validates the caller's Supabase JWT to get their user ID + email
//   2. Checks if they already have a tenant_members row — if yes, returns 200 (no-op)
//   3. Looks up vessel_registrations by email to find the converted tenant
//   4. Fetches the Captain/COMMAND role (same as createTenantMember in stripe-webhook)
//   5. Inserts the tenant_members row
//   6. Sets profiles.last_active_tenant_id
//
// Input: none (uses Authorization: Bearer <supabase-jwt> from the browser session)
// Output: { ok: true, tenantId }  |  { error: string }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function supaRest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

async function supaAuth(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

// Validate the caller's JWT and return their user record.
async function getCallerUser(jwt) {
  const res = await supaAuth('user', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // Extract the caller's JWT from the Authorization header.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing authorization token' }) };
  }

  try {
    // 1. Validate JWT and get caller identity
    const caller = await getCallerUser(jwt);
    if (!caller?.id || !caller?.email) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }
    const userId = caller.id;
    const email = caller.email;

    // 2. Check if tenant_members row already exists — if so, return early.
    const existingRes = await supaRest(
      `tenant_members?user_id=eq.${encodeURIComponent(userId)}&limit=1&select=tenant_id`,
      { method: 'GET' }
    );
    if (existingRes.ok) {
      const existing = await existingRes.json();
      if (existing?.length > 0) {
        console.log(`[recover-membership] user ${userId} already has membership ${existing[0].tenant_id}`);
        return {
          statusCode: 200,
          body: JSON.stringify({ ok: true, tenantId: existing[0].tenant_id, alreadyExisted: true }),
        };
      }
    }

    // 3. Find the tenant for this user. Three lookup strategies in order:
    //    a) vessel_registrations by email with tenant_id set (normal case)
    //    b) tenants.current_admin_user_id = userId (set by webhook step 2b)
    //    c) vessel_registrations by email without tenant_id filter + tenants by imo_number
    let tenantId = null;
    let fullName = '';

    // Strategy A: registration has been converted
    const regRes = await supaRest(
      `vessel_registrations?contact_email=eq.${encodeURIComponent(email)}&tenant_id=not.is.null&order=converted_at.desc&limit=1&select=tenant_id,contact_name`,
      { method: 'GET' }
    );
    if (regRes.ok) {
      const regs = await regRes.json();
      if (regs?.[0]?.tenant_id) {
        tenantId = regs[0].tenant_id;
        fullName = regs[0].contact_name || '';
      }
    }

    // Strategy B: tenant stamped with current_admin_user_id (set by webhook after inviteUser)
    if (!tenantId) {
      const tenantByAdminRes = await supaRest(
        `tenants?current_admin_user_id=eq.${encodeURIComponent(userId)}&status=eq.ACTIVE&order=created_at.desc&limit=1&select=id`,
        { method: 'GET' }
      );
      if (tenantByAdminRes.ok) {
        const tenants = await tenantByAdminRes.json();
        if (tenants?.[0]?.id) tenantId = tenants[0].id;
      }
    }

    // Strategy C: unconverted registration → look up tenant by IMO number
    if (!tenantId) {
      const anyRegRes = await supaRest(
        `vessel_registrations?contact_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1&select=imo_number,contact_name`,
        { method: 'GET' }
      );
      if (anyRegRes.ok) {
        const anyRegs = await anyRegRes.json();
        if (anyRegs?.[0]) {
          fullName = anyRegs[0].contact_name || '';
          const imoNumber = anyRegs[0].imo_number;
          if (imoNumber) {
            const tenantByImoRes = await supaRest(
              `tenants?imo_number=eq.${encodeURIComponent(imoNumber)}&order=created_at.desc&limit=1&select=id`,
              { method: 'GET' }
            );
            if (tenantByImoRes.ok) {
              const imoTenants = await tenantByImoRes.json();
              if (imoTenants?.[0]?.id) tenantId = imoTenants[0].id;
            }
          }
        }
      }
    }

    if (!tenantId) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Could not locate your vessel account. The signup webhook may not have completed. Please contact support.',
        }),
      };
    }

    // 4. Look up Captain/COMMAND role (same as stripe-webhook createTenantMember).
    const roleRes = await supaRest(
      `roles?name=eq.Captain&default_permission_tier=eq.COMMAND&select=id,department_id&limit=1`,
      { method: 'GET' }
    );
    if (!roleRes.ok) {
      const body = await roleRes.text();
      throw new Error(`roles lookup failed: ${roleRes.status} ${body.slice(0, 200)}`);
    }
    const roles = await roleRes.json();
    if (!roles?.[0]) {
      throw new Error('No Captain/COMMAND role found in public.roles');
    }
    const captain = roles[0];

    // 5. Insert tenant_members row.
    const memberRes = await supaRest('tenant_members', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tenant_id: tenantId,
        user_id: userId,
        role: 'COMMAND',
        role_legacy: 'COMMAND',
        permission_tier: 'COMMAND',
        role_id: captain.id,
        department_id: captain.department_id,
        active: true,
        status: 'ACTIVE',
      }),
    });
    if (!memberRes.ok) {
      const body = await memberRes.text();
      // 409 = already exists (race) — treat as success.
      if (memberRes.status !== 409) {
        throw new Error(`tenant_members insert failed: ${memberRes.status} ${body.slice(0, 300)}`);
      }
    }

    // 6. Set profiles.last_active_tenant_id so bootstrap takes Path 1 next time.
    await supaRest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ last_active_tenant_id: tenantId }),
    });

    // 7. Ensure profile has account_type set.
    await supaRest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ full_name: fullName || undefined, account_type: 'VESSEL_ADMIN' }),
    });

    console.log(`[recover-membership] created tenant_members for user ${userId} → tenant ${tenantId}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, tenantId }),
    };
  } catch (err) {
    console.error('[recover-membership] error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message || 'Recovery failed. Please contact support.' }),
    };
  }
};
