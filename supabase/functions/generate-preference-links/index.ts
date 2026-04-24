// Supabase Edge Function: generate-preference-links
//
// For one guest, matches each preference against current onboard inventory
// and estimates a daily consumption rate the frontend uses to compute
// trip-end risk. Output is forced through a tool-use schema so the
// response is always valid JSON with one link entry per input preference.
//
// Pipeline:
//   1. Deterministic pre-filter. Preference categories are allowlisted
//      BEFORE the prompt is constructed — only Food & Beverage, Allergies,
//      and a narrow Cabin whitelist (Bathroom Products, Turn-Down
//      Preferences) reach the model. Routine / Service / Activities /
//      other Cabin keys are dropped here; no sense paying for tokens on
//      lifestyle attributes that aren't inventory-tracked.
//
//   2. Cache check. Key is SHA256 of guest_id + sorted prefs + sorted
//      inventory snapshot + trip_days_remaining. Cache lives in the
//      ai_preference_links_cache table (see migration). Hit → return the
//      stored payload immediately.
//
//   3. Anthropic call with tool_choice forcing return_preference_links.
//      claude-sonnet-4-6, same as generate-inventory-insights.
//
//   4. Server-side shape re-validation + cache write.
//
// Cache isn't scoped to tenant in the key because guest_id is already
// globally unique (uuid). Tenant verification happens via RLS on the
// table and is orthogonal to the lookup path.

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL    = 'https://api.anthropic.com/v1/messages';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ─── Deterministic category allowlist ──────────────────────────────────────
// Preferences that could plausibly map to a stockable consumable. Anything
// outside this set is dropped before the prompt is built.
const CONSUMABLE_CATEGORIES = new Set(['Food & Beverage', 'Allergies']);
const CABIN_CONSUMABLE_KEYS = new Set(['Bathroom Products', 'Turn-Down Preferences']);

function isConsumablePreference(p: { category?: string; key?: string }): boolean {
  if (!p?.category) return false;
  if (CONSUMABLE_CATEGORIES.has(p.category)) return true;
  if (p.category === 'Cabin' && p.key && CABIN_CONSUMABLE_KEYS.has(p.key)) return true;
  return false;
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface Preference {
  key:      string;
  value:    string;
  category: string;
}

interface InventoryItem {
  id:   string;
  name: string;
  qty:  number | null;
  par:  number | null;
}

interface RequestBody {
  guest_id:              string;
  guest_name?:           string;
  guest_role?:           string | null;
  guest_age?:            number | null;
  trip_days_remaining?:  number | null;
  preferences:           Preference[];
  inventory_items:       InventoryItem[];
}

interface Link {
  preference_key:              string;
  preference_value:            string;
  matched_item_id:             string | null;
  match_confidence:            'high' | 'medium' | 'low' | 'none';
  daily_consumption_estimate:  number;
  note:                        string;
}

// ─── Cache key ─────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf  = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildCacheKey(
  guestId: string,
  prefs: Preference[],
  inventory: InventoryItem[],
  tripDaysRemaining: number | null | undefined,
): Promise<string> {
  const prefsPart = [...prefs]
    .map(p => `${p.category}|${p.key}|${p.value}`)
    .sort()
    .join('||');
  const invPart = [...inventory]
    .map(i => `${i.name}|${i.qty ?? ''}`)
    .sort()
    .join('||');
  const tripPart = tripDaysRemaining == null ? 'null' : String(tripDaysRemaining);
  return sha256Hex(`${guestId}::${prefsPart}::${invPart}::${tripPart}`);
}

// ─── Cache read / write via Supabase REST (avoids bundling the JS client) ──

