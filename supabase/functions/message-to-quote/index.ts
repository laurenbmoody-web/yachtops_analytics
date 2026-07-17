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
    const { text, supplierId, context } = await req.json();
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

    // Conversation context so vague follow-ups ("add another 20", "same again",
    // "make it 30") resolve against what was already discussed / last quoted.
    const history = Array.isArray(context?.history) ? context.history : [];
    const histLines = history.slice(-8)
      .map((h: Record<string, unknown>) => `${h.from === 'you' ? 'SUPPLIER' : 'CLIENT'}: ${String(h.text || '').slice(0, 300)}`)
      .join('\n');
    const lastItems = Array.isArray(context?.lastItems) ? context.lastItems : [];
    const lastItemLines = lastItems
      .map((it: Record<string, unknown>) => `- ${Number(it.qty) || 1}× ${String(it.name || '').trim()}${it.unit ? ` (${it.unit})` : ''}${it.unit_price != null ? ` @ ${it.unit_price} ${currency}` : ''}`)
      .join('\n');

    const system = `You are a superyacht provisioning supplier turning a client's request into a clear, priced quote.

RULES
1. Return ONLY valid JSON — no markdown, no prose, no code fences.
2. Extract each item the client is asking for. Use the EXACT quantity and size/unit the client stated (e.g. "5 × Mascarpone 250g" → qty 5, unit "250g tub"). Only fall back to the catalogue's unit when the client didn't specify one.
3. Match each item to the supplier's catalogue when there's a clear match, and use that catalogue price (unit_price). If there's no clear match, set unit_price to null and matched to false — but STILL INCLUDE the item. A missing catalogue match only means you don't have a standing price to hand; it does NOT mean the item is unavailable. If the closest catalogue match is a different pack/size than the client asked for, still quote it but keep the client's stated size in the name and note the pack difference in quote_text rather than silently changing their quantity.
4. The supplier chose to turn this request into a quote, so they ARE willing to supply everything in it — declining is a separate action they'd take instead. So quote every item confidently. Do NOT mention your catalogue, your range, availability, other departments, or sourcing difficulty, and never suggest the client go elsewhere. For an unmatched item, simply include it with unit_price null and, in quote_text, say you'll confirm its price shortly (e.g. "I'll confirm the price on the USB-C cables and come straight back") — as a normal next step, never an apology or a caveat.
5. Prices are per unit in ${currency}. Compute nothing the client didn't ask for.
6. Write quote_text as a warm, concise message a supplier would send: a one-line intro, a bulleted list of "qty × unit name — line total" (omit line total when unpriced), a total for the priced items, and a friendly close inviting confirmation or changes. For unpriced items, say you'll confirm a price shortly — don't re-ask for a size the client already gave, and don't decline them.
7. The NEW CLIENT REQUEST may be a short follow-up that only makes sense against the conversation — e.g. "add another 20", "same again", "make it 30", "double the cheese", "6 more of those". Resolve it using CONVERSATION SO FAR and MOST RECENT QUOTE: figure out which product(s) they mean and the intended NEW quantity, and return the full resolved line item(s) with the correct product name, unit and price. If they're changing the quantity of something already quoted, quote the item at the NEW total quantity (e.g. last quote 5 × Purina Dog Food, "add another 20" → 25 × Purina Dog Food). When the request builds on a previous quote, open quote_text with "Here's your updated quote:" and show the new quantities and total. If the follow-up is genuinely ambiguous (no prior item to attach it to), return an empty items array and use quote_text to ask a brief clarifying question naming what you need.

JSON schema:
{
  "items": [
    { "name": "string", "qty": number, "unit": "string", "unit_price": number|null, "matched": boolean }
  ],
  "quote_text": "string"
}`;

    const user = `SUPPLIER CATALOGUE (name (unit) @ price ${currency}):\n${catLines || '(no catalogue items available — leave prices null)'}`
      + (histLines ? `\n\nCONVERSATION SO FAR (most recent last):\n${histLines}` : '')
      + (lastItemLines ? `\n\nMOST RECENT QUOTE (resolve follow-ups like "another 20" against these):\n${lastItemLines}` : '')
      + `\n\nNEW CLIENT REQUEST:\n"""${String(text).slice(0, 2000)}"""`;

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
