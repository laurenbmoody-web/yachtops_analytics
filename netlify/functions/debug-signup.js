// Netlify Function: debug-signup
//
// Diagnostic endpoint that reports the full state of a signup by email.
// Given a contact email (via ?email=), returns:
//   - the vessel_registrations row (if any)
//   - whether it's been converted (tenant_id / converted_at)
//   - the tenants row (if any)
//   - the auth.users row (if any)
//   - the tenant_members row (if any)
//   - the profiles row (if any)
//
// This is for diagnosing "I signed up but didn't get an email" without
// having to dig through Supabase dashboard. Gated behind DEBUG_SECRET
// so nobody can probe signups publicly — pass ?secret=XXX matching the
// DEBUG_SECRET env var on Netlify.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEBUG_SECRET = process.env.DEBUG_SECRET || '';

async function supaRest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function supaAuth(path, options = {}) {
  const url = `${SUPABASE_URL}/auth/v1/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function findRegistration(email) {
  // PostgREST ilike with wildcards so plus-addressed hits exact match too.
  const res = await supaRest(
    `vessel_registrations?contact_email=ilike.${encodeURIComponent(email)}&order=created_at.desc&limit=1`,
    { method: 'GET' }
  );
  if (!res.ok) return { error: `${res.status} ${await res.text()}`.slice(0, 200) };
  const rows = await res.json();
  return rows[0] || null;
}

async function findTenantById(tenantId) {
  if (!tenantId) return null;
  const res = await supaRest(`tenants?id=eq.${tenantId}&select=*&limit=1`, { method: 'GET' });
  if (!res.ok) return { error: `${res.status}`.slice(0, 100) };
  const rows = await res.json();
  return rows[0] || null;
}

async function findAuthUser(email) {
  const res = await supaAuth(`admin/users?email=${encodeURIComponent(email)}`, { method: 'GET' });
  if (!res.ok) return { error: `${res.status} ${await res.text()}`.slice(0, 200) };
  const data = await res.json();
  const users = Array.isArray(data?.users) ? data.users : (data?.users ? [data.users] : []);
  if (users.length === 0) return null;
  const u = users[0];
  return {
    id: u.id,
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    invited_at: u.invited_at,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    confirmation_sent_at: u.confirmation_sent_at,
    recovery_sent_at: u.recovery_sent_at,
  };
}

async function findProfile(userId) {
  if (!userId) return null;
  const res = await supaRest(`profiles?id=eq.${userId}&select=*&limit=1`, { method: 'GET' });
  if (!res.ok) return { error: `${res.status}`.slice(0, 100) };
  const rows = await res.json();
  return rows[0] || null;
}

async function findTenantMember(userId, tenantId) {
  if (!userId || !tenantId) return null;
  const res = await supaRest(
    `tenant_members?user_id=eq.${userId}&tenant_id=eq.${tenantId}&select=*&limit=1`,
    { method: 'GET' }
  );
  if (!res.ok) return { error: `${res.status}`.slice(0, 100) };
  const rows = await res.json();
  return rows[0] || null;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const email = (params.email || '').trim().toLowerCase();
  const secret = params.secret || '';

  if (!DEBUG_SECRET || secret !== DEBUG_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email query param required' }) };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'server misconfigured' }) };
  }

  try {
    const registration = await findRegistration(email);
    const tenantId = registration?.tenant_id || null;
    const tenant = tenantId ? await findTenantById(tenantId) : null;
    const authUser = await findAuthUser(email);
    const profile = authUser?.id ? await findProfile(authUser.id) : null;
    const tenantMember = (authUser?.id && tenantId) ? await findTenantMember(authUser.id, tenantId) : null;

    const summary = {
      email,
      registration_exists: !!registration && !registration.error,
      registration_converted: !!(registration?.tenant_id && registration?.converted_at),
      tenant_exists: !!tenant && !tenant.error,
      auth_user_exists: !!authUser && !authUser.error,
      profile_exists: !!profile && !profile.error,
      tenant_member_exists: !!tenantMember && !tenantMember.error,
      invite_email_sent: !!(authUser?.invited_at || authUser?.confirmation_sent_at),
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          summary,
          registration,
          tenant,
          auth_user: authUser,
          profile,
          tenant_member: tenantMember,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error('debug-signup error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message || String(err) }),
    };
  }
};