async function readCache(cacheKey: string): Promise<Link[] | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/ai_preference_links_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey:         SERVICE_ROLE_KEY,
        Authorization:  `Bearer ${SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const payload = Array.isArray(rows) && rows[0]?.payload;
    return payload?.links && Array.isArray(payload.links) ? payload.links : null;
  } catch (e) {
    console.warn('[generate-preference-links] cache read failed:', e);
    return null;
  }
}

async function writeCache(cacheKey: string, guestId: string, links: Link[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  const url = `${SUPABASE_URL}/rest/v1/ai_preference_links_cache?on_conflict=cache_key`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        apikey:            SERVICE_ROLE_KEY,
        Authorization:     `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type':    'application/json',
        Prefer:            'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        cache_key: cacheKey,
        guest_id:  guestId,
        payload:   { links },
      }),
    });
  } catch (e) {
    console.warn('[generate-preference-links] cache write failed:', e);
  }
}

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a yacht provisioning analyst. Your job is to match guest preferences against current onboard inventory, and estimate daily consumption rates so the interior team knows what's at risk for the trip.

You speak chief stew to chief stew. No hedging, no fluff. Output only the structured tool call — no prose.`;
}

function buildUserPrompt(body: RequestBody, filteredPrefs: Preference[]): string {
  const prefsList = filteredPrefs.length
    ? filteredPrefs.map(p => `- ${p.key} | ${p.value} | ${p.category}`).join('\n')
    : '(none)';
  const invList = body.inventory_items.length
    ? body.inventory_items.map(i => `- ${i.id} | ${i.name} | qty ${i.qty ?? '?'} | par ${i.par ?? '?'}`).join('\n')
    : '(none)';
  const daysLine = body.trip_days_remaining == null
    ? 'Trip days remaining: unknown (open-ended trip)'
    : `Trip days remaining: ${body.trip_days_remaining}`;
  const ageLine  = body.guest_age == null ? 'Age: unknown' : `Age: ${body.guest_age}`;

  return `## INPUT

<guest>
Name: ${body.guest_name ?? 'Unknown'}
Role: ${body.guest_role ?? 'Guest'}
${ageLine}
${daysLine}
</guest>

<preferences>
${prefsList}
</preferences>

<inventory_items>
${invList}
</inventory_items>

## YOUR TASK

For EACH preference, determine:

1. matched_item_id — the single inventory item that best fulfils this preference. If none fit, return null. Do not invent matches. A close-enough generic match (e.g. "Tea" for "Yorkshire Tea") is acceptable only if there is no specific match. Prefer specific matches over generic.

2. match_confidence — "high" / "medium" / "low" / "none"
   - high: brand or exact item is present
   - medium: category matches but not the specific brand/variant
   - low: possible but uncertain
   - none: no plausible match in inventory

3. daily_consumption_estimate — units per day the guest will consume of this item. Use yacht service knowledge:
   - Coffee "once per day" → 1 cup/day → ~10g coffee beans/day
   - Tea no frequency → 2 bags/day for a tea drinker
   - Wine at dinner → 0.5 bottles/day for one guest
   - Cocktail preference → 1 per evening
   - Shampoo / body wash → 0.1 bottles/day (one per 10 days)
   - Cologne / perfume → 0.02 bottles/day (long-lasting)
   Return 0 if the item isn't consumed regularly.

4. note — one short sentence (max 15 words) describing the linkage or gap.

## RULES

- One entry per input preference. Don't skip, don't duplicate.
- matched_item_id must be null OR an exact ID from inventory input. Never invent IDs.
- daily_consumption_estimate is a number. Never null.
- Skip EMERGENCY / allergy-response items — handled separately.

## EXAMPLES

Preference: "Wine | Tignanello, Super Tuscans"
Inventory: "Tignanello 2017" (id: inv-wine-tigna)
→ matched_item_id: "inv-wine-tigna", confidence: high, consumption: 0.5, note: "Tignanello 2017 matches the stated preference."

Preference: "Tea | Yorkshire"
Inventory: generic "Tea" (id: inv-tea-generic)
→ matched_item_id: "inv-tea-generic", confidence: medium, consumption: 2, note: "Generic tea in stock; Yorkshire-specific not tracked."

