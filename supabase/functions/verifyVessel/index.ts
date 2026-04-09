// Supabase Edge Function: verifyVessel
//
// Looks up a vessel by IMO number using the Anthropic API with web search.
// Searches public maritime registries (Equasis, GISIS, MarineTraffic public pages)
// and returns structured vessel data (name, LOA, type, flag, year built).
//
// Caches results in vessel_registrations table (90-day TTL) so each vessel
// is only looked up once.
//
// Requires ANTHROPIC_API_KEY env var (same key used for receipt scanning).
//
// Request body: { imo: string }
// Response: { found, vessel: { name, imo, loa_metres, type, flag, year_built,
//             gross_tonnage }, pricing_tier, pricing_tier_label, cached }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

/* ─── Pricing tier logic ──────────────────────────────────────────────── */

function getPricingTier(loa: number): string {
  if (loa < 40) return 'under_40m';
  if (loa <= 80) return '40_80m';
  return 'over_80m';
}

function getTierLabel(tier: string): string {
  switch (tier) {
    case 'under_40m': return 'Under 40m — £179/month';
    case '40_80m': return '40 – 80m — £279/month';
    case 'over_80m': return 'Over 80m — £399/month';
    default: return tier;
  }
}

/* ─── Supabase helpers (direct fetch, no SDK needed) ──────────────────── */

async function supabaseQuery(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
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
}

async function getCachedVessel(imo: string) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const res = await supabaseQuery(
    `vessel_registrations?imo_number=eq.${imo}&verified_at=gte.${cutoff}&select=*&limit=1`,
    { method: 'GET' }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

async function cacheVesselResult(vessel: Record<string, unknown>, pricingTier: string) {
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

async function lookupVessel(imo: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20241022',
      max_tokens: 500,
      tools: [{ type: 'web_search_20250305' }],
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
    throw new Error(`Anthropic API returned ${response.status}`);
  }

  const data = await response.json();

  // Find the text block in the response content
  const textBlock = data.content?.find((block: { type: string }) => block.type === 'text');
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

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imo } = await req.json();

    // Validate IMO format (7 digits)
    if (!imo || typeof imo !== 'string' || !/^\d{7}$/.test(imo.trim())) {
      return new Response(
        JSON.stringify({
          found: false,
          error: 'Invalid IMO number. Must be exactly 7 digits.',
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanIMO = imo.trim();

    // 1. Check cache first
    const cached = await getCachedVessel(cleanIMO);
    if (cached) {
      const tier = cached.pricing_tier || getPricingTier(cached.loa_metres);
      return new Response(
        JSON.stringify({
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
        { headers: corsHeaders }
      );
    }

    // 2. Look up via Anthropic API with web search
    const vesselData = await lookupVessel(cleanIMO);

    if (!vesselData.found) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: corsHeaders }
      );
    }

    // 3. Validate we got a LOA
    if (!vesselData.loa_metres || typeof vesselData.loa_metres !== 'number') {
      return new Response(
        JSON.stringify({
          found: true,
          vessel: vesselData,
          pricing_tier: null,
          error: 'Could not determine vessel length. Please enter manually.',
        }),
        { headers: corsHeaders }
      );
    }

    // 4. Compute pricing tier
    const pricingTier = getPricingTier(vesselData.loa_metres);

    // 5. Cache the result
    try {
      await cacheVesselResult(vesselData, pricingTier);
    } catch (cacheErr) {
      // Don't fail the request if caching fails — just log it
      console.error('Cache write failed:', cacheErr);
    }

    // 6. Return
    return new Response(
      JSON.stringify({
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
      { headers: corsHeaders }
    );

  } catch (err) {
    console.error('verifyVessel error:', err);
    return new Response(
      JSON.stringify({
        found: false,
        error: 'Vessel lookup failed. Please try again or enter details manually.',
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
