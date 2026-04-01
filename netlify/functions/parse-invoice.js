// Netlify Function: parse-invoice
// DEPRECATED — delivery note parsing has moved to the Supabase edge function
// supabase/functions/parseDeliveryNote/index.ts which uses the OPENAI_API_KEY
// already configured in Supabase. This file is kept as a stub.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey     = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  console.log('[parse-invoice] AZURE_OPENAI_ENDPOINT configured:', !!endpoint);
  console.log('[parse-invoice] AZURE_OPENAI_KEY configured:', !!apiKey);
  console.log('[parse-invoice] AZURE_OPENAI_DEPLOYMENT configured:', !!deployment);

  if (!endpoint || !apiKey || !deployment) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT in environment variables.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { base64, mediaType, batchItems } = body;
  if (!base64 || !mediaType || !batchItems) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: base64, mediaType, batchItems.' }) };
  }

  console.log('[parse-invoice] mediaType:', mediaType, '| base64 chars:', base64.length, '| batchItems:', batchItems.length);

  if (mediaType === 'application/pdf') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'PDF files are not supported by the vision API. Please upload a JPEG or PNG image of the delivery note.' }),
    };
  }

  const itemList = batchItems.map(i => ({
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

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;
  console.log('[parse-invoice] Calling Azure OpenAI:', url);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
            ],
          },
        ],
      }),
    });

    console.log('[parse-invoice] Azure response status:', resp.status);

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('[parse-invoice] Azure error body:', txt.slice(0, 500));
      return { statusCode: resp.status, body: JSON.stringify({ error: `Azure OpenAI error: ${txt.slice(0, 300)}` }) };
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    console.log('[parse-invoice] Azure response text preview:', text.slice(0, 300));

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[parse-invoice] No JSON found in response. Full text:', text.slice(0, 1000));
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not extract JSON from AI response.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: jsonMatch[0],
    };
  } catch (err) {
    console.error('[parse-invoice] Unexpected error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unexpected error.' }) };
  }
};