Preference: "Bathroom Products | Molton Brown and Redken"
Inventory: no matching items
→ matched_item_id: null, confidence: none, consumption: 0.1, note: "Molton Brown and Redken not tracked in inventory."

Output via the return_preference_links tool. No prose outside the tool call.`;
}

// ─── Tool schema ───────────────────────────────────────────────────────────

const RETURN_LINKS_TOOL = {
  name: 'return_preference_links',
  description: 'Return one structured link per input preference.',
  input_schema: {
    type: 'object',
    properties: {
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            preference_key:             { type: 'string' },
            preference_value:           { type: 'string' },
            matched_item_id:            { type: ['string', 'null'] },
            match_confidence:           { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
            daily_consumption_estimate: { type: 'number' },
            note:                       { type: 'string', maxLength: 120 },
          },
          required: [
            'preference_key',
            'preference_value',
            'matched_item_id',
            'match_confidence',
            'daily_consumption_estimate',
            'note',
          ],
        },
      },
    },
    required: ['links'],
  },
};

// ─── Server ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: RequestBody = await req.json();

    if (!body?.guest_id) {
      return new Response(JSON.stringify({ error: 'guest_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deterministic pre-filter. If the guest has no consumable prefs after
    // this, return an empty links array without touching the model.
    const filteredPrefs = (body.preferences ?? []).filter(isConsumablePreference);
    if (filteredPrefs.length === 0) {
      return new Response(JSON.stringify({ links: [], cache: 'skip' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cache key is built over the filtered prefs only — the same set the
    // model will actually see. Changes to lifestyle prefs that got filtered
    // out don't invalidate the cache.
    const cacheKey = await buildCacheKey(
      body.guest_id,
      filteredPrefs,
      body.inventory_items ?? [],
      body.trip_days_remaining,
    );

    const cached = await readCache(cacheKey);
    if (cached) {
      return new Response(JSON.stringify({ links: cached, cache: 'hit' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cache miss — call the model.
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-6',
        max_tokens:  2048,
        system:      buildSystemPrompt(),
        tools:       [RETURN_LINKS_TOOL],
        tool_choice: { type: 'tool', name: 'return_preference_links' },
        messages: [
          { role: 'user', content: buildUserPrompt(body, filteredPrefs) },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[generate-preference-links] Anthropic error:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicData = await anthropicRes.json();
    const toolBlock = Array.isArray(anthropicData?.content)
      ? anthropicData.content.find((b: { type?: string; name?: string }) =>
          b?.type === 'tool_use' && b?.name === 'return_preference_links')
      : null;

    if (!toolBlock?.input) {
      console.error('[generate-preference-links] No tool_use block in response:', JSON.stringify(anthropicData));
      return new Response(JSON.stringify({ error: 'No structured response from AI', links: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const raw: Link[] = Array.isArray(toolBlock.input.links) ? toolBlock.input.links : [];

    // Valid inventory IDs for ID sanity check — never trust the model to
    // have kept the IDs honest, even under tool-use.
    const validIds = new Set((body.inventory_items ?? []).map(i => i.id));

    const cleaned: Link[] = raw
      .filter(l =>
        l &&
        typeof l.preference_key === 'string' &&
        typeof l.preference_value === 'string' &&
        typeof l.note === 'string' &&
        ['high', 'medium', 'low', 'none'].includes(l.match_confidence) &&
        typeof l.daily_consumption_estimate === 'number' &&
        Number.isFinite(l.daily_consumption_estimate))
      .map(l => ({
        preference_key:             l.preference_key,
        preference_value:           l.preference_value,
        matched_item_id:            l.matched_item_id && validIds.has(l.matched_item_id) ? l.matched_item_id : null,
        match_confidence:           l.match_confidence,
        daily_consumption_estimate: Math.max(0, l.daily_consumption_estimate),
        note:                       l.note.slice(0, 120),
      }));

    await writeCache(cacheKey, body.guest_id, cleaned);

    return new Response(JSON.stringify({ links: cleaned, cache: 'miss' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-preference-links] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
