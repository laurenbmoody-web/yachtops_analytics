// message-to-quote — the messaging differentiator.
//
// Takes a free-text request (a crew message like "can you add 2 cases of San
// Pellegrino and 6 sourdough loaves?") and turns it into a priced quote the
// supplier can review + send. Claude parses the request into line items,
// matches each to the supplier's catalogue for pricing, and drafts a friendly
// quote message.
//
// Input:  { text: string, supplierId: string }
// Output: { quote_text: string, items: Array<{ name, qty, unit, unit_price, currency, matched }>, currency }
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY   = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL   = 'https://api.anthropic.com/v1/messages';
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY         = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { text, supplierId } = await req.json();
    if (!text || !supplierId) return json({ error: 'text and supplierId are required' }, 400);
    if (!ANTHROPIC_API_KEY) return json({ error: 'AI is not configured' }, 500);

    // Supplier's catalogue (name + price) for matching / pricing.
    let catalogue: Array<{ name: string; unit: string | null; unit_price: number | null; currency: string }> = [];
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/supplier_catalogue_items?supplier_id=eq.${supplierId}&select=name,unit,unit_price,currency&limit=600`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      if (res.ok) catalogue = await res.json();
    } catch (_) { /* pricing is best-effort */ }

    const currency = catalogue.find((c) => c.currency)?.currency || 'EUR';
    const catLines = catalogue
      .filter((c) => c.name)
      .slice(0, 400)
      .map((c) => `- ${c.name}${c.unit ? ` (${c.unit})` : ''}${c.unit_price != null ? ` @ ${c.unit_price} ${c.currency}` : ''}`)
      .join('\n');

    const system = `You are a superyacht provisioning supplier turning a client's request into a clear, priced quote.

RULES
1. Return ONLY valid JSON — no markdown, no prose, no code fences.
2. Extract each item the client is asking for. Use the EXACT quantity and size/unit the client stated (e.g. "5 × Mascarpone 250g" → qty 5, unit "250g tub"). Only fall back to the catalogue's unit when the client didn't specify one.
3. Match each item to the supplier's catalogue when there's a clear match, and use that catalogue price (unit_price). If there's no clear match, set unit_price to null and matched to false (still include the item). If the closest catalogue match is a different pack/size than the client asked for, still quote it but keep the client's stated size in the name and note the pack difference in quote_text rather than silently changing their quantity.
4. Prices are per unit in ${currency}. Compute nothing the client didn't ask for.
5. Write quote_text as a warm, concise message a supplier would send: a one-line intro, a bulleted list of "qty × unit name — line total" (omit line total when unpriced), a total for the priced items, and a friendly close inviting confirmation or changes. Note any unpriced items or pack-size differences that need confirming — but don't re-ask for a size the client already gave.

JSON schema:
{
  "items": [
    { "name": "string", "qty": number, "unit": "string", "unit_price": number|null, "matched": boolean }
  ],
  "quote_text": "string"
}`;

    const user = `SUPPLIER CATALOGUE (name (unit) @ price ${currency}):\n${catLines || '(no catalogue items available — leave prices null)'}\n\nCLIENT REQUEST:\n"""${String(text).slice(0, 2000)}"""`;

    const aiRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: `AI request failed: ${errText.slice(0, 200)}` }, 502);
    }
    const aiData = await aiRes.json();
    const raw = (aiData?.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

    let parsed: { items?: unknown[]; quote_text?: string };
    try { parsed = JSON.parse(raw); } catch (_) { return json({ error: 'Could not parse the request into a quote' }, 502); }

    const items = Array.isArray(parsed.items) ? parsed.items.map((i: Record<string, unknown>) => ({
      name: String(i.name || '').trim(),
      qty: Number(i.qty) || 1,
      unit: String(i.unit || '').trim(),
      unit_price: i.unit_price == null ? null : Number(i.unit_price),
      currency,
      matched: !!i.matched,
    })) : [];

    return json({ quote_text: parsed.quote_text || '', items, currency });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
