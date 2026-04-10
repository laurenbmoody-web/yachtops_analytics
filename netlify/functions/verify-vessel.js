// Netlify Function: verify-vessel
//
// Looks up a vessel by IMO number using the Anthropic API with web search.
// Called from the pricing page questionnaire to verify vessel details
// and determine the correct pricing tier based on LOA.
//
// Requires ANTHROPIC_API_KEY env var in Netlify.
//
// Also caches results in Supabase vessel_registrations table (90-day TTL).
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* ─── Pricing tier logic ──────────────────────────────────────────────── */

function getPricingTier(loa) {
  if (loa < 40) return 'under_40m';
  if (loa <= 80) return '40_80m';
  return 'over_80m';
}

function getTierLabel(tier) {
  switch (tier) {
    case 'under_40m': return 'Under 40m — £179/month';
    case '40_80m': return '40 – 80m — £279/month';
    case 'over_80m': return 'Over 80m — £399/month';
    default: return tier;
  }
}

/* ─── Supabase helpers ────────────────────────────────────────────────── */

async function supabaseQuery(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': options.method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
        ...(options.headers || {}),
      },
    });
    return res;
  } catch (err) {
    console.error('Supabase query error:', err);
    return null;
  }
}

async function getCachedVessel(imo) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const res = await supabaseQuery(
    `vessel_registrations?imo_number=eq.${imo}&verified_at=gte.${cutoff}&select=*&limit=1`,
    { method: 'GET' }
  );
  if (!res || !res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

// Check whether an IMO is already linked to a live Cargo tenant. If so, we
// short-circuit the pricing flow and tell the user to log in instead of
// taking them through the sign-up path a second time.
//
// Robustness note: the vessel-settings form lets users type the IMO freely,
// and its placeholder is "e.g., IMO 1234567" — so existing tenant rows in
// production store values like "IMO 9740677", "9740677", "imo9740677",
// "IMO# 9740677", etc. An `eq` query against the raw 7-digit string misses
// all of those. Instead we pull any tenant whose imo_number *contains* the
// digits and then post-filter by exact-digit match on the server side.
async function getExistingTenantByImo(imo) {
  if (!imo) return null;
  const digits = String(imo).replace(/\D/g, '');
  if (digits.length !== 7) return null;

  // PostgREST converts `*` → SQL `%`. `ilike.*9740677*` matches any stored
  // value that contains those 7 digits anywhere in the string.
  const res = await supabaseQuery(
    `tenants?imo_number=ilike.*${digits}*&select=id,name,imo_number&limit=25`,
    { method: 'GET' }
  );
  if (!res || !res.ok) {
    console.error(`tenant imo lookup failed: ${res ? res.status : 'no-response'}`);
    return null;
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Guard against substring false positives — "19740677" would match the
  // ilike filter above, so we require the stored value to reduce to the
  // exact same 7 digits we queried for.
  const match = rows.find(
    (row) => String(row.imo_number || '').replace(/\D/g, '') === digits
  );
  return match || null;
}

async function cacheVesselResult(vessel, pricingTier) {
  await supabaseQuery('vessel_registrations', {
    method: 'POST',
    body: JSON.stringify({
      imo_number: vessel.imo,
      vessel_name: vessel.name,
      loa_metres: vessel.loa_metres,
      vessel_type: vessel.type,
      flag_state: vessel.flag,
      year_built: vessel.year_built,
      gross_tonnage: vessel.gross_tonnage || null,
      loa_verified: true,
      pricing_tier: pricingTier,
      api_response: vessel,
      verified_at: new Date().toISOString(),
    }),
  });
}

/* ─── Anthropic API call with web search ──────────────────────────────── */

async function lookupVessel(imo) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Look up the vessel with IMO number ${imo} using public maritime registries (Equasis, IMO GISIS, MarineTraffic, or any other public source).

Return ONLY a valid JSON object with these exact fields — no markdown, no code fences, no explanation:

{
  "found": true,
  "name": "vessel name as registered",
  "imo": "${imo}",
  "loa_metres": 72.5,
  "type": "Motor Yacht",
  "flag": "Cayman Islands",
  "year_built": 2014,
  "gross_tonnage": 2012
}

Rules:
- loa_metres must be a number in metres (not feet)
- type should be one of: Motor Yacht, Sailing Yacht, Explorer, Catamaran, or the registered vessel type
- If you cannot find a vessel with this IMO number, return ONLY: { "found": false }
- Return ONLY the JSON object, nothing else`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Anthropic API error:', response.status, errorBody);
    throw new Error(`Anthropic API ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();

  // Find the text block in the response content
  const textBlock = data.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('No text response from Anthropic API');
  }

  // Parse JSON — handle potential markdown code fences
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  return JSON.parse(jsonText);
}

