// Supabase Edge Function: parseDeliveryNote
//
// Uses Azure Document Intelligence (prebuilt-document model) to extract
// line items from a delivery note or shopping receipt, then fuzzy-matches
// them against provisioning board items.
//
// For receipts: auto-detects document type, extracts items from price-per-line
// format, calls Anthropic Claude to expand abbreviations / translate foreign
// language item names to English, then matches expanded names against board items.
//
// Uses the same AZURE_DOC_INTELLIGENCE_* env vars as azureDocumentParser.
// Receipt AI expansion requires ANTHROPIC_API_KEY env var.
//
// Request body: { base64: string, mediaType: string, batchItems: ProvItem[] }
// Response: { document_type, invoice_number, invoice_date, supplier_name,
//             total_amount, currency,
//             line_items: [{ raw_name, original_name?, quantity, unit_price,
//                            line_total, unit, matched_item_id,
//                            match_confidence, discrepancy }] }

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

// ── Document type detection ───────────────────────────────────────────────────

function detectDocumentType(analyzeResult: any): 'receipt' | 'delivery_note' {
  const content = (analyzeResult?.content || '').toLowerCase();

  const receiptSignals = [
    /\btotal\b.*[€$£¥]?\s*\d/i.test(content),
    /\bsubtotal\b/i.test(content),
    /\bchange\b.*\d/i.test(content),
    /\bcard\b.*\bpayment\b|\bvisa\b|\bmastercard\b/i.test(content),
    /\breceipt\b|\breçu\b|\bticket\b|\bbon\b/i.test(content),
    /\btva\b|\bvat\b|\biva\b|\bmwst\b/i.test(content),
    /\bcash\b|\bpaid\b|\bpayé\b/i.test(content),
  ];

  const deliverySignals = [
    /deliver(ed|y)?\s*qty/i.test(content),
    /order(ed)?\s*qty/i.test(content),
    /item\s*ref/i.test(content),
    /dispatch|shipment|consignment/i.test(content),
    /outstanding/i.test(content),
    /delivery\s*note|packing\s*list|dispatch\s*note/i.test(content),
  ];

  const receiptScore  = receiptSignals.filter(Boolean).length;
  const deliveryScore = deliverySignals.filter(Boolean).length;

  console.log('[parseDeliveryNote] Document type detection — receipt signals:', receiptScore, 'delivery signals:', deliveryScore);

  return receiptScore > deliveryScore ? 'receipt' : 'delivery_note';
}

// ── Receipt item extraction ───────────────────────────────────────────────────

