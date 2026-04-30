// Supabase Edge Function: infer-item-category
//
// Given an item name, a department name, and the list of valid categories
// for that department, returns the single best matching category. If the
// model is unsure or returns anything not in validCategories, the response
// is coerced to "Uncategorised". The function never errors on the API key
// being missing or on Anthropic failures — it returns 200 with category
// "Uncategorised" so the frontend save path is never blocked.
//
// Request body:
//   {
//     itemName:        string,    // "Sunscreen SPF50 200ml"
//     departmentName:  string,    // "Galley" | "Deck" | "Bridge" | …
//     validCategories: string[],  // category list for that dept
//   }
//
// Response:
//   { category: string }          // one of validCategories, or "Uncategorised"

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

interface RequestBody {
  itemName?: string;
  departmentName?: string;
  validCategories?: string[];
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

const SYSTEM_PROMPT =
  'You categorise yacht provisioning items. Given an item name and a list of valid categories for the department, return the single best matching category. Respond with ONLY the category name, exactly as written in the list. If no category fits with reasonable confidence, respond with "Uncategorised".';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Missing API key — fail soft, don't error
  if (!ANTHROPIC_API_KEY) {
    console.log('[infer-item-category] ANTHROPIC_API_KEY not set — returning Uncategorised');
    return json({ category: 'Uncategorised' });
  }

  let body: RequestBody | null = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const itemName = (body?.itemName || '').trim();
  const departmentName = (body?.departmentName || '').trim();
  const validCategories = Array.isArray(body?.validCategories)
    ? body!.validCategories.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];

  if (!itemName || !departmentName || validCategories.length === 0) {
    return json({ error: 'Missing required fields: itemName, departmentName, validCategories' }, 400);
  }

  const userMessage =
    `Item: ${itemName}\n` +
    `Department: ${departmentName}\n` +
    `Valid categories:\n` +
    validCategories.map(c => `- ${c}`).join('\n');

  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!r.ok) {
      console.error('[infer-item-category] Anthropic error', r.status, await r.text().catch(() => ''));
      return json({ category: 'Uncategorised' });
    }

    const data = await r.json();
    const raw = (data?.content?.[0]?.text || '').trim();

    // Validate: model must return either a category from the list or the
    // literal sentinel "Uncategorised". Anything else is coerced.
    const isValid = validCategories.includes(raw) || raw === 'Uncategorised';
    return json({ category: isValid ? raw : 'Uncategorised' });
  } catch (err) {
    console.error('[infer-item-category] fetch error', err);
    return json({ category: 'Uncategorised' });
  }
});
