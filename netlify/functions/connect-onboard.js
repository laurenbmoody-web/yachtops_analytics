// Netlify Function: connect-onboard
//
// Supplier-portal "Connect Stripe" → onboard the supplier to Stripe Connect
// (Express) so they can accept card payments. Creates the connected account
// once (stored on supplier_profiles.stripe_account_id), then returns a fresh
// Account Link the supplier is redirected to for Stripe-hosted onboarding/KYC.
//
// Direct charges on this account (merchant of record = supplier) need the
// card_payments + transfers capabilities, requested here.
//
// Input (POST, Authorization: Bearer <supabase access token>): {} (caller is
//   resolved to their supplier via supplier_contacts).
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://cargotechnology.netlify.app';

function encodeForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) parts.push(encodeForm(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.filter(Boolean).join('&');
}

async function stripePost(path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-11-20.acacia',
    },
    body: encodeForm(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

async function getUserFromToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`REST GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST PATCH ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!STRIPE_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Payments not configured.' }) };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Backend not configured.' }) };

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };

  try {
    const user = await getUserFromToken(token);
    const uid = user?.id;
    if (!uid) return { statusCode: 401, body: JSON.stringify({ error: 'Session expired — please sign in again.' }) };

    // Resolve caller → their supplier (active contact).
    const contacts = await restGet(`supplier_contacts?user_id=eq.${uid}&active=eq.true&select=supplier_id&limit=1`);
    const supplierId = contacts?.[0]?.supplier_id;
    if (!supplierId) return { statusCode: 403, body: JSON.stringify({ error: 'No active supplier for this account.' }) };

    const suppliers = await restGet(
      `supplier_profiles?id=eq.${supplierId}&select=id,name,business_country,contact_email,stripe_account_id,stripe_charges_enabled`
    );
    const supplier = suppliers?.[0];
    if (!supplier) return { statusCode: 404, body: JSON.stringify({ error: 'Supplier not found.' }) };

    // Create the Express account once; reuse it afterwards.
    let accountId = supplier.stripe_account_id;
    if (!accountId) {
      const params = {
        type: 'express',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        'business_profile[name]': supplier.name || 'Supplier',
        'metadata[supplier_id]': supplierId,
        'metadata[cargo]': 'supplier-connect',
      };
      // ISO-3166 alpha-2 country when we have it; else Stripe uses the platform country.
      if (/^[A-Za-z]{2}$/.test(supplier.business_country || '')) params.country = String(supplier.business_country).toUpperCase();
      if (supplier.contact_email) params.email = supplier.contact_email;

      const account = await stripePost('accounts', params);
      accountId = account.id;
      await restPatch(`supplier_profiles?id=eq.${supplierId}`, { stripe_account_id: accountId });
    }

    // A one-time onboarding link (short-lived) for the Stripe-hosted flow.
    const link = await stripePost('account_links', {
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${SITE_URL}/supplier/workspace/payment?stripe=refresh`,
      return_url: `${SITE_URL}/supplier/workspace/payment?stripe=return`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: link.url, account_id: accountId }) };
  } catch (err) {
    console.error('connect-onboard error:', err?.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start Stripe onboarding. Please try again.' }) };
  }
};
