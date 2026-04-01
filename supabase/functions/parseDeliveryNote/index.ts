// Supabase Edge Function: parseDeliveryNote
//
// Parses a delivery note image using OpenAI vision and matches line items
// to provisioning board items. Uses the same OPENAI_API_KEY already
// configured for parseInventoryImport.
//
// Request body: { base64: string, mediaType: string, batchItems: ProvItem[] }
// Response: { invoice_number, invoice_date, supplier_name, total_amount,
//             currency, line_items: [...] }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openAiApiKey = Deno.env.get('OPENAI_API_KEY');
  console.log('[parseDeliveryNote] OPENAI_API_KEY configured:', !!openAiApiKey);
  if (!openAiApiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI API key not configured on server.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { base64?: string; mediaType?: string; batchItems?: any[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { base64, mediaType, batchItems } = body;
  if (!base64 || !mediaType || !batchItems) {
    return new Response(JSON.stringify({ error: 'Missing required fields: base64, mediaType, batchItems.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[parseDeliveryNote] mediaType:', mediaType, '| base64 chars:', base64.length, '| batchItems:', batchItems.length);

  const itemList = batchItems.map((i: any) => ({
    id: i.id,
    name: i.name,
    brand: i.brand || null,
    size: i.size || null,
    qty_ordered: i.quantity_ordered,
    quoted_unit_cost: i.estimated_unit_cost,
  }));

  const prompt = `You are processing an invoice or receipt for a yacht provisioning order.

Extract all details from this document and match line items to the provisioning order below.

Provisioning order items:
${JSON.stringify(itemList, null, 2)}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "supplier_name": "string or null",
  "total_amount": number or null,
  "currency": "3-letter code or null",
  "line_items": [
    {
      "raw_name": "exact text from invoice",
      "quantity": number or null,
      "unit_price": number or null,
      "line_total": number or null,
      "unit": "string or null",
      "matched_item_id": "UUID matching a provisioning item id above, or null",
      "match_confidence": "high|medium|low|none",
      "discrepancy": "short description of any qty/price discrepancy, or null"
    }
  ]
}`;

  const messageContent: any[] = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
  ];

  console.log('[parseDeliveryNote] Calling OpenAI vision (gpt-4o)...');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2048,
        messages: [{ role: 'user', content: messageContent }],
      }),
    });

    console.log('[parseDeliveryNote] OpenAI response status:', resp.status);

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('[parseDeliveryNote] OpenAI error:', txt.slice(0, 500));
      return new Response(JSON.stringify({ error: `OpenAI API error: ${txt.slice(0, 300)}` }), {
        status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    console.log('[parseDeliveryNote] Response preview:', text.slice(0, 300));

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[parseDeliveryNote] No JSON found. Full text:', text.slice(0, 1000));
      return new Response(JSON.stringify({ error: 'Could not extract JSON from AI response.' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(jsonMatch[0], {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[parseDeliveryNote] Unexpected error:', err?.message);
    return new Response(JSON.stringify({ error: err?.message || 'Unexpected error.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
