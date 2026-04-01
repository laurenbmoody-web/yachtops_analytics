// Netlify Function: parse-invoice
// Proxies invoice file + batch items to the Anthropic API server-side,
// keeping ANTHROPIC_API_KEY out of the client bundle entirely.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }) };
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
  console.log('[parse-invoice] ANTHROPIC_API_KEY configured:', !!apiKey);

  const isPdf = mediaType === 'application/pdf';
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  const itemList = batchItems.map(i => ({
    id: i.id,
    name: i.name,
    brand: i.brand || null,
    size: i.size || null,
    qty_received: i.quantity_received,
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

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
      }),
    });

    console.log('[parse-invoice] Anthropic response status:', resp.status);
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('[parse-invoice] Anthropic error body:', txt.slice(0, 500));
      return { statusCode: resp.status, body: JSON.stringify({ error: `Anthropic API error: ${txt.slice(0, 300)}` }) };
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    console.log('[parse-invoice] Claude response text preview:', text.slice(0, 300));
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unexpected error.' }) };
  }
};
