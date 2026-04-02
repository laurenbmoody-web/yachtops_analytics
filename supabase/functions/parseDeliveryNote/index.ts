// Supabase Edge Function: parseDeliveryNote
//
// Uses Azure Document Intelligence (prebuilt-document model) to extract
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

// ── Word similarity helper ────────────────────────────────────────────────────

function wordSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();

  // Direct containment: "wireless network adapter" contains "network adapter" → 1.0
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 1.0;

  const tokenise = (s: string) =>
    s.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 1);

  const wa = tokenise(aLower);
  const wb = tokenise(bLower);
  if (!wa.length || !wb.length) return 0;

  let overlap = 0;
  for (const wordB of wb) {
    if (wa.some((wordA) => wordA === wordB || wordA.includes(wordB) || wordB.includes(wordA))) {
      overlap++;
    }
  }
  return overlap / wb.length;
}

// ── Match extracted items to board items ─────────────────────────────────────

function matchToBoardItem(rawName: string, brand: string | null, size: string | null, boardItems: any[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  console.log(`[parseDeliveryNote] === MATCH: "${rawName}" ===`);
  console.log('[parseDeliveryNote] Board items:', boardItems.map((b) => b.name));

  let bestId: string | null = null;
  let bestScore = 0;

  for (const bi of boardItems) {
    const sim = wordSimilarity(rawName, bi.name || '');
    let score = sim >= 1.0 ? 80 : sim > 0.5 ? 60 + (sim * 20) : sim > 0 ? 40 + (sim * 20) : 0;

    // Brand bonus
    if (brand && bi.brand) {
      if (wordSimilarity(brand, bi.brand as string) >= 1.0) score += 15;
    }
    // Size bonus
    if (size && bi.size && norm(size) === norm(bi.size as string)) score += 10;

    console.log(`[parseDeliveryNote]   vs "${bi.name}" → sim:${sim.toFixed(2)} score:${score}`);
    if (score > bestScore) { bestScore = score; bestId = bi.id; }
  }

  const result = bestScore >= 40
    ? { id: bestId, confidence: bestScore >= 75 ? 'high' : bestScore >= 60 ? 'medium' : 'low' }
    : { id: null, confidence: 'none' };
  console.log(`[parseDeliveryNote]   RESULT: score=${bestScore} confidence=${result.confidence} id=${result.id}`);
  return result;
}

// ── Extract line items from Azure prebuilt-document result ───────────────────

function extractLineItems(analyzeResult: any, boardItems: any[]) {
  console.log('[parseDeliveryNote] analyzeResult keys:', Object.keys(analyzeResult || {}));
  console.log('[parseDeliveryNote] tables:', analyzeResult?.tables?.length ?? 0,
    '| paragraphs:', analyzeResult?.paragraphs?.length ?? 0,
    '| kvPairs:', analyzeResult?.keyValuePairs?.length ?? 0);
  console.log('[parseDeliveryNote] === MATCHING DEBUG ===');
  console.log('[parseDeliveryNote] Board items received:', boardItems.length, JSON.stringify(boardItems.map((i: any) => i.name)));
  if (boardItems.length === 0) {
    console.warn('[parseDeliveryNote] WARNING: no board items passed in — nothing can match');
  }

  const lineItems: any[] = [];

  // ── Primary: extract from tables ─────────────────────────────────────────
  for (const table of analyzeResult?.tables || []) {
    if ((table.rowCount || 0) < 2) continue;

    const cells: any[] = table.cells || [];

    // Step 1: column detection from explicit header cells
    let nameCol = -1, qtyCol = -1, priceCol = -1;
    const headerCells = cells.filter((c: any) => c.kind === 'columnHeader');
    for (const hc of headerCells) {
      const h = (hc.content || '').toLowerCase();
      if (nameCol  === -1 && /product|description|item|article|name/.test(h)) nameCol  = hc.columnIndex;
      if (qtyCol   === -1 && /deliver|receiv|qty|quantity|amount/.test(h))     qtyCol   = hc.columnIndex;
      if (priceCol === -1 && /price|cost|each|unit\s*price/.test(h))           priceCol = hc.columnIndex;
    }
    console.log('[parseDeliveryNote] header cells:', headerCells.map((c: any) => `col${c.columnIndex}="${c.content}"`));

    // Step 2: row 0 as header fallback
    if (nameCol === -1 && qtyCol === -1) {
      for (const c of cells.filter((c: any) => c.rowIndex === 0)) {
        const h = (c.content || '').toLowerCase();
        if (nameCol  === -1 && /product|description|item|article|name/.test(h)) nameCol  = c.columnIndex;
        if (qtyCol   === -1 && /deliver|receiv|qty|quantity|amount/.test(h))     qtyCol   = c.columnIndex;
        if (priceCol === -1 && /price|cost|each|unit\s*price/.test(h))           priceCol = c.columnIndex;
      }
    }

    // Step 3: positional defaults if still undetected
    if (nameCol === -1) nameCol = 1;  // typically 2nd column
    if (qtyCol  === -1) qtyCol  = 3;  // typically 4th column (DELIVERED QTY)
    console.log('[parseDeliveryNote] Table columns — name:', nameCol, 'qty:', qtyCol, 'price:', priceCol);

    // Step 4: group cells by row, skip header rows
    const dataStartRow = headerCells.length > 0 ? 1 : 1;
    const rows: Record<number, Record<number, string>> = {};
    for (const c of cells) {
      if (c.kind === 'columnHeader') continue;
      if (!rows[c.rowIndex]) rows[c.rowIndex] = {};
      rows[c.rowIndex][c.columnIndex] = c.content || '';
    }

    for (const rowIdx of Object.keys(rows).map(Number).filter((n) => n >= dataStartRow).sort((a, b) => a - b)) {
      const row = rows[rowIdx];
      const rawName  = (row[nameCol]  || '').trim();
      const qtyStr   = (row[qtyCol]   || '').trim();
      const priceStr = priceCol >= 0 ? (row[priceCol] || '').trim() : '';

      if (!rawName || rawName === '-') continue;

      const quantity  = parseInt(qtyStr.replace(/[^0-9]/g, ''), 10) || null;
      const unitPrice = priceStr ? (parseFloat(priceStr.replace(/[^0-9.]/g, '')) || null) : null;
      const match     = matchToBoardItem(rawName, null, null, boardItems);

      lineItems.push({ raw_name: rawName, quantity, unit_price: unitPrice, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
    }

    if (lineItems.length > 0) break;
  }
  console.log('[parseDeliveryNote] Extracted', lineItems.length, 'items from tables');

  // ── Fallback: paragraph / text pattern extraction ────────────────────────
  if (lineItems.length === 0) {
    console.log('[parseDeliveryNote] No tables found — trying text extraction');
    const lines: string[] = analyzeResult?.paragraphs?.length
      ? analyzeResult.paragraphs.map((p: any) => p.content || '')
      : (typeof analyzeResult?.content === 'string' ? analyzeResult.content.split('\n') : []);

    for (const raw of lines) {
      const text = raw.trim();
      if (!text) continue;

      // "15 x Widget Name" / "15 × Widget"
      const leadingQty = text.match(/^(\d+)\s*[×xX]\s+(.+)/);
      if (leadingQty) {
        const name = leadingQty[2].replace(/\s+[\d.,]+.*$/, '').trim();
        if (name.length >= 2) {
          const match = matchToBoardItem(name, null, null, boardItems);
          lineItems.push({ raw_name: name, quantity: parseInt(leadingQty[1], 10), unit_price: null, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
          continue;
        }
      }
      // "Widget Name - Qty: 15" / "Widget Name qty 15"
      const trailingQty = text.match(/^(.+?)\s*(?:[-–—]?\s*(?:qty|quantity|delivered|received|pcs|units|x|×)[:.\s]+)(\d+)\s*$/i);
      if (trailingQty) {
        const name = trailingQty[1].trim();
        if (name.length >= 2) {
          const match = matchToBoardItem(name, null, null, boardItems);
          lineItems.push({ raw_name: name, quantity: parseInt(trailingQty[2], 10), unit_price: null, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
          continue;
        }
      }
      // "Widget Name     15" (2+ spaces before trailing number)
      const endNumber = text.match(/^(.{5,}?)\s{2,}(\d+)\s*$/);
      if (endNumber) {
        const name = endNumber[1].trim();
        if (name.length >= 2) {
          const match = matchToBoardItem(name, null, null, boardItems);
          lineItems.push({ raw_name: name, quantity: parseInt(endNumber[2], 10), unit_price: null, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
        }
      }
    }
    console.log('[parseDeliveryNote] text extraction got', lineItems.length, 'items');
  }

  // ── Metadata from key-value pairs ────────────────────────────────────────
  let supplierName: string | null = null;
  let invoiceDate: string | null = null;
  for (const kv of analyzeResult?.keyValuePairs || []) {
    const key   = (kv.key?.content || '').toLowerCase();
    const value = kv.value?.content || '';
    if (!supplierName && /supplier|vendor|from/.test(key)) supplierName = value;
    if (!invoiceDate  && /date|dispatch/.test(key))         invoiceDate  = value;
  }

  return { invoiceNumber: null, invoiceDate, supplierName, totalAmount: null, currency: null, lineItems };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

  // Submit to Azure prebuilt-document model (works with any document format)
  const analyzeUrl = `${AZURE_ENDPOINT.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-document:analyze?api-version=${AZURE_API_VER}`;
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
