// Netlify Function: create-checkout-session
//
// Creates a Stripe Checkout Session for a verified vessel lead and returns
// the hosted-checkout URL. The frontend redirects the user there after they
// confirm their tier and pick monthly vs annual.
//
// Input: {
//   vessel_registration_id: string,
//   billing_period: 'monthly' | 'annual',
//   contact?: { name?, role?, email?, phone? }  // optional — patched onto the
//                                                  registration row before checkout
// }
//
// Environment variables required:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_PRICE_UNDER_40M_MONTHLY
//   STRIPE_PRICE_UNDER_40M_ANNUAL
//   STRIPE_PRICE_40_80M_MONTHLY
//   STRIPE_PRICE_40_80M_ANNUAL
//   STRIPE_PRICE_OVER_80M_MONTHLY
//   STRIPE_PRICE_OVER_80M_ANNUAL
//   SITE_URL (e.g. https://cargotechnology.netlify.app) — used for success/cancel URLs

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://cargotechnology.netlify.app';

// Price ID map: { tier: { monthly, annual } }
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

/* ─── Supabase helpers ────────────────────────────────────────────────── */

async function supabaseGet(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase GET ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// PATCH a partial row and return the updated representation. Used to stamp
// contact fields onto the vessel_registrations row just before checkout, so
// the webhook has everything it needs to provision the tenant.
async function supabasePatch(path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase PATCH ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/* ─── Stripe helper (raw form-encoded API — no SDK dependency) ────────── */

// Stripe's REST API accepts application/x-www-form-urlencoded with bracketed
// keys for nested objects. Using the raw API avoids pulling in the stripe
// package at function-cold-start cost. If we later want more Stripe surface
// area, swap to the official SDK.
function encodeForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      parts.push(encodeForm(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(encodeForm(item, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
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
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

/* ─── Handler ─────────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Fail fast if any of the core secrets are missing — gives a clear error in
  // the Netlify logs rather than a cryptic Stripe 401 later.
  if (!STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Payments not configured.' }) };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env vars not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Backend not configured.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { vessel_registration_id, billing_period, contact } = body;

  if (!vessel_registration_id || typeof vessel_registration_id !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'vessel_registration_id is required' }) };
  }
  if (!['monthly', 'annual'].includes(billing_period)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'billing_period must be monthly or annual' }) };
  }

  try {
    // 1. Load the registration row
    const rows = await supabaseGet(
      `vessel_registrations?id=eq.${encodeURIComponent(vessel_registration_id)}&select=*&limit=1`
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Vessel registration not found' }) };
    }
    let registration = rows[0];

    // 2. Refuse if this row has already been converted to a tenant — defence
    //    in depth against double-subscribing. The /pricing flow also blocks
    //    existing tenants earlier via verify-vessel, but belt-and-braces.
    if (registration.converted_at || registration.tenant_id) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'This vessel is already a Cargo customer. Please log in instead.',
        }),
      };
    }

    // 3. If the caller passed contact info, stamp it onto the row now so the
    //    webhook has name/role/email/phone to provision the tenant. The
    //    /pricing questionnaire collects these in step 3 but doesn't persist
    //    them until checkout — this is where they land.
    if (contact && typeof contact === 'object') {
      const patch = {};
      if (typeof contact.name === 'string' && contact.name.trim()) patch.contact_name = contact.name.trim();
      if (typeof contact.role === 'string' && contact.role.trim()) patch.contact_role = contact.role.trim();
      if (typeof contact.email === 'string' && contact.email.trim()) patch.contact_email = contact.email.trim();
      if (typeof contact.phone === 'string' && contact.phone.trim()) patch.contact_phone = contact.phone.trim();
      if (Object.keys(patch).length > 0) {
        try {
          const updated = await supabasePatch(
            `vessel_registrations?id=eq.${encodeURIComponent(registration.id)}`,
            patch
          );
          if (updated) registration = updated;
        } catch (patchErr) {
          console.error('Contact patch failed:', patchErr?.message || patchErr);
          // Fall through — if the PATCH failed we may still have enough info
          // on the existing row. The validations below will catch gaps.
        }
      }
    }

    // 4. Validate we have the contact email and pricing tier the webhook needs
    if (!registration.contact_email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Registration is missing contact email' }) };
    }
    if (!registration.pricing_tier || !PRICE_IDS[registration.pricing_tier]) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Registration has no valid pricing tier' }) };
    }

    // 5. Look up the right Stripe price ID
    const priceId = PRICE_IDS[registration.pricing_tier][billing_period];
    if (!priceId) {
      console.error(
        `Missing Stripe price ID for tier=${registration.pricing_tier} billing_period=${billing_period}`
      );
      return { statusCode: 500, body: JSON.stringify({ error: 'Pricing not configured for this plan.' }) };
    }

    // 6. Create the Checkout Session. client_reference_id ties the checkout
    //    back to the registration row in the webhook. metadata is a redundant
    //    safety net in case client_reference_id is ever lost.
    const session = await stripeCreateCheckoutSession({
      mode: 'subscription',
      customer_email: registration.contact_email,
      client_reference_id: registration.id,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: `${SITE_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout?cancelled=1&vr=${registration.id}`,
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      'metadata[vessel_registration_id]': registration.id,
      'metadata[imo]': registration.imo_number || '',
      'metadata[vessel_name]': registration.vessel_name || '',
      'metadata[pricing_tier]': registration.pricing_tier,
      'metadata[billing_period]': billing_period,
      'metadata[contact_name]': registration.contact_name || '',
      'metadata[contact_role]': registration.contact_role || '',
      'subscription_data[metadata][vessel_registration_id]': registration.id,
      'subscription_data[metadata][imo]': registration.imo_number || '',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url, id: session.id }),
    };
  } catch (err) {
    console.error('create-checkout-session error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Could not create checkout session. Please try again.',
        debug: err?.message || String(err),
      }),
    };
  }
};
