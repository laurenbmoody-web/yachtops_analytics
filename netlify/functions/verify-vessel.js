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

// Normalise a vessel name for fuzzy comparison: lowercase, strip common
// prefixes like "M/Y", "S/Y", "MY", punctuation and whitespace. This lets
// us match "Belongers", "M/Y Belongers", "m/y  belongers!" and so on.
function normaliseVesselName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/^(m\/?y|s\/?y|m\/?v|y\/?t)[\s.]+/i, '')
    .replace(/[^a-z0-9]/g, '');
}

// Fallback tenant check: find a tenant whose name matches the canonical
// vessel name. Tenants ALWAYS have a name (required at signup), but
// imo_number is only populated if the user filled out vessel-settings,
// so many live tenants won't match on IMO alone.
async function getExistingTenantByName(vesselName) {
  const normalised = normaliseVesselName(vesselName);
  if (!normalised || normalised.length < 3) return null;

  // Pull all VESSEL-type tenants and filter locally. This table is small
  // (one row per customer vessel) so we can afford a full scan.
  const res = await supabaseQuery(
    `tenants?type=eq.VESSEL&select=id,name,imo_number&limit=500`,
    { method: 'GET' }
  );
  if (!res || !res.ok) {
    console.error(`tenant name lookup failed: ${res ? res.status : 'no-response'}`);
    return null;
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const match = rows.find(
    (row) => normaliseVesselName(row.name) === normalised
  );
  return match || null;
}

async function cacheVesselResult(vessel, pricingTier) {
  // Override the default `return=minimal` Prefer header so we get the newly
  // inserted row back — the checkout flow needs the registration id.
  const res = await supabaseQuery('vessel_registrations', {
    method: 'POST',
    headers: {
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
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
  if (!res || !res.ok) return null;
  try {
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

/* ─── Anthropic API call with web search ──────────────────────────────── */

// Tagged errors so the main handler can distinguish "try again in a minute"
// (rate limit) and "we couldn't parse the model's response" (prose instead
// of JSON) from generic 5xx crashes. Both should surface as 200 responses
// with a friendly message, not 500s — otherwise the frontend shows a scary
// red banner and the user can't progress.
class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
  }
}
class VesselLookupParseError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'VesselLookupParseError';
    this.raw = raw;
  }
}

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
    // 429 = rate limit, 529 = overloaded. Both are transient and should
    // tell the user "wait a minute and try again" instead of crashing.
    if (response.status === 429 || response.status === 529) {
      throw new RateLimitError(
        `Anthropic API ${response.status}: ${errorBody.slice(0, 200)}`
      );
    }
    throw new Error(`Anthropic API ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();

  // Find the text block in the response content
  const textBlock = data.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new VesselLookupParseError('No text response from Anthropic API', '');
  }

  // Parse JSON — handle potential markdown code fences
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // If the model returned prose instead of JSON (e.g. "Based on my search,
  // there is no public record of a vessel with IMO 1234567...") we don't
  // want to bubble a JSON.parse SyntaxError up to the user. Treat it the
  // same as "vessel not found" and surface the raw text in debug so we can
  // see what the model actually said.
  try {
    return JSON.parse(jsonText);
  } catch (parseErr) {
    console.error('vessel lookup JSON parse failed:', parseErr?.message, jsonText.slice(0, 200));
    throw new VesselLookupParseError(
      `Model returned non-JSON response: ${parseErr?.message || 'parse failed'}`,
      jsonText.slice(0, 300)
    );
  }
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

    // Diagnostics we surface in the response body under `debug` so we can
    // see what the tenant check did without having to hunt through Netlify
    // function logs (logs have been unreliable — empty when they shouldn't
    // be). Each step appends a note describing what was checked and why it
    // hit or missed.
    const debug = { steps: [] };

    // Helper: build a consistent "already on Cargo" response.
    const alreadyTenantResponse = (tenant, matchedVia) => {
      debug.steps.push(`matched tenant "${tenant.name}" via ${matchedVia}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: true,
          already_tenant: true,
          vessel: { name: tenant.name, imo: cleanIMO },
          debug,
        }),
      };
    };

    // 0a. Existing-tenant short-circuit by IMO.
    // Most accurate check but only works if the customer set imo_number in
    // vessel-settings — many live tenants will NOT have this populated,
    // which is why we also check by name below after we have the canonical
    // vessel name from cache or Anthropic.
    try {
      const tenantByImo = await getExistingTenantByImo(cleanIMO);
      debug.steps.push(
        tenantByImo
          ? `imo check: matched tenant "${tenantByImo.name}" (stored imo "${tenantByImo.imo_number}")`
          : `imo check: no tenant has imo_number matching ${cleanIMO}`
      );
      if (tenantByImo) return alreadyTenantResponse(tenantByImo, 'imo_match');
    } catch (tenantErr) {
      debug.steps.push(`imo check errored: ${tenantErr?.message || tenantErr}`);
      console.error('Existing-tenant (imo) check failed:', tenantErr);
    }

    // Helper: name-based tenant check used after we have the canonical
    // vessel name. Tenants always have a name (required at signup) so this
    // is the reliable path for customers who never filled in vessel
    // identity in settings.
    const checkTenantByName = async (name, source) => {
      try {
        const tenantByName = await getExistingTenantByName(name);
        debug.steps.push(
          tenantByName
            ? `name check (${source}="${name}"): matched tenant "${tenantByName.name}"`
            : `name check (${source}="${name}"): no tenant matched`
        );
        return tenantByName;
      } catch (err) {
        debug.steps.push(`name check (${source}) errored: ${err?.message || err}`);
        console.error(`Existing-tenant (name) check failed for ${source}:`, err);
        return null;
      }
    };

    // 1. Check cache
    const cached = await getCachedVessel(cleanIMO);
    if (cached) {
      // Re-run the tenant check using the canonical cached vessel name.
      const tenantByName = await checkTenantByName(cached.vessel_name, 'cache');
      if (tenantByName) return alreadyTenantResponse(tenantByName, 'name_match_cache');

      const tier = cached.pricing_tier || getPricingTier(cached.loa_metres);
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: true,
          registration_id: cached.id,
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
          debug,
        }),
      };
    }
    debug.steps.push('cache: miss');

    // 2. Look up via Anthropic API with web search
    const vesselData = await lookupVessel(cleanIMO);

    if (!vesselData.found) {
      return {
        statusCode: 200,
        body: JSON.stringify({ found: false, debug }),
      };
    }

    // 2b. Name-based tenant check using the canonical name from Anthropic.
    {
      const tenantByName = await checkTenantByName(vesselData.name, 'anthropic');
      if (tenantByName) return alreadyTenantResponse(tenantByName, 'name_match_anthropic');
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
          debug,
        }),
      };
    }

    // 4. Compute pricing tier
    const pricingTier = getPricingTier(vesselData.loa_metres);

    // 5. Cache the result — capture the id so the checkout flow can refer
    //    back to this registration row without a second round-trip.
    let registrationId = null;
    try {
      const inserted = await cacheVesselResult(vesselData, pricingTier);
      registrationId = inserted?.id || null;
      debug.steps.push(
        registrationId
          ? `cache write: inserted registration ${registrationId}`
          : 'cache write: ok (no id returned)'
      );
    } catch (cacheErr) {
      debug.steps.push(`cache write errored: ${cacheErr?.message || cacheErr}`);
      console.error('Cache write failed:', cacheErr);
    }

    // 6. Return
    return {
      statusCode: 200,
      body: JSON.stringify({
        found: true,
        registration_id: registrationId,
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
        debug,
      }),
    };

  } catch (err) {
    console.error('verify-vessel error:', err?.message || err);

    // Rate limit / overloaded: return 200 with a user-friendly message so the
    // frontend can show a calm "try again" notice instead of a red 500 banner.
    // This is a transient condition — the user did nothing wrong and should
    // just wait a minute.
    if (err instanceof RateLimitError) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: false,
          rate_limited: true,
          error:
            'Our vessel lookup service is temporarily busy. Please wait a minute and try again, or enter your vessel details manually.',
          debug: err?.message || String(err),
        }),
      };
    }

    // Prose-instead-of-JSON: almost always means the model couldn't find the
    // vessel and replied in English. Surface as "not found" rather than a 500
    // so the user can correct the IMO or enter details manually.
    if (err instanceof VesselLookupParseError) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: false,
          error:
            'We couldn\u2019t find a vessel with that IMO number. Please double-check the number, or enter your vessel details manually.',
          debug: { message: err?.message, raw: err?.raw || '' },
        }),
      };
    }

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