function extractReceiptItems(analyzeResult: any, boardItems: any[]) {
  const lineItems: any[] = [];

  // Try table extraction first (some receipt OCR returns item | price columns)
  for (const table of analyzeResult?.tables || []) {
    if (table.columnCount < 2 || table.rowCount < 2) continue;
    const cells = table.cells || [];

    for (let r = 0; r < table.rowCount; r++) {
      const rowCells = cells.filter((c: any) => c.rowIndex === r);
      if (rowCells.length < 2) continue;

      const nameCell  = rowCells[0]?.content?.trim() || '';
      const priceCell = rowCells[rowCells.length - 1]?.content?.trim() || '';
      if (!nameCell || nameCell.length < 2) continue;

      const lower = nameCell.toLowerCase();
      if (/^(total|subtotal|tax|tva|vat|iva|change|cash|card|visa|mastercard|paid|payment|receipt|merci|thank)/i.test(lower)) continue;

      const priceMatch = priceCell.match(/[€$£¥]?\s*(\d+[.,]\d{2})/);
      const unitPrice  = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

      let quantity = 1;
      let cleanName = nameCell;
      const leadQty  = nameCell.match(/^(\d+)\s*[xX×]\s+(.+)/);
      const trailQty = nameCell.match(/^(.+?)\s*[xX×]\s*(\d+)\s*$/);
      if (leadQty)       { quantity = parseInt(leadQty[1], 10);  cleanName = leadQty[2]; }
      else if (trailQty) { quantity = parseInt(trailQty[2], 10); cleanName = trailQty[1]; }

      const match = matchToBoardItem(cleanName, null, null, boardItems);
      lineItems.push({
        raw_name: cleanName, item_reference: null, quantity,
        ordered_qty: null, unit_price: unitPrice,
        line_total: unitPrice ? unitPrice * quantity : null,
        unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null,
      });
    }
    if (lineItems.length > 0) break;
  }

  // Fallback: parse raw text lines looking for "ITEM NAME    €2.49" pattern
  if (lineItems.length === 0 && analyzeResult?.content) {
    const lines = analyzeResult.content.split('\n').map((l: string) => l.trim()).filter(Boolean);

    for (const line of lines) {
      if (line.length < 4) continue;
      if (/^(total|subtotal|sous.total|tax|tva|vat|iva|mwst|change|cash|card|visa|mc|paid|payment|receipt|reçu|ticket|bon|merci|thank|gracias|danke|tel|adr|siret|siren|www\.|http)/i.test(line)) continue;
      if (/^\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}/.test(line)) continue;
      if (/^\*+$/.test(line) || /^[-=]+$/.test(line)) continue;

      const priceAtEnd = line.match(/^(.{3,}?)\s{2,}[€$£¥]?\s*(\d+[.,]\d{2})\s*[€$£¥A-Z]?\s*$/);
      if (!priceAtEnd) continue;

      let itemName = priceAtEnd[1].trim();
      const price  = parseFloat(priceAtEnd[2].replace(',', '.'));

      let qty = 1;
      const qtyPrefix = itemName.match(/^(\d+)\s*[xX×]\s+(.+)/);
      const qtySuffix = itemName.match(/^(.+?)\s*[xX×]\s*(\d+)\s*$/);
      if (qtyPrefix)      { qty = parseInt(qtyPrefix[1], 10); itemName = qtyPrefix[2]; }
      else if (qtySuffix) { qty = parseInt(qtySuffix[2], 10); itemName = qtySuffix[1]; }

      const match = matchToBoardItem(itemName, null, null, boardItems);
      lineItems.push({
        raw_name: itemName, item_reference: null, quantity: qty,
        ordered_qty: null, unit_price: price, line_total: price * qty,
        unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null,
      });
    }
  }

  return lineItems;
}

// ── Receipt metadata extraction ───────────────────────────────────────────────

function extractReceiptMetadata(content: string) {
  let supplierName: string | null    = null;
  let supplierPhone: string | null   = null;
  let totalAmount: number | null     = null;
  let currency: string | null        = null;
  let invoiceDate: string | null     = null;

  if (!content) return { supplierName, supplierPhone, totalAmount, currency, invoiceDate };

  const lines = content.split('\n').map((l: string) => l.trim()).filter(Boolean);

  // Store name: first short non-numeric non-header line near the top
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];
    if (line.length < 3) continue;
    if (/^\d/.test(line)) continue;
    if (/^(tel|fax|www|http|siret|siren)/i.test(line)) continue;
    if (!supplierName) { supplierName = line; break; }
  }

  // Phone
  for (const line of lines) {
    const phone = line.match(/(?:tel|phone|tél)[.:\s]*([+\d\s().-]{8,})/i) || line.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (phone && !supplierPhone) { supplierPhone = (phone[1] || phone[0]).trim(); break; }
  }

  // Total (scan from bottom)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/(?:total|à payer|te betalen|zu zahlen|a pagar)\s*[:\s]*[€$£¥]?\s*(\d+[.,]\d{2})/i);
    if (m) { totalAmount = parseFloat(m[1].replace(',', '.')); break; }
  }

  // Currency
  if (/€/.test(content))       currency = 'EUR';
  else if (/£/.test(content))  currency = 'GBP';
  else if (/\$/.test(content)) currency = 'USD';

  // Date
  const dateMatch = content.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
  if (dateMatch) invoiceDate = dateMatch[1];

  return { supplierName, supplierPhone, totalAmount, currency, invoiceDate };
}

// ── AI expansion of abbreviated / foreign-language receipt names ──────────────

