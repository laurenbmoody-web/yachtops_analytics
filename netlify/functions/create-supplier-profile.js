// Netlify Function: create-supplier-profile
//
// Called from /supplier/signup immediately after supabase.auth.signUp().
// Because email confirmation may be required, the user has no active session
// yet when we need to insert supplier_profiles + supplier_contacts. This
// function runs with the service role key and bypasses RLS.
//
// Input (POST body JSON):
//   { userId, companyName, contactName, email, phone?, ports[], categories[] }
//
// Output:
//   { ok: true, supplierId }  |  { error: string }

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

async function supaAuthAdmin(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { userId, companyName, contactName, email, phone, ports, categories } = body;

  if (!userId || !companyName || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'userId, companyName, and email are required' }) };
  }

  try {
    // 1. Create supplier_profiles row
    const profileRes = await supaRest('supplier_profiles', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        name: companyName,
        contact_email: email,
        contact_phone: phone || null,
        coverage_ports: Array.isArray(ports) ? ports : [],
        categories: Array.isArray(categories) ? categories : [],
      }),
    });

    if (!profileRes.ok) {
      const errText = await profileRes.text();
      throw new Error(`supplier_profiles insert failed: ${profileRes.status} ${errText.slice(0, 300)}`);
    }

    const profiles = await profileRes.json();
    const supplier = Array.isArray(profiles) ? profiles[0] : profiles;
    if (!supplier?.id) {
      throw new Error('supplier_profiles insert returned no id');
    }

    // 2. Create supplier_contacts row
    const contactRes = await supaRest('supplier_contacts', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        supplier_id: supplier.id,
        user_id: userId,
        role: 'owner',
        name: contactName || null,
        email: email,
        phone: phone || null,
      }),
    });

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      // Non-fatal — profile created, contact failed; log and continue
      console.error(`[create-supplier-profile] supplier_contacts insert failed: ${contactRes.status} ${errText.slice(0, 200)}`);
    }

    // 3. Update auth user metadata with user_type + supplier_id (service role admin)
    const metaRes = await supaAuthAdmin(`users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        user_metadata: {
          user_type: 'supplier',
          supplier_id: supplier.id,
        },
      }),
    });

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      // Non-fatal — supplier created; metadata update can be retried
      console.error(`[create-supplier-profile] metadata update failed: ${metaRes.status} ${errText.slice(0, 200)}`);
    }

    console.log(`[create-supplier-profile] created supplier ${supplier.id} for user ${userId}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, supplierId: supplier.id }),
    };

  } catch (err) {
    console.error('[create-supplier-profile] error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message || 'Failed to create supplier profile' }),
    };
  }
};
