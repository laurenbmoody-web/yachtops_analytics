// Netlify Function: create-upgrade-checkout-session
//
// An existing vessel (free trial / no paid plan) upgrades to a paid plan from
// inside the app (/membership). Verifies the caller is the vessel admin, then
// creates a Stripe Checkout Session (subscription) tied to the EXISTING tenant.
// The stripe-webhook stamps the plan onto that tenant on completion — no new
// tenant is created (that path is only for brand-new /checkout leads).
//
// Input (POST, Authorization: Bearer <supabase access token>):
//   { tenant_id: string, tier: 'under_40m'|'40_80m'|'over_80m',
//     billing_period: 'monthly'|'annual' }
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL,
//      STRIPE_PRICE_* (same six price IDs as create-checkout-session)

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://cargotechnology.netlify.app';

const PRICE_IDS = {
  under_40m: {
    monthly: process.env.STRIPE_PRICE_UNDER_40M_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_UNDER_40M_ANNUAL || '',
  },
  '40_80m': {
    monthly: process.env.STRIPE_PRICE_40_80M_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_40_80M_ANNUAL || '',
  },
  over_80m: {
    monthly: process.env.STRIPE_PRICE_OVER_80M_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_OVER_80M_ANNUAL || '',
  },
};

function encodeForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      parts.push(encodeForm(v, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripeCreateCheckoutSession(params) {
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
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

async function getTenant(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tenants?id=eq.${encodeURIComponent(id)}&select=id,name,current_admin_user_id,stripe_customer_id,subscription_status,plan_tier&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!STRIPE_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Payments not configured.' }) };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Backend not configured.' }) };

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const { tenant_id, tier, billing_period } = body;

  if (!tenant_id) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_id is required' }) };
  if (!PRICE_IDS[tier]) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown plan tier' }) };
  if (!['monthly', 'annual'].includes(billing_period)) return { statusCode: 400, body: JSON.stringify({ error: 'billing_period must be monthly or annual' }) };

  try {
    const user = await getUserFromToken(token);
    const uid = user?.id;
    if (!uid) return { statusCode: 401, body: JSON.stringify({ error: 'Session expired — please sign in again.' }) };

    const tenant = await getTenant(tenant_id);
    if (!tenant) return { statusCode: 404, body: JSON.stringify({ error: 'Vessel not found' }) };
    if (tenant.current_admin_user_id !== uid) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Only the vessel admin can change the plan.' }) };
    }
    if (tenant.subscription_status === 'active' && tenant.plan_tier) {
      // Already on a paid plan — plan changes go through the billing portal.
      return { statusCode: 409, body: JSON.stringify({ error: 'already_active' }) };
    }

    const priceId = PRICE_IDS[tier][billing_period];
    if (!priceId) return { statusCode: 500, body: JSON.stringify({ error: 'Pricing not configured for this plan.' }) };

    const params = {
      mode: 'subscription',
      client_reference_id: tenant_id,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: `${SITE_URL}/membership?upgraded=1`,
      cancel_url: `${SITE_URL}/membership?cancelled=1`,
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      'metadata[upgrade]': '1',
      'metadata[tenant_id]': tenant_id,
      'metadata[pricing_tier]': tier,
      'metadata[billing_period]': billing_period,
      'subscription_data[metadata][upgrade]': '1',
      'subscription_data[metadata][tenant_id]': tenant_id,
    };
    // Reuse the existing Stripe customer if the vessel already has one; else
    // let Stripe create one from the admin's email.
    if (tenant.stripe_customer_id) params.customer = tenant.stripe_customer_id;
    else if (user?.email) params.customer_email = user.email;

    const session = await stripeCreateCheckoutSession(params);
    return { statusCode: 200, body: JSON.stringify({ url: session.url, id: session.id }) };
  } catch (err) {
    console.error('create-upgrade-checkout-session error:', err?.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start the upgrade. Please try again.' }) };
  }
};