async function expandReceiptItems(items: any[]): Promise<any[]> {
  if (!items.length) return items;

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!ANTHROPIC_API_KEY) {
    console.log('[parseDeliveryNote] No ANTHROPIC_API_KEY — skipping item expansion');
    return items;
  }

  const itemNames = items.map((i: any) => i.raw_name);
  console.log('[parseDeliveryNote] Expanding', itemNames.length, 'receipt items via Claude');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `These are item names from a shopping receipt. They may be abbreviated, in a foreign language, or both. For each item, return the full English product name. Keep brand names if recognisable. Return ONLY a JSON array of strings in the same order, nothing else. No markdown, no backticks.

Items:
${itemNames.map((n: string, i: number) => `${i + 1}. ${n}`).join('\n')}

Example input: ["BRD WHL SLCD", "LAIT DM-ECR 1L", "ACEITE OLIVA VRG", "EVIAN 1.5L X6"]
Example output: ["Wholemeal Sliced Bread", "Semi-Skimmed Milk 1L", "Extra Virgin Olive Oil", "Evian Water 1.5L x6"]`,
        }],
      }),
    });

    if (!response.ok) {
      console.error('[parseDeliveryNote] Anthropic API error:', response.status);
      return items;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    console.log('[parseDeliveryNote] Anthropic response:', text.slice(0, 300));

    const expanded = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (Array.isArray(expanded) && expanded.length === items.length) {
      console.log('[parseDeliveryNote] Expanded names:', expanded);
      return items.map((item: any, i: number) => ({
        ...item,
        raw_name:      expanded[i] || item.raw_name,
        original_name: item.raw_name,
      }));
    }

    console.warn('[parseDeliveryNote] Expanded array length mismatch — using originals');
    return items;
  } catch (e: any) {
    console.error('[parseDeliveryNote] AI expansion failed:', e?.message);
    return items;
  }
}

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

