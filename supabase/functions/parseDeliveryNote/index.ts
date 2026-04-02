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

// ── Match extracted items to board items ─────────────────────────────────────

function matchToBoardItem(rawName: string, brand: string | null, size: string | null, boardItems: any[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 1);

  const extractedNorm  = norm(rawName);
  const extractedWords = words(rawName);

  console.log(`[parseDeliveryNote] === MATCH: "${rawName}" → normalised: "${extractedNorm}" ===`);
  console.log('[parseDeliveryNote] Board items available:', boardItems.length, '→', boardItems.map((b) => b.name));

  let bestId: string | null = null;
  let bestScore = 0;

  for (const bi of boardItems) {
    const boardNorm  = norm(bi.name || '');
    const boardWords = words(bi.name || '');
    let score = 0;

    // Substring containment (handles "Wireless Network Adapter" ↔ "network adapter")
    const fwdContains = extractedNorm.includes(boardNorm);
    const revContains = boardNorm.includes(extractedNorm);
    const containsMatch = fwdContains || revContains;
    if (containsMatch) {
      score = 80;
    } else {
      // Word overlap: count board words that appear (or partially appear) in extracted words
      const matchingWords = boardWords.filter((bw) =>
        extractedWords.some((ew) => ew.includes(bw) || bw.includes(ew))
      );
      const wordScore = boardWords.length > 0 ? matchingWords.length / boardWords.length : 0;
      if (wordScore > 0.5) {
        score = 60 + (wordScore * 20);
      } else if (matchingWords.length >= 1) {
        score = 40 + (matchingWords.length * 10);
      }
    }

    // Brand bonus
    if (brand && bi.brand) {
      const bl = norm(brand);
      const bil = norm(bi.brand as string);
      if (bl.includes(bil) || bil.includes(bl)) score += 15;
    }

    // Size bonus
    if (size && bi.size) {
      if (norm(size) === norm(bi.size as string)) score += 10;
    }

    console.log(`[parseDeliveryNote]   vs "${bi.name}" (norm: "${boardNorm}") → fwd:${fwdContains} rev:${revContains} score:${score}`);

    if (score > bestScore) { bestScore = score; bestId = bi.id; }
  }

  const result = bestScore >= 40
    ? { id: bestId, confidence: bestScore >= 75 ? 'high' : bestScore >= 60 ? 'medium' : 'low' }
    : { id: null, confidence: 'none' };
  console.log(`[parseDeliveryNote]   RESULT: score=${bestScore} confidence=${result.confidence} id=${result.id}`);
  return result;
}

// ── Build a line item result object ──────────────────────────────────────────

function makeLineItem(rawName: string, quantity: number | null, unitPrice: number | null, lineTotal: number | null, unit: string | null, boardItems: any[]) {
  const match = matchToBoardItem(rawName, null, null, boardItems);
  return { raw_name: rawName, quantity, unit_price: unitPrice, line_total: lineTotal, unit, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null };
}

// ── Table extraction with header-keyword column detection ─────────────────────

