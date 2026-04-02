// Supabase Edge Function: parseDeliveryNote
//
// Uses Azure Document Intelligence (prebuilt-invoice model) to extract
// line items from a delivery note image or PDF, then fuzzy-matches them
// against provisioning board items.
//
// Uses the same AZURE_DOC_INTELLIGENCE_* env vars as azureDocumentParser.
//
// Request body: { base64: string, mediaType: string, batchItems: ProvItem[] }
// Response: same JSON shape as the original parse-invoice Netlify function:
//   { invoice_number, invoice_date, supplier_name, total_amount, currency,
//     line_items: [{ raw_name, quantity, unit_price, line_total, unit,
//                    matched_item_id, match_confidence, discrepancy }] }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Azure credentials (same as azureDocumentParser) ──────────────────────────

const AZURE_ENDPOINT  = Deno.env.get('AZURE_DOC_INTELLIGENCE_ENDPOINT') || '';
const AZURE_KEY       = Deno.env.get('AZURE_DOC_INTELLIGENCE_KEY') || '';
const AZURE_API_VER   = Deno.env.get('AZURE_DOC_INTELLIGENCE_API_VERSION') || '2024-02-29-preview';

// ── Poll until Azure operation completes ──────────────────────────────────────

async function pollOperation(operationLocation: string, maxAttempts = 60, intervalMs = 2000): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollRes = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY },
    });
    if (!pollRes.ok) {
      const errText = await pollRes.text();
      throw new Error(`Azure poll error ${pollRes.status}: ${errText}`);
    }
    const pollData = await pollRes.json();
    if (pollData?.status === 'succeeded') return pollData?.analyzeResult;
    if (pollData?.status === 'failed') {
      throw new Error(`Azure analysis failed: ${pollData?.error?.message || 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Azure analysis timed out');
}

// ── Simple word-overlap similarity (0–1) ─────────────────────────────────────

function wordSimilarity(a: string, b: string): number {
  const tokenise = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const wa = new Set(tokenise(a));
  const wb = new Set(tokenise(b));
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  wa.forEach((w) => { if (wb.has(w)) overlap++; });
  return overlap / Math.max(wa.size, wb.size);
}

// ── Match extracted items to board items ─────────────────────────────────────

function matchToBoardItem(rawName: string, brand: string | null, size: string | null, boardItems: any[]) {
  let bestId: string | null = null;
  let bestScore = 0;

  for (const bi of boardItems) {
    let score = wordSimilarity(rawName, bi.name || '') * 60;
    if (brand && bi.brand) {
      const bl = brand.toLowerCase();
      const bil = (bi.brand as string).toLowerCase();
      if (bl.includes(bil) || bil.includes(bl)) score += 20;
    }
    if (size && bi.size) {
      if ((size as string).toLowerCase() === (bi.size as string).toLowerCase()) score += 20;
    }
    if (score > bestScore) { bestScore = score; bestId = bi.id; }
  }

  if (bestScore >= 40) {
    const conf = bestScore >= 70 ? 'high' : bestScore >= 50 ? 'medium' : 'low';
    return { id: bestId, confidence: conf };
  }
  return { id: null, confidence: 'none' };
}

// ── Extract line items from Azure prebuilt-invoice result ────────────────────

function extractLineItems(analyzeResult: any, boardItems: any[]) {
  const doc = analyzeResult?.documents?.[0];
  const fields = doc?.fields || {};

  const invoiceNumber = fields?.InvoiceId?.content || null;
  const invoiceDate   = fields?.InvoiceDate?.content || null;
  const supplierName  = fields?.VendorName?.content || null;
  const totalAmount   = fields?.InvoiceTotal?.value ?? null;
  const currency      = fields?.CurrencyCode?.content || null;

  const rawItems: any[] = fields?.Items?.valueArray || [];
  console.log('[parseDeliveryNote] raw invoice items from Azure:', rawItems.length);

  const lineItems = rawItems.map((item: any) => {
    const f = item?.valueObject || {};
    const rawName   = f?.Description?.content || f?.ProductCode?.content || 'Unknown item';
    const brand     = null;
    const size      = null;
    const quantity  = f?.Quantity?.value ?? null;
    const unitPrice = f?.UnitPrice?.value ?? null;
    const lineTotal = f?.Amount?.value ?? null;
    const unit      = f?.Unit?.content || null;

    const match = matchToBoardItem(rawName, brand, size, boardItems);

    // Check for quantity / price discrepancy against board item
    let discrepancy: string | null = null;
    if (match.id) {
      const bi = boardItems.find((b: any) => b.id === match.id);
      if (bi && quantity != null && bi.quantity_ordered != null && quantity < bi.quantity_ordered) {
        discrepancy = `Delivered ${quantity}, ordered ${bi.quantity_ordered}`;
      }
      if (bi && unitPrice != null && bi.estimated_unit_cost != null) {
        const diff = Math.abs(unitPrice - parseFloat(bi.estimated_unit_cost));
        if (diff > 0.01) discrepancy = (discrepancy ? discrepancy + '; ' : '') + `Unit price ${unitPrice} vs quoted ${bi.estimated_unit_cost}`;
      }
    }

    return {
      raw_name:         rawName,
      quantity,
      unit_price:       unitPrice,
      line_total:       lineTotal,
      unit,
      matched_item_id:  match.id,
      match_confidence: match.confidence,
      discrepancy,
    };
  });

  // Fallback: if invoice model found no Items, try extracting from tables
  if (lineItems.length === 0) {
    console.log('[parseDeliveryNote] No invoice items found — falling back to table extraction');
    for (const table of analyzeResult?.tables || []) {
      if ((table.rowCount || 0) < 2) continue;
      const grid: string[][] = Array.from({ length: table.rowCount }, () =>
        Array.from({ length: table.columnCount }, () => '')
      );
      for (const cell of table.cells || []) {
        grid[cell.rowIndex ?? 0][cell.columnIndex ?? 0] = cell.content || '';
      }
      // Skip header row; treat each subsequent row as a potential line item
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        const rawName = row[0] || row[1] || '';
        if (!rawName.trim()) continue;
        const numericCells = row.slice(1).map((c: string) => parseFloat(c.replace(/[^0-9.]/g, ''))).filter((n: number) => !isNaN(n));
        const quantity  = numericCells[0] ?? null;
        const unitPrice = numericCells[1] ?? null;
        const match = matchToBoardItem(rawName, null, null, boardItems);
        lineItems.push({
          raw_name: rawName.trim(),
          quantity,
          unit_price: unitPrice,
          line_total: null,
          unit: null,
          matched_item_id:  match.id,
          match_confidence: match.confidence,
          discrepancy: null,
        });
      }
      if (lineItems.length > 0) break;
    }
  }

  return { invoiceNumber, invoiceDate, supplierName, totalAmount, currency, lineItems };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[parseDeliveryNote] AZURE_ENDPOINT configured:', !!AZURE_ENDPOINT);
  console.log('[parseDeliveryNote] AZURE_KEY configured:', !!AZURE_KEY);

  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    return new Response(JSON.stringify({ error: 'Azure Document Intelligence credentials not configured. Set AZURE_DOC_INTELLIGENCE_ENDPOINT and AZURE_DOC_INTELLIGENCE_KEY.' }), {
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

  // Decode base64 → bytes (same pattern as azureDocumentParser)
  const binaryStr = atob(base64);
  const fileBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) fileBytes[i] = binaryStr.charCodeAt(i);

  // Submit to Azure prebuilt-invoice model
  const analyzeUrl = `${AZURE_ENDPOINT.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=${AZURE_API_VER}`;
  console.log('[parseDeliveryNote] Submitting to Azure:', analyzeUrl);

  try {
    const submitRes = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': mediaType,
      },
      body: fileBytes,
    });

    console.log('[parseDeliveryNote] Azure submit status:', submitRes.status);

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error('[parseDeliveryNote] Azure submit error:', errText.slice(0, 500));
      return new Response(JSON.stringify({ error: `Azure submission failed (${submitRes.status}): ${errText.slice(0, 300)}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const operationLocation = submitRes.headers.get('operation-location');
    if (!operationLocation) {
      return new Response(JSON.stringify({ error: 'Azure did not return an operation-location header' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[parseDeliveryNote] Polling operation:', operationLocation.slice(0, 80), '...');
    const analyzeResult = await pollOperation(operationLocation);

    const { invoiceNumber, invoiceDate, supplierName, totalAmount, currency, lineItems } = extractLineItems(analyzeResult, batchItems);
    console.log('[parseDeliveryNote] Extracted', lineItems.length, 'line items; matched:', lineItems.filter((l: any) => l.matched_item_id).length);

    const response = {
      invoice_number: invoiceNumber,
      invoice_date:   invoiceDate,
      supplier_name:  supplierName,
      total_amount:   totalAmount,
      currency,
      line_items:     lineItems,
    };

    return new Response(JSON.stringify(response), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[parseDeliveryNote] Error:', err?.message);
    return new Response(JSON.stringify({ error: err?.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