async function extractLineItems(analyzeResult: any, boardItems: any[], documentType: 'receipt' | 'delivery_note') {

  // ── Receipt path ──────────────────────────────────────────────────────────
  if (documentType === 'receipt') {
    console.log('[parseDeliveryNote] Receipt mode — using receipt extractor');
    let receiptItems = extractReceiptItems(analyzeResult, boardItems);
    console.log('[parseDeliveryNote] Receipt raw items:', receiptItems.length);

    // Expand abbreviations / translate to English, then re-match board items
    receiptItems = await expandReceiptItems(receiptItems);

    // Re-run board matching on expanded English names
    receiptItems = receiptItems.map((item: any) => {
      const match = matchToBoardItem(item.raw_name, null, null, boardItems);
      return { ...item, matched_item_id: match.id, match_confidence: match.confidence };
    });

    const { supplierName, supplierPhone, totalAmount, currency, invoiceDate } =
      extractReceiptMetadata(analyzeResult?.content || '');

    console.log('[parseDeliveryNote] Receipt extracted', receiptItems.length, 'items; metadata:', { supplierName, totalAmount, currency });

    return {
      invoiceNumber: null, invoiceDate, supplierName, supplierPhone,
      supplierEmail: null, supplierAddress: null,
      orderRef: null, orderDate: null,
      totalAmount, currency,
      lineItems: receiptItems,
    };
  }

  // ── Delivery note path (original logic — unchanged) ───────────────────────
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
    let refCol = -1, nameCol = -1, orderedQtyCol = -1, qtyCol = -1, unitCol = -1, priceCol = -1, totalCol = -1;
    const headerCells = cells.filter((c: any) => c.kind === 'columnHeader');
    for (const hc of headerCells) {
      const h = (hc.content || '').toLowerCase();
      if (refCol        === -1 && /\b(ref|code|sku|article\s*no|item\s*no|part\s*no)\b/.test(h))         refCol        = hc.columnIndex;
      if (nameCol       === -1 && /product|description|item|article|name/.test(h))                        nameCol       = hc.columnIndex;
      if (orderedQtyCol === -1 && /order(ed)?|requir|request/.test(h))                                    orderedQtyCol = hc.columnIndex;
      if (qtyCol        === -1 && /deliver|receiv|dispatch|qty|quantity|amount/.test(h))                   qtyCol        = hc.columnIndex;
      if (unitCol       === -1 && /\b(unit|uom|each|measure)\b/.test(h))                                  unitCol       = hc.columnIndex;
      if (priceCol      === -1 && /unit\s*price|unit\s*cost|price\s*each/.test(h))                        priceCol      = hc.columnIndex;
      if (totalCol      === -1 && /\b(total|amount|value|line\s*total|ext)\b/.test(h))                    totalCol      = hc.columnIndex;
    }
    console.log('[parseDeliveryNote] header cells:', headerCells.map((c: any) => `col${c.columnIndex}="${c.content}"`));

    // Step 2: row 0 as header fallback
    if (nameCol === -1 && qtyCol === -1) {
      for (const c of cells.filter((c: any) => c.rowIndex === 0)) {
        const h = (c.content || '').toLowerCase();
        if (refCol        === -1 && /\b(ref|code|sku|article\s*no|item\s*no|part\s*no)\b/.test(h))         refCol        = c.columnIndex;
        if (nameCol       === -1 && /product|description|item|article|name/.test(h))                        nameCol       = c.columnIndex;
        if (orderedQtyCol === -1 && /order(ed)?|requir|request/.test(h))                                    orderedQtyCol = c.columnIndex;
        if (qtyCol        === -1 && /deliver|receiv|dispatch|qty|quantity|amount/.test(h))                   qtyCol        = c.columnIndex;
        if (unitCol       === -1 && /\b(unit|uom|each|measure)\b/.test(h))                                  unitCol       = c.columnIndex;
        if (priceCol      === -1 && /unit\s*price|unit\s*cost|price\s*each/.test(h))                        priceCol      = c.columnIndex;
        if (totalCol      === -1 && /\b(total|amount|value|line\s*total|ext)\b/.test(h))                    totalCol      = c.columnIndex;
      }
    }

    // Step 3: positional defaults if still undetected
    if (nameCol === -1) nameCol = 1;  // typically 2nd column
    if (qtyCol  === -1) qtyCol  = 3;  // typically 4th column (DELIVERED QTY)
    console.log('[parseDeliveryNote] Table columns — ref:', refCol, 'name:', nameCol, 'orderedQty:', orderedQtyCol, 'qty:', qtyCol, 'unit:', unitCol, 'price:', priceCol, 'total:', totalCol);

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
      const rawName    = (row[nameCol]  || '').trim();
      const qtyStr     = (row[qtyCol]   || '').trim();
      const priceStr   = priceCol  >= 0 ? (row[priceCol]  || '').trim() : '';
      const totalStr   = totalCol  >= 0 ? (row[totalCol]  || '').trim() : '';
      const unitStr    = unitCol   >= 0 ? (row[unitCol]   || '').trim() : '';
      const refStr     = refCol    >= 0 ? (row[refCol]    || '').trim() : '';
      const ordQtyStr  = orderedQtyCol >= 0 ? (row[orderedQtyCol] || '').trim() : '';

      if (!rawName || rawName === '-') continue;

      const quantity    = parseInt(qtyStr.replace(/[^0-9]/g, ''), 10) || null;
      const orderedQty  = ordQtyStr ? (parseInt(ordQtyStr.replace(/[^0-9]/g, ''), 10) || null) : null;
      const unitPrice   = priceStr  ? (parseFloat(priceStr.replace(/[^0-9.]/g, ''))   || null) : null;
      const lineTotal   = totalStr  ? (parseFloat(totalStr.replace(/[^0-9.]/g, ''))   || null) : null;
      const unit        = unitStr   || null;
      const itemRef     = refStr    || null;
      const match       = matchToBoardItem(rawName, null, null, boardItems);

      lineItems.push({ raw_name: rawName, item_reference: itemRef, quantity, ordered_qty: orderedQty, unit_price: unitPrice, line_total: lineTotal, unit, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
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
          lineItems.push({ raw_name: name, item_reference: null, quantity: parseInt(leadingQty[1], 10), ordered_qty: null, unit_price: null, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
          continue;
        }
      }
      // "Widget Name - Qty: 15" / "Widget Name qty 15"
      const trailingQty = text.match(/^(.+?)\s*(?:[-–—]?\s*(?:qty|quantity|delivered|received|pcs|units|x|×)[:.\s]+)(\d+)\s*$/i);
      if (trailingQty) {
        const name = trailingQty[1].trim();
        if (name.length >= 2) {
          const match = matchToBoardItem(name, null, null, boardItems);
          lineItems.push({ raw_name: name, item_reference: null, quantity: parseInt(trailingQty[2], 10), ordered_qty: null, unit_price: null, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
          continue;
        }
      }
      // "Widget Name     15" (2+ spaces before trailing number)
      const endNumber = text.match(/^(.{5,}?)\s{2,}(\d+)\s*$/);
      if (endNumber) {
        const name = endNumber[1].trim();
        if (name.length >= 2) {
          const match = matchToBoardItem(name, null, null, boardItems);
          lineItems.push({ raw_name: name, item_reference: null, quantity: parseInt(endNumber[2], 10), ordered_qty: null, unit_price: null, line_total: null, unit: null, matched_item_id: match.id, match_confidence: match.confidence, discrepancy: null });
        }
      }
    }
    console.log('[parseDeliveryNote] text extraction got', lineItems.length, 'items');
  }

  // ── Metadata from key-value pairs ────────────────────────────────────────
  let supplierName: string | null = null;
  let supplierPhone: string | null = null;
  let supplierEmail: string | null = null;
  let supplierAddress: string | null = null;
  let invoiceNumber: string | null = null;
  let invoiceDate: string | null = null;
  let orderRef: string | null = null;
  let orderDate: string | null = null;

  for (const kv of analyzeResult?.keyValuePairs || []) {
    const key   = (kv.key?.content || '').toLowerCase();
    const value = (kv.value?.content || '').trim();
    if (!value) continue;

    if (!supplierName    && /organization|supplier|vendor|company|from/.test(key))            supplierName    = value;
    if (!invoiceNumber   && /invoice\s*(no|num|number|id|ref)/.test(key))                     invoiceNumber   = value;
    if (!invoiceDate     && /invoice\s*date/.test(key))                                       invoiceDate     = value;
    if (!orderRef        && /order\s*(id|ref|number|no)|reference|delivery\s*(ref|no)/.test(key)) orderRef   = value;
    if (!orderDate       && /order\s*date|dispatch\s*date|delivery\s*date/.test(key))         orderDate       = value;
    if (!supplierPhone   && /phone|tel/.test(key))                                            supplierPhone   = value;
    if (!supplierEmail   && /email/.test(key))                                                supplierEmail   = value;
    if (!supplierAddress && /address/.test(key))                                              supplierAddress = value;
    // Fallback: generic "date" only if nothing more specific matched yet
    if (!invoiceDate     && /\bdate\b/.test(key))                                             invoiceDate     = value;
  }

  console.log('[parseDeliveryNote] Extracted metadata:', { supplierName, supplierPhone, supplierEmail, supplierAddress, invoiceNumber, invoiceDate, orderRef, orderDate });

  return { invoiceNumber, invoiceDate, supplierName, supplierPhone, supplierEmail, supplierAddress, orderRef, orderDate, totalAmount: null, currency: null, lineItems };
} // end extractLineItems

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

    const documentType = detectDocumentType(analyzeResult);
    console.log('[parseDeliveryNote] Detected document type:', documentType);

    const { invoiceNumber, invoiceDate, supplierName, supplierPhone, supplierEmail, supplierAddress, orderRef, orderDate, totalAmount, currency, lineItems } = await extractLineItems(analyzeResult, batchItems, documentType);
    console.log('[parseDeliveryNote] Extracted', lineItems.length, 'line items; matched:', lineItems.filter((l: any) => l.matched_item_id).length);

    const response = {
      document_type:    documentType,
      invoice_number:   invoiceNumber,
      invoice_date:     invoiceDate,
      supplier_name:    supplierName,
      supplier_phone:   supplierPhone,
      supplier_email:   supplierEmail,
      supplier_address: supplierAddress,
      order_ref:        orderRef,
      order_date:       orderDate,
      total_amount:     totalAmount,
      currency,
      line_items:       lineItems,
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
