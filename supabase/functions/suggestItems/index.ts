// Supabase Edge Function: suggestItems
//
// Calls Anthropic Claude API to generate smart provisioning item suggestions
// based on board context (trip type, guest count, duration, season, region,
// department) and the vessel's own order history.
//
// Request body:
//   {
//     boardType:    string,           // e.g. 'charter', 'owner', 'shipyard'
//     tripType:     string | null,    // e.g. 'Charter', 'Owner'
//     guestCount:   number,
//     duration:     number | null,    // trip duration in days
//     season:       string | null,    // 'summer' | 'winter' | 'spring' | 'autumn'
//     region:       string | null,    // e.g. 'Mediterranean', 'Caribbean'
//     department:   string | null,    // user's department filter
//     existingItems: string[],        // names already on the board (to avoid dupes)
//     orderHistory: Array<{           // recent order history for this vessel
//       tripType:   string,
//       guestCount: number,
//       items:      Array<{ name: string, qty: number, unit: string }>
//     }>
//   }
//
// Response:
//   {
//     suggestions: Array<{
//       name:       string,
//       category:   string,
//       quantity:   number,
//       unit:       string,
//       reasoning:  string,
//       source:     'history' | 'ai',
//       confidence: 'high' | 'medium' | 'low'
//     }>
//   }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface OrderHistoryEntry {
  tripType: string;
  guestCount: number;
  items: Array<{ name: string; qty: number; unit: string }>;
}

interface RequestBody {
  boardType:    string;
  tripType:     string | null;
  guestCount:   number;
  duration:     number | null;
  season:       string | null;
  region:       string | null;
  department:   string | null;
  existingItems: string[];
  orderHistory:  OrderHistoryEntry[];
}

interface SuggestedItem {
  name:       string;
  category:   string;
  quantity:   number;
  unit:       string;
  reasoning:  string;
  source:     'history' | 'ai';
  confidence: 'high' | 'medium' | 'low';
}

function buildSystemPrompt(): string {
  return `You are an expert superyacht provisioning manager with 15+ years of experience on luxury motor and sailing yachts. You have deep knowledge of:
- Charter and owner trip provisioning requirements
- Galley (food & beverage) provisioning quantities scaled to guest counts and trip durations
- Deck department consumables (suncare, water sports equipment, safety)
- Engineering consumables (filters, oils, chemicals)
- Seasonal and regional provisioning differences (Mediterranean summer vs Caribbean winter)
- Premium brands used on superyachts (San Pellegrino, Acqua Panna, Moët, Whispering Angel, etc.)

Your task is to suggest specific provisioning items for a yacht board based on the context provided.

CRITICAL RULES:
1. Return ONLY a valid JSON object — no markdown, no prose, no code fences
2. Suggest 8–15 items that are most likely to be needed and missing
3. Do NOT suggest items already in existingItems (case-insensitive)
4. Scale quantities appropriately to guestCount and duration
5. Be specific with item names (e.g. "San Pellegrino Sparkling Water 750ml" not "water")
6. For galley: prioritise beverages, fresh produce, dairy, dry goods relevant to season/region
7. For deck: prioritise suncare, water toys, safety items
8. For engineering: prioritise engine consumables, safety equipment
9. Mark source as 'history' if the item appears in order history, otherwise 'ai'
10. Confidence: 'high' if from history or very standard item, 'medium' for contextual suggestions, 'low' for speculative

JSON schema:
{
  "suggestions": [
    {
      "name":       "string — specific product name",
      "category":   "string — one of: Beverages, Fresh Produce, Dairy, Dry Goods, Condiments, Cleaning, Paper Goods, Deck Supplies, Safety, Engineering, Toiletries, Other",
      "quantity":   number,
      "unit":       "string — e.g. bottles, cases, kg, litres, units, rolls",
      "reasoning":  "string — one sentence why this is suggested",
      "source":     "history" | "ai",
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;
}

function buildUserPrompt(body: RequestBody): string {
  const parts: string[] = [];

  parts.push(`Board type: ${body.boardType || 'general'}`);
  if (body.tripType)   parts.push(`Trip type: ${body.tripType}`);
  if (body.guestCount) parts.push(`Guests: ${body.guestCount}`);
  if (body.duration)   parts.push(`Duration: ${body.duration} days`);
  if (body.season)     parts.push(`Season: ${body.season}`);
  if (body.region)     parts.push(`Region: ${body.region}`);
  if (body.department) parts.push(`Department focus: ${body.department}`);

  if (body.existingItems.length > 0) {
    parts.push(`\nItems already on this board (DO NOT suggest these):\n${body.existingItems.slice(0, 50).join(', ')}`);
  }

  if (body.orderHistory.length > 0) {
    parts.push('\nVessel order history (use to infer preferences):');
    body.orderHistory.slice(0, 5).forEach(entry => {
      parts.push(`  ${entry.tripType} trip (${entry.guestCount} guests): ${entry.items.slice(0, 10).map(i => i.name).join(', ')}`);
    });
  }

  parts.push('\nSuggest the most relevant provisioning items for this board.');

  return parts.join('\n');
}

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

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        system:     buildSystemPrompt(),
        messages: [
          { role: 'user', content: buildUserPrompt(body) },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[suggestItems] Anthropic error:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicData = await anthropicRes.json();
    const rawText = anthropicData?.content?.[0]?.text || '';

    // Parse the JSON from Claude's response
    let parsed: { suggestions: SuggestedItem[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from the text in case Claude added any prose
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error('[suggestItems] Failed to parse Claude response:', rawText);
        return new Response(JSON.stringify({ error: 'Failed to parse AI response', suggestions: [] }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ suggestions: parsed.suggestions || [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[suggestItems] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