function extractFromTables(tables: any[], boardItems: any[]): any[] {
  const items: any[] = [];

  for (const table of tables) {
    if ((table.rowCount || 0) < 2) continue;

    const cells: any[] = table.cells || [];

    // --- Step 1: detect column roles from explicit header cells (kind === 'columnHeader')
    let nameCol = -1, qtyCol = -1, priceCol = -1;
    const headerCells = cells.filter((c: any) => c.kind === 'columnHeader');
    console.log('[parseDeliveryNote] table header cells:', headerCells.map((c: any) => `col${c.columnIndex}="${c.content}"`));

    for (const hc of headerCells) {
      const h = (hc.content || '').toLowerCase();
      if (nameCol  === -1 && /product|description|item|article|name/.test(h)) nameCol  = hc.columnIndex;
      if (qtyCol   === -1 && /delivered|received|qty|quantity/.test(h))        qtyCol   = hc.columnIndex;
      if (priceCol === -1 && /price|cost|each|unit/.test(h))                   priceCol = hc.columnIndex;
    }

    // --- Step 2: if no header cells, try first data row as header
    if (nameCol === -1 && qtyCol === -1) {
      const row0 = cells.filter((c: any) => c.rowIndex === 0).sort((a: any, b: any) => a.columnIndex - b.columnIndex);
      console.log('[parseDeliveryNote] no header cells — using row 0 as header:', row0.map((c: any) => c.content));
      for (const c of row0) {
        const h = (c.content || '').toLowerCase();
        if (nameCol  === -1 && /product|description|item|article|name/.test(h)) nameCol  = c.columnIndex;
        if (qtyCol   === -1 && /delivered|received|qty|quantity/.test(h))        qtyCol   = c.columnIndex;
        if (priceCol === -1 && /price|cost|each|unit/.test(h))                   priceCol = c.columnIndex;
      }
    }

    // --- Step 3: positional fallback — longest avg text column = name; first pure-number column = qty
    const dataStartRow = headerCells.length > 0 ? 1 : (nameCol === -1 && qtyCol === -1 ? 1 : 1);
    if (nameCol === -1 || qtyCol === -1) {
      const colCount = table.columnCount || 0;
      const colTexts: string[][] = Array.from({ length: colCount }, () => []);
      for (const c of cells) {
        if (c.rowIndex >= dataStartRow) colTexts[c.columnIndex]?.push(c.content || '');
      }
      // Name column: highest average text length
      if (nameCol === -1) {
        let maxAvg = 0;
        colTexts.forEach((col, i) => {
          const avg = col.reduce((s, v) => s + v.length, 0) / (col.length || 1);
          if (avg > maxAvg) { maxAvg = avg; nameCol = i; }
        });
      }
      // Qty column: first column (other than name) whose values are all short numbers
      if (qtyCol === -1) {
        for (let i = 0; i < colTexts.length; i++) {
          if (i === nameCol) continue;
          const allNumeric = colTexts[i].length > 0 && colTexts[i].every((v) => /^\s*\d+(\.\d+)?\s*$/.test(v));
          if (allNumeric) { qtyCol = i; break; }
        }
      }
    }

    console.log('[parseDeliveryNote] final col mapping — name:', nameCol, 'qty:', qtyCol, 'price:', priceCol);

    // --- Step 4: extract data rows
    const maxRow = table.rowCount;
    for (let r = dataStartRow; r < maxRow; r++) {
      const row: Record<number, string> = {};
      for (const c of cells) { if (c.rowIndex === r) row[c.columnIndex] = c.content || ''; }

      const rawName = nameCol >= 0 ? (row[nameCol] || '').trim() : Object.values(row).find((v) => v.trim().length > 3) || '';
      if (!rawName || rawName === '-') continue;

      const qtyStr  = qtyCol  >= 0 ? row[qtyCol]  || '' : '';
      const priceStr = priceCol >= 0 ? row[priceCol] || '' : '';
      const quantity  = parseFloat(qtyStr.replace(/[^0-9.]/g, '')) || null;
      const unitPrice = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || null;

      items.push(makeLineItem(rawName, quantity, unitPrice, null, null, boardItems));
    }

    if (items.length > 0) {
      console.log('[parseDeliveryNote] table extraction got', items.length, 'items');
      break; // stop after first productive table
    }
  }

  return items;
}

// ── Text / paragraph extraction ───────────────────────────────────────────────

