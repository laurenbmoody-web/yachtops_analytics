// Netlify Function: save-manual-registration
//
// Persists a manual vessel registration (no IMO) into vessel_registrations
// and returns the inserted row's id. Called from the pricing page when the
// user chose "my vessel doesn't have an IMO number" or fell back to manual
// entry after a failed IMO lookup.
//
// The returned registration_id is then threaded through the Stripe checkout
// flow exactly the same way verify-vessel's row is — the stripe-webhook
// handler already tolerates imo_number being null (see lines ~112, ~127 of
// stripe-webhook.js), so no downstream changes are needed.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* ─── Pricing tier logic ──────────────────────────────────────────────── */

function getPricingTier(loa) {
  if (loa < 40) return 'under_40m';
  if (loa <= 80) return '40_80m';
  return 'over_80m';
}

/* ─── Supabase helper ─────────────────────────────────────────────────── */

async function supaInsert(path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      // We need the inserted row back so we can return its id to the client.
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
}

/* ─── Handler ─────────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('save-manual-registration: missing Supabase env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server misconfigured — please contact support.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const vesselName = String(payload.vessel_name || '').trim();
  const loa = Number(payload.loa_metres);
  const vesselType = String(payload.vessel_type || '').trim() || null;

  // Lightweight validation — the frontend already guards against most of
  // this, but we re-check here so a direct API hit can't persist garbage.
  if (!vesselName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'vessel_name is required' }) };
  }
  if (!Number.isFinite(loa) || loa <= 0 || loa > 200) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'loa_metres must be a positive number up to 200' }),
    };
  }

  const pricingTier = getPricingTier(loa);

  // Shape mirrors verify-vessel.cacheVesselResult so stripe-webhook reads
  // both kinds of rows identically. `loa_verified: false` is the signal
  // that this row came from a manual entry rather than an IMO lookup.
  const row = {
    imo_number: null,
    vessel_name: vesselName,
    loa_metres: loa,
    vessel_type: vesselType,
    flag_state: null,
    year_built: null,
    gross_tonnage: null,
    loa_verified: false,
    pricing_tier: pricingTier,
    api_response: { source: 'manual_entry' },
    verified_at: new Date().toISOString(),
  };

  try {
    const res = await supaInsert('vessel_registrations', row);
    if (!res.ok) {
      const body = await res.text();
      console.error('save-manual-registration insert failed:', res.status, body.slice(0, 300));
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Could not save your vessel details. Please try again or contact support.',
          debug: `supabase ${res.status}`,
        }),
      };
    }

    const rows = await res.json();
    const inserted = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!inserted?.id) {
      console.error('save-manual-registration: insert returned no row');
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Could not save your vessel details. Please try again or contact support.',
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        registration_id: inserted.id,
        pricing_tier: pricingTier,
      }),
    };
  } catch (err) {
    console.error('save-manual-registration error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Could not save your vessel details. Please try again or contact support.',
        debug: err?.message || String(err),
      }),
    };
  }
};
