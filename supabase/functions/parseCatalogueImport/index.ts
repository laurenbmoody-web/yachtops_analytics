// Supabase Edge Function: parseCatalogueImport
//
// Turns a supplier's existing price list into structured catalogue rows so
// onboarding is "upload the file you already have" instead of retyping
// hundreds of products.
//
// Two input modes:
//   { kind: 'rows', headers: string[], rows: string[][] }
//     — spreadsheet/CSV already extracted client-side (exceljs / csv parse).
//   { kind: 'document', base64: string, mediaType: string }
//     — PDF or photo of a price list. OCR'd with Azure Document Intelligence
//       (same prebuilt-layout pipeline as parseDeliveryNote), then structured.
//
// Both paths feed Claude, which normalises each product line into:
//   { name, sku, barcode, category, unit, pack_size, pack_unit, unit_size,
//     unit_price, currency, description, stock_qty }
//
// Response: { items: ParsedItem[], warnings: string[] }
//
// Env: ANTHROPIC_API_KEY (required),
//      AZURE_DOC_INTELLIGENCE_ENDPOINT / _KEY (document mode only).

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Fixed category vocabulary — mirrors CATEGORIES in SupplierProducts.jsx.
const CATEGORIES = ['Produce', 'Meat & Fish', 'Dairy', 'Beverages', 'Dry Goods', 'Frozen', 'Cleaning', 'Other'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

// ── Azure OCR (document mode) — same pipeline as parseDeliveryNote ──────────

const AZURE_ENDPOINT = Deno.env.get('AZURE_DOC_INTELLIGENCE_ENDPOINT') || '';
const AZURE_KEY = Deno.env.get('AZURE_DOC_INTELLIGENCE_KEY') || '';
const AZURE_API_VER_DEFAULT = '2024-11-30';
const RETIRED_AZURE_API_VERS = new Set([
  '2023-07-31', '2023-10-31-preview', '2024-02-29-preview', '2024-07-31-preview',
]);
const _envVer = Deno.env.get('AZURE_DOC_INTELLIGENCE_API_VERSION') || '';
const AZURE_API_VER = (_envVer && !RETIRED_AZURE_API_VERS.has(_envVer)) ? _envVer : AZURE_API_VER_DEFAULT;

function sniffMediaType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1'].includes(brand)) return 'image/heic';
  }
  return null;
}

async function pollOperation(operationLocation: string, maxAttempts = 60, intervalMs = 2000): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(operationLocation, { headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY } });
    if (!res.ok) throw new Error(`Azure poll error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data?.status === 'succeeded') return data?.analyzeResult;
    if (data?.status === 'failed') throw new Error(`Azure analysis failed: ${data?.error?.message || 'unknown'}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Azure analysis timed out');
}

async function ocrDocument(base64: string, mediaType: string): Promise<string> {
  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    throw new Error('Azure Document Intelligence credentials not configured. Set AZURE_DOC_INTELLIGENCE_ENDPOINT and AZURE_DOC_INTELLIGENCE_KEY.');
  }
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const sniffed = sniffMediaType(bytes);
  const effectiveMediaType = (sniffed && sniffed !== mediaType) ? sniffed : mediaType;

  const analyzeUrl = `${AZURE_ENDPOINT.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${AZURE_API_VER}`;
  const submitRes = await fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY, 'Content-Type': effectiveMediaType },
    body: bytes,
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    console.error('[parseCatalogueImport] Azure submit error:', errText.slice(0, 500));
    throw new Error(`OCR failed (${submitRes.status}). The file may be corrupted, password-protected, or too large.`);
  }
  const operationLocation = submitRes.headers.get('operation-location');
  if (!operationLocation) throw new Error('Azure did not return an operation-location header');

  const analyzeResult = await pollOperation(operationLocation);

  // Flatten tables row-by-row (column order intact) + body text, same shape
  // the quote extractor in parseDeliveryNote feeds to Claude.
  const tableText = (analyzeResult?.tables || []).map((t: any, ti: number) => {
    const rows: Record<number, string[]> = {};
    (t.cells || []).forEach((c: any) => {
      (rows[c.rowIndex] ||= [])[c.columnIndex] = (c.content || '').trim();
    });
    const lines = Object.keys(rows).sort((a, b) => +a - +b).map((r) => (rows[+r] || []).join(' | '));
    return `TABLE ${ti + 1}:\n${lines.join('\n')}`;
  }).join('\n\n');
  const bodyText = (analyzeResult?.content || '').slice(0, 30000);
  return `${tableText}\n\n${bodyText}`.trim();
}

// ── Claude structuring ───────────────────────────────────────────────────────