function extractFromText(analyzeResult: any, boardItems: any[]): any[] {
  const items: any[] = [];
  const lines: string[] = [];

  // Collect text: paragraphs preferred, else split content
  if (analyzeResult?.paragraphs?.length) {
    for (const p of analyzeResult.paragraphs) lines.push(p.content || '');
  } else if (typeof analyzeResult?.content === 'string') {
    lines.push(...analyzeResult.content.split('\n'));
  }

  console.log('[parseDeliveryNote] text extraction — lines to scan:', lines.length);

  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;

    // Pattern A: leading qty  — "15 x Widget Name" / "15x Widget" / "15 × Widget"
    const leadingQty = text.match(/^(\d+)\s*[×xX]\s+(.+)/);
    if (leadingQty) {
      const quantity = parseInt(leadingQty[1], 10);
      const name = leadingQty[2].replace(/\s+[\d.,]+.*$/, '').trim(); // strip trailing price
      if (name.length >= 2) { items.push(makeLineItem(name, quantity, null, null, null, boardItems)); continue; }
    }

    // Pattern B: trailing label — "Widget Name - Qty: 15" / "Widget Name qty 15" / "Widget Name × 15"
    const trailingQty = text.match(/^(.+?)\s*(?:[-–—]?\s*(?:qty|quantity|delivered|received|pcs|units|x|×)[:.\s]+)(\d+)\s*$/i);
    if (trailingQty) {
      const name = trailingQty[1].trim();
      const quantity = parseInt(trailingQty[2], 10);
      if (name.length >= 2) { items.push(makeLineItem(name, quantity, null, null, null, boardItems)); continue; }
    }

    // Pattern C: name then isolated number — "Widget Name ... 15" (number at end, separated by non-word)
    const endNumber = text.match(/^(.{5,}?)\s{2,}(\d+)\s*$/);
    if (endNumber) {
      const name = endNumber[1].trim();
      const quantity = parseInt(endNumber[2], 10);
      if (name.length >= 2) { items.push(makeLineItem(name, quantity, null, null, null, boardItems)); }
    }
  }

  console.log('[parseDeliveryNote] text extraction got', items.length, 'items');
  return items;
}

// ── Extract line items from Azure prebuilt-invoice result ────────────────────

function extractLineItems(analyzeResult: any, boardItems: any[]) {
  console.log('[parseDeliveryNote] analyzeResult top-level keys:', Object.keys(analyzeResult || {}));
  console.log('[parseDeliveryNote] tables found:', analyzeResult?.tables?.length ?? 0);
  console.log('[parseDeliveryNote] paragraphs found:', analyzeResult?.paragraphs?.length ?? 0);
  console.log('[parseDeliveryNote] documents found:', analyzeResult?.documents?.length ?? 0);

  // ── Matching debug summary ────────────────────────────────────────────────
  console.log('[parseDeliveryNote] === MATCHING DEBUG ===');
  console.log('[parseDeliveryNote] Board items received:', boardItems.length, JSON.stringify(boardItems.map((i: any) => i.name)));
  if (boardItems.length === 0) {
    console.warn('[parseDeliveryNote] WARNING: no board items passed in — nothing can match');
  }

  const doc    = analyzeResult?.documents?.[0];
  const fields = doc?.fields || {};

  const invoiceNumber = fields?.InvoiceId?.content || null;
  const invoiceDate   = fields?.InvoiceDate?.content || null;
  const supplierName  = fields?.VendorName?.content || null;
  const totalAmount   = fields?.InvoiceTotal?.value ?? null;
  const currency      = fields?.CurrencyCode?.content || null;

  // ── Tier-1: prebuilt-invoice structured Items field ───────────────────────
  const rawItems: any[] = fields?.Items?.valueArray || [];
  console.log('[parseDeliveryNote] tier-1 invoice items:', rawItems.length);

  let lineItems: any[] = rawItems.map((item: any) => {
    const f         = item?.valueObject || {};
    const rawName   = f?.Description?.content || f?.ProductCode?.content || 'Unknown item';
    const quantity  = f?.Quantity?.value ?? null;
    const unitPrice = f?.UnitPrice?.value ?? null;
    const lineTotal = f?.Amount?.value ?? null;
    const unit      = f?.Unit?.content || null;
    const match     = matchToBoardItem(rawName, null, null, boardItems);
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
    return { raw_name: rawName, quantity, unit_price: unitPrice, line_total: lineTotal, unit, matched_item_id: match.id, match_confidence: match.confidence, discrepancy };
  });

  // ── Tier-2: table extraction (header-keyword column detection) ────────────
  if (lineItems.length === 0 && (analyzeResult?.tables?.length ?? 0) > 0) {
    console.log('[parseDeliveryNote] tier-2: table extraction');
    lineItems = extractFromTables(analyzeResult.tables, boardItems);
  }

  // ── Tier-3: paragraph / text pattern extraction ───────────────────────────
  if (lineItems.length === 0) {
    console.log('[parseDeliveryNote] tier-3: text extraction');
    lineItems = extractFromText(analyzeResult, boardItems);
  }

  return { invoiceNumber, invoiceDate, supplierName, totalAmount, currency, lineItems };
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