/* ─── Main handler ────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured');
    return {
      statusCode: 500,
      body: JSON.stringify({ found: false, error: 'Server configuration error.' }),
    };
  }

  try {
    const { imo } = JSON.parse(event.body);

    // Validate IMO format (7 digits)
    if (!imo || typeof imo !== 'string' || !/^\d{7}$/.test(imo.trim())) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          found: false,
          error: 'Invalid IMO number. Must be exactly 7 digits.',
        }),
      };
    }

    const cleanIMO = imo.trim();

    // 0. Existing-tenant short-circuit.
    // If this IMO already belongs to a live tenant, don't push the user further
    // through the pricing flow — they're already a Cargo customer and should
    // log in instead. We do this before the cache/Anthropic lookup so existing
    // customers never hit those code paths (no wasted API spend, no duplicate
    // vessel_registrations rows).
    try {
      const existingTenant = await getExistingTenantByImo(cleanIMO);
      console.log(
        `existing-tenant check for IMO ${cleanIMO}: ${existingTenant ? `matched tenant "${existingTenant.name}" (stored as "${existingTenant.imo_number}")` : 'no match'}`
      );
      if (existingTenant) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            found: true,
            already_tenant: true,
            vessel: {
              name: existingTenant.name,
              imo: cleanIMO,
            },
          }),
        };
      }
    } catch (tenantErr) {
      // Don't fail the request if the tenant check errors — fall through to
      // the normal verification path so the user can still sign up.
      console.error('Existing-tenant check failed:', tenantErr);
    }

    // 1. Check cache first
    const cached = await getCachedVessel(cleanIMO);
    if (cached) {
      const tier = cached.pricing_tier || getPricingTier(cached.loa_metres);
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: true,
          vessel: {
            name: cached.vessel_name,
            imo: cached.imo_number,
            loa_metres: cached.loa_metres,
            type: cached.vessel_type,
            flag: cached.flag_state,
            year_built: cached.year_built,
            gross_tonnage: cached.gross_tonnage,
          },
          pricing_tier: tier,
          pricing_tier_label: getTierLabel(tier),
          cached: true,
        }),
      };
    }

    // 2. Look up via Anthropic API with web search
    const vesselData = await lookupVessel(cleanIMO);

    if (!vesselData.found) {
      return {
        statusCode: 200,
        body: JSON.stringify({ found: false }),
      };
    }

    // 3. Validate we got a LOA
    if (!vesselData.loa_metres || typeof vesselData.loa_metres !== 'number') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: true,
          vessel: vesselData,
          pricing_tier: null,
          error: 'Could not determine vessel length. Please enter manually.',
        }),
      };
    }

    // 4. Compute pricing tier
    const pricingTier = getPricingTier(vesselData.loa_metres);

    // 5. Cache the result
    try {
      await cacheVesselResult(vesselData, pricingTier);
    } catch (cacheErr) {
      console.error('Cache write failed:', cacheErr);
    }

    // 6. Return
    return {
      statusCode: 200,
      body: JSON.stringify({
        found: true,
        vessel: {
          name: vesselData.name,
          imo: cleanIMO,
          loa_metres: vesselData.loa_metres,
          type: vesselData.type,
          flag: vesselData.flag,
          year_built: vesselData.year_built,
          gross_tonnage: vesselData.gross_tonnage,
        },
        pricing_tier: pricingTier,
        pricing_tier_label: getTierLabel(pricingTier),
        cached: false,
      }),
    };

  } catch (err) {
    console.error('verify-vessel error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        found: false,
        error: 'Vessel lookup failed. Please try again or enter details manually.',
        debug: err?.message || String(err),
      }),
    };
  }
};