const ITEM_SCHEMA_PROMPT = `Return ONLY a JSON array (no markdown, no backticks) of product objects:
[{
  "name": string,              // clean product name WITHOUT size/pack info (e.g. "San Pellegrino Sparkling Water")
  "sku": string|null,          // supplier's own product code/ref if present
  "barcode": string|null,      // EAN/GTIN/UPC if present (8-14 digits)
  "category": string,          // EXACTLY one of: ${CATEGORIES.join(', ')}
  "unit": string,              // the sell unit: "each", "case", "box", "kg", "L", "bottle", ...
  "pack_size": number|null,    // inner units per sell unit (e.g. 24 for a case of 24) — null if sold singly
  "pack_unit": string|null,    // what the inner unit is (e.g. "bottle", "can") — null if sold singly
  "unit_size": string|null,    // size of one inner unit (e.g. "330ml", "1kg", "75cl")
  "unit_price": number|null,   // price for ONE sell unit, decimal point, no currency symbol
  "currency": string,          // EXACTLY one of: ${CURRENCIES.join(', ')} — infer from symbols/context, default EUR
  "description": string|null,  // extra useful detail (origin, grade, brand notes), null if none
  "stock_qty": number|null     // stock/availability quantity if the document lists one, else null
}]

Rules:
- One object per real product line. EXCLUDE section headings, page headers/footers, totals, terms, contact details.
- Translate foreign-language names to English but KEEP brand names as-is.
- If a line shows "24 x 330ml" or "case of 12", that is pack_size/pack_unit/unit_size — strip it out of name.
- unit_price is the price of one SELL unit (the case, if sold by the case), never a line total.
- Never invent data: unknown fields are null. But name, category, unit, currency are always required.`;

async function structureWithClaude(chunkText: string, apiKey: string): Promise<any[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are converting a marine/food supplier's PRICE LIST into structured catalogue entries for a yacht provisioning platform.

${ITEM_SCHEMA_PROMPT}

PRICE LIST CONTENT:
${chunkText}`,
      }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[parseCatalogueImport] Anthropic error:', res.status, errText.slice(0, 300));
    throw new Error(`AI parsing failed (${res.status}). Try again in a moment.`);
  }
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

// ── Validation / normalisation of Claude output ──────────────────────────────

function normaliseItem(raw: any): any | null {
  const name = String(raw?.name || '').trim();
  if (!name || name.length < 2) return null;

  const num = (v: any) => {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: any) => {
    const s = v == null ? '' : String(v).trim();
    return s ? s : null;
  };

  const barcode = str(raw?.barcode);
  return {
    name,
    sku: str(raw?.sku),
    barcode: barcode && /^\d{8,14}$/.test(barcode.replace(/\s/g, '')) ? barcode.replace(/\s/g, '') : barcode,
    category: CATEGORIES.includes(raw?.category) ? raw.category : 'Other',
    unit: str(raw?.unit) || 'each',
    pack_size: num(raw?.pack_size),
    pack_unit: str(raw?.pack_unit),
    unit_size: str(raw?.unit_size),
    unit_price: num(raw?.unit_price),
    currency: CURRENCIES.includes(raw?.currency) ? raw.currency : 'EUR',
    description: str(raw?.description),
    stock_qty: num(raw?.stock_qty),
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed. Use POST.' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured on server' }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const warnings: string[] = [];
  let chunks: string[] = [];

  try {
    if (body?.kind === 'rows') {
      const headers: string[] = Array.isArray(body.headers) ? body.headers : [];
      const rows: string[][] = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ error: 'No rows to parse' }, 400);

      const MAX_ROWS = 1500;
      const usable = rows.slice(0, MAX_ROWS);
      if (rows.length > MAX_ROWS) {
        warnings.push(`Only the first ${MAX_ROWS} rows were parsed (${rows.length} supplied). Import the remainder in a second file.`);
      }
      // ~60 rows per Claude call keeps each response well inside max_tokens.
      const ROWS_PER_CHUNK = 60;
      const headerLine = headers.join(' | ');
      for (let i = 0; i < usable.length; i += ROWS_PER_CHUNK) {
        const slice = usable.slice(i, i + ROWS_PER_CHUNK);
        chunks.push(`COLUMNS: ${headerLine}\nROWS:\n${slice.map((r) => (r || []).join(' | ')).join('\n')}`);
      }
    } else if (body?.kind === 'document') {
      if (!body.base64 || !body.mediaType) return json({ error: 'Missing base64 or mediaType' }, 400);
      const ocrText = await ocrDocument(body.base64, body.mediaType);
      if (!ocrText || ocrText.length < 20) return json({ error: 'OCR produced no readable text from this document.' }, 422);
      // Chunk long OCR text on line boundaries.
      const MAX_CHARS = 14000;
      const lines = ocrText.split('\n');
      let current = '';
      for (const line of lines) {
        if (current.length + line.length + 1 > MAX_CHARS && current) {
          chunks.push(current);
          current = '';
        }
        current += (current ? '\n' : '') + line;
      }
      if (current) chunks.push(current);
    } else {
      return json({ error: 'Missing or invalid "kind" (use "rows" or "document")' }, 400);
    }

    // Sequential — keeps peak memory and Anthropic rate usage predictable.
    const items: any[] = [];
    for (const chunk of chunks) {
      const parsed = await structureWithClaude(chunk, apiKey);
      for (const raw of parsed) {
        const item = normaliseItem(raw);
        if (item) items.push(item);
      }
    }

    if (!items.length) {
      warnings.push('No products could be extracted. Check the file contains a product list with names and prices.');
    }

    console.log('[parseCatalogueImport] kind:', body.kind, '| chunks:', chunks.length, '| items:', items.length);
    return json({ items, warnings });
  } catch (err: any) {
    console.error('[parseCatalogueImport] Error:', err?.message);
    return json({ error: err?.message || 'Internal server error' }, 500);
  }
});
