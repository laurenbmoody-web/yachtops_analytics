// Supabase Edge Function: generateSupplierInvoice
//
// Renders a supplier-branded HTML invoice, converts it to PDF via PDFShift,
// uploads the PDF to the private `supplier-invoices` storage bucket, writes
// the canonical row to `supplier_invoices`, and snapshots the per-line VAT
// rate onto `supplier_order_items` for historical accuracy.
//
// Env vars required:
//   PDFSHIFT_API_KEY                (Supabase secret)
//   SUPABASE_URL                    (auto-populated)
//   SUPABASE_SERVICE_ROLE_KEY       (auto-populated)
//
// Request body shape:
//   {
//     orderId: uuid,
//     options: {
//       // Pre-resolved per-line categories. The client (Generate Invoice
//       // modal) consults the country tax preset registry, applies the
//       // supplier's overrides + custom categories, and sends the
//       // effective rate here. Server-side we defence-check `bonded_supply`
//       // and force rates to 0 if set, but otherwise trust the input — the
//       // supplier is responsible for the rates on their own invoice.
//       lines: [{ item_id: uuid, category_key: string, rate: number, label?: string }],
//       issue_date?: string (ISO date, defaults to today),
//       due_date?: string (ISO date, defaults to issue + payment_terms_days),
//       payment_terms_days?: number (overrides supplier default),
//       notes?: string,
//       bonded_supply?: boolean (force all rates to 0),
//     }
//   }
//
// Response: { invoice_id, invoice_number, pdf_path, signed_url, expires_at }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PDFSHIFT_API_KEY        = Deno.env.get('PDFSHIFT_API_KEY') || '';
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PDFSHIFT_ENDPOINT       = 'https://api.pdfshift.io/v3/convert/pdf';
const SIGNED_URL_TTL_SECONDS  = 600; // 10 minutes
const BUCKET                  = 'supplier-invoices';

// ─── REST helpers (service-role) ─────────────────────────────────────────

const restHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function restGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders });
  if (!res.ok) throw new Error(`REST GET ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function restPost<T = any>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...restHeaders, Prefer: 'return=representation', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST POST ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function restPatch<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...restHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function rpc<T = any>(fnName: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: restHeaders,
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${fnName} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Resolve the calling user from the supplied JWT (Authorization header).
async function userFromJwt(authHeader: string): Promise<{ id: string; email: string } | null> {
  const token = authHeader.replace(/^Bearer\s+/, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { id: u.id, email: u.email } : null;
}

// ─── HTML template ───────────────────────────────────────────────────────

interface InvoiceRenderInput {
  supplier: any;
  order: any;
  items: any[];   // each annotated with _effectiveRate, _lineTotal, _vatLabel
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totals: { subtotal: number; total: number; vatTotal: number };
  vatBreakdown: Array<{ category_key: string; label: string; rate: number; taxable_amount: number; vat_amount: number }>;
  options: any;
}

const CARGO_WORDMARK_URL =
  'https://cargotechnology.netlify.app/assets/images/cargo_merged_originalmark_syne800_true.png';

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Format an amount with the supplier's currency. Right-aligned tabular figures
// in the CSS — this fn just produces the number string.
function fmtAmount(n: number): string {
  return (Number(n) || 0).toFixed(2);
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function renderAddress(s: any): string {
  const parts = [
    s.business_address_line1,
    s.business_address_line2,
    [s.business_postal_code, s.business_city].filter(Boolean).join(' '),
    s.business_state_region,
  ].filter(Boolean).map(escapeHtml);
  return parts.join('<br/>');
}

function renderBankBlock(supplier: any, invoiceNumber: string): string {
  const b = supplier.bank_details || {};
  if (!b.account_name && !b.iban && !b.account_number) return '';
  const rows: string[] = [];
  if (b.account_name)   rows.push(`<tr><th>Account name</th><td>${escapeHtml(b.account_name)}</td></tr>`);
  if (b.bank_name)      rows.push(`<tr><th>Bank</th><td>${escapeHtml(b.bank_name)}</td></tr>`);
  if (b.iban)           rows.push(`<tr><th>IBAN</th><td class="mono">${escapeHtml(b.iban)}</td></tr>`);
  if (b.bic_swift)      rows.push(`<tr><th>BIC / SWIFT</th><td class="mono">${escapeHtml(b.bic_swift)}</td></tr>`);
  if (b.sort_code)      rows.push(`<tr><th>Sort code</th><td class="mono">${escapeHtml(b.sort_code)}</td></tr>`);
  if (b.account_number) rows.push(`<tr><th>Account number</th><td class="mono">${escapeHtml(b.account_number)}</td></tr>`);
  rows.push(`<tr><th>Reference</th><td class="mono">${escapeHtml(invoiceNumber)}</td></tr>`);
  return `
    <section class="bank">
      <h3>Payment instructions</h3>
      <table>${rows.join('')}</table>
    </section>`;
}

function renderVatBreakdownRows(input: InvoiceRenderInput): string {
  // Single-rate invoices collapse to one "VAT" line; multi-rate invoices
  // surface per-category rows so the customer can see the maths.
  if (input.vatBreakdown.length <= 1) {
    return `<tr><td>VAT</td><td>${input.supplier.default_currency || 'EUR'} ${fmtAmount(input.totals.vatTotal)}</td></tr>`;
  }
  return input.vatBreakdown.map((b) => `
    <tr><td>VAT (${escapeHtml(b.label)}, ${b.rate.toFixed(1)}%)</td>
        <td>${input.supplier.default_currency || 'EUR'} ${fmtAmount(b.vat_amount)}</td></tr>
  `).join('');
}

function renderInvoiceHtml(input: InvoiceRenderInput): string {
  const cur = input.supplier.default_currency || 'EUR';
  const supplierName = escapeHtml(input.supplier.name || 'Supplier');
  const taxNumberLabel = 'VAT'; // Country-specific labels (TVA / IVA / GST) handled in registry; fall back to "VAT"
  const billToName = escapeHtml(input.order.vessel_name || input.order.yacht_name || 'Vessel');
  const isBonded = !!input.options.bonded_supply;

  const itemRows = input.items.map((it: any) => {
    const qty = `${it.quantity ?? ''}${it.unit ? ' ' + escapeHtml(it.unit) : ''}`.trim();
    const unitPrice = `${cur} ${fmtAmount(Number(it.unit_price) || 0)}`;
    const rate = `${(it._effectiveRate ?? 0).toFixed(1)}%`;
    const lineTotal = `${cur} ${fmtAmount(it._lineTotal ?? 0)}`;
    return `
      <tr>
        <td class="desc">
          <div class="item-name">${escapeHtml(it.item_name || '')}</div>
          ${it.notes ? `<div class="item-notes">${escapeHtml(it.notes)}</div>` : ''}
        </td>
        <td class="num">${qty}</td>
        <td class="num">${unitPrice}</td>
        <td class="num">${rate}</td>
        <td class="num">${lineTotal}</td>
      </tr>`;
  }).join('');

  const logoBlock = input.supplier.invoice_logo_url
    ? `<img src="${escapeHtml(input.supplier.invoice_logo_url)}" alt="${supplierName}" class="logo"/>`
    : `<div class="logo-fallback">${supplierName}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${escapeHtml(input.invoiceNumber)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #0F172A;
      font-size: 11px;
      line-height: 1.45;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { padding: 20mm 18mm 22mm; min-height: 297mm; position: relative; }

    /* Header */
    header.top {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 24px; padding-bottom: 14px;
      border-bottom: 1.5px solid #0F172A;
    }
    .supplier-block { font-size: 11px; line-height: 1.55; color: #334155; }
    .supplier-block .name {
      font-size: 16px; font-weight: 700; color: #0F172A;
      margin-bottom: 6px; letter-spacing: -0.005em;
    }
    .supplier-block .tax-id {
      margin-top: 6px; font-size: 10.5px; color: #475569;
    }
    .logo { max-height: 56px; max-width: 200px; display: block; margin-bottom: 8px; }
    .logo-fallback {
      font-size: 22px; font-weight: 800; color: #0F172A;
      letter-spacing: -0.01em; margin-bottom: 8px;
    }

    .invoice-block { text-align: right; }
    .invoice-block h1 {
      font-size: 26px; font-weight: 800; letter-spacing: -0.02em;
      margin: 0 0 14px; color: #0F172A;
    }
    .invoice-meta {
      font-size: 11px; line-height: 1.7;
      display: inline-block; text-align: left;
    }
    .invoice-meta .label {
      display: inline-block; min-width: 86px;
      color: #64748B; font-size: 10px;
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .invoice-meta .value { color: #0F172A; font-weight: 600; }
    .invoice-meta .number { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

    /* Bonded badge */
    .bonded-badge {
      display: inline-block; margin-top: 8px;
      padding: 3px 10px; border-radius: 999px;
      background: #DBEAFE; color: #1E3A8A;
      font-size: 9.5px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
    }

    /* Bill to */
    .bill-to {
      margin: 18px 0 6px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    }
    .bill-to .block .heading {
      font-size: 9.5px; color: #64748B;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 4px; font-weight: 600;
    }
    .bill-to .block .body {
      font-size: 12px; color: #0F172A; line-height: 1.5;
    }
    .bill-to .block .body strong { font-weight: 700; }

    /* Line items */
    table.lines {
      width: 100%; margin: 22px 0 0;
      border-collapse: collapse;
    }
    table.lines th, table.lines td {
      padding: 9px 8px; text-align: left;
      border-bottom: 1px solid #E2E8F0;
      font-size: 10.5px;
      vertical-align: top;
    }
    table.lines th {
      font-size: 9px; letter-spacing: 0.08em;
      text-transform: uppercase; color: #475569;
      font-weight: 600; border-bottom: 1.5px solid #0F172A;
      padding-bottom: 6px;
    }
    table.lines td.num, table.lines th.num {
      text-align: right; font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    table.lines td.desc { width: 50%; }
    table.lines .item-name { font-weight: 600; color: #0F172A; }
    table.lines .item-notes {
      font-size: 10px; color: #64748B; margin-top: 2px; line-height: 1.45;
    }

    /* Totals */
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 16px; }
    table.totals {
      min-width: 280px; border-collapse: collapse;
      font-size: 11px;
    }
    table.totals td {
      padding: 4px 0; font-variant-numeric: tabular-nums;
    }
    table.totals td:first-child { color: #475569; padding-right: 24px; }
    table.totals td:last-child { text-align: right; color: #0F172A; font-weight: 500; }
    table.totals tr.grand td {
      border-top: 1.5px solid #0F172A;
      padding-top: 10px; padding-bottom: 0;
      font-size: 14px; font-weight: 800;
      letter-spacing: -0.005em;
    }

    /* Bank block */
    section.bank {
      margin-top: 28px;
      padding: 14px 16px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
    }
    section.bank h3 {
      font-size: 9.5px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #475569;
      margin: 0 0 8px; font-weight: 600;
    }
    section.bank table { width: 100%; border-collapse: collapse; font-size: 11px; }
    section.bank th {
      text-align: left; color: #64748B; font-weight: 500;
      font-size: 10.5px; padding: 3px 12px 3px 0; width: 130px; vertical-align: top;
    }
    section.bank td { padding: 3px 0; color: #0F172A; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }

    /* Notes / footer terms */
    section.notes {
      margin-top: 22px;
      font-size: 10.5px; color: #475569;
      line-height: 1.55;
    }
    section.notes .heading {
      font-size: 9.5px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #475569;
      margin-bottom: 4px; font-weight: 600;
    }
    section.notes p { margin: 0 0 6px; }

    /* Disclaimer (small) */
    .disclaimer {
      margin-top: 24px; padding: 8px 12px;
      background: #FEF3C7; border: 1px solid #FDE68A;
      border-radius: 5px;
      font-size: 9.5px; color: #92400E; line-height: 1.5;
    }

    /* Cargo footer stamp */
    .cargo-stamp {
      position: absolute; bottom: 14mm; right: 18mm;
      display: flex; align-items: center; gap: 6px;
      font-size: 8.5px; color: #94A3B8;
    }
    .cargo-stamp img { height: 11px; opacity: 0.85; }
  </style>
</head>
<body>
<div class="page">

  <header class="top">
    <div class="supplier-block">
      ${logoBlock}
      <div class="name">${supplierName}</div>
      <div>${renderAddress(input.supplier)}</div>
      ${input.supplier.vat_number
        ? `<div class="tax-id">${taxNumberLabel}: ${escapeHtml(input.supplier.vat_number)}</div>` : ''}
      ${input.supplier.company_registration_number
        ? `<div class="tax-id">Co. reg: ${escapeHtml(input.supplier.company_registration_number)}</div>` : ''}
    </div>
    <div class="invoice-block">
      <h1>INVOICE</h1>
      <div class="invoice-meta">
        <div><span class="label">Number</span><span class="value number">${escapeHtml(input.invoiceNumber)}</span></div>
        <div><span class="label">Issued</span><span class="value">${fmtDate(input.issueDate)}</span></div>
        <div><span class="label">Due</span><span class="value">${fmtDate(input.dueDate)}</span></div>
      </div>
      ${isBonded ? `<div class="bonded-badge">Bonded yacht supply · 0% VAT</div>` : ''}
    </div>
  </header>

  <section class="bill-to">
    <div class="block">
      <div class="heading">Bill to</div>
      <div class="body"><strong>${billToName}</strong></div>
      ${input.order.delivery_port ? `<div class="body" style="color:#475569;font-size:10.5px;margin-top:2px">Delivery: ${escapeHtml(input.order.delivery_port)}</div>` : ''}
    </div>
    <div class="block" style="text-align:right">
      <div class="heading">Order reference</div>
      <div class="body mono" style="font-size:11px">#${escapeHtml(String(input.order.id || '').slice(0, 8).toUpperCase())}</div>
    </div>
  </section>

  <table class="lines">
    <thead>
      <tr>
        <th class="desc">Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">VAT</th>
        <th class="num">Line total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr><td>Subtotal</td><td>${cur} ${fmtAmount(input.totals.subtotal)}</td></tr>
      ${renderVatBreakdownRows(input)}
      <tr class="grand"><td>Total</td><td>${cur} ${fmtAmount(input.totals.total)}</td></tr>
    </table>
  </div>

  ${renderBankBlock(input.supplier, input.invoiceNumber)}

  ${(input.supplier.invoice_footer_terms || input.options.notes) ? `
    <section class="notes">
      ${input.supplier.invoice_footer_terms ? `
        <div class="heading">Terms</div>
        <p>${escapeHtml(input.supplier.invoice_footer_terms)}</p>` : ''}
      ${input.options.notes ? `
        <div class="heading" style="margin-top:10px">Notes</div>
        <p>${escapeHtml(input.options.notes)}</p>` : ''}
    </section>` : ''}

  <div class="disclaimer">
    Tax rates shown are Cargo's best-effort defaults. Verify with your accountant before issuing real invoices.
  </div>

  <div class="cargo-stamp">
    <img src="${CARGO_WORDMARK_URL}" alt=""/>
    <span>Generated with Cargo · cargotechnology.co.uk</span>
  </div>

</div>
</body>
</html>`;
}

// ─── Compute totals ──────────────────────────────────────────────────────

interface ComputedLine {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  vat_category_key: string;
  vat_rate: number;     // effective rate after bonded check
  vat_label: string;
  taxable: number;
  vat_amount: number;
  line_total: number;
}

function computeLines(items: any[], optionsLines: any[], bonded: boolean): ComputedLine[] {
  const byId = new Map(optionsLines.map((l) => [l.item_id, l]));
  return items.map((it) => {
    const meta = byId.get(it.id) || {};
    const rawRate = bonded ? 0 : (Number(meta.rate) || 0);
    const rate = Math.max(0, Math.min(100, rawRate));
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unit_price) || 0;
    const taxable = qty * price;
    const vat = taxable * rate / 100;
    return {
      item_id: it.id,
      item_name: it.item_name || '',
      quantity: qty,
      unit: it.unit ?? null,
      unit_price: price,
      vat_category_key: bonded ? 'bonded' : (meta.category_key || 'standard'),
      vat_rate: rate,
      vat_label: bonded ? 'Bonded supply' : (meta.label || 'Standard'),
      taxable,
      vat_amount: vat,
      line_total: taxable + vat,
    };
  });
}

function summariseVat(lines: ComputedLine[]) {
  const buckets = new Map<string, { category_key: string; label: string; rate: number; taxable_amount: number; vat_amount: number }>();
  for (const l of lines) {
    const key = `${l.vat_category_key}:${l.vat_rate}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.taxable_amount += l.taxable;
      existing.vat_amount += l.vat_amount;
    } else {
      buckets.set(key, {
        category_key: l.vat_category_key,
        label: l.vat_label,
        rate: l.vat_rate,
        taxable_amount: l.taxable,
        vat_amount: l.vat_amount,
      });
    }
  }
  return Array.from(buckets.values());
}

// ─── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!PDFSHIFT_API_KEY) return jsonResponse({ error: 'PDFSHIFT_API_KEY not configured' }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: 'Supabase env not configured' }, 500);

  // Auth
  const auth = req.headers.get('Authorization') || '';
  const user = await userFromJwt(auth);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Parse body
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const { orderId, options = {} } = body || {};
  if (!orderId) return jsonResponse({ error: 'Missing orderId' }, 400);
  const lines = Array.isArray(options.lines) ? options.lines : [];

  try {
    // 1) Resolve caller → supplier_id (via supplier_contacts)
    const contacts = await restGet<any[]>(
      `supplier_contacts?user_id=eq.${user.id}&select=id,supplier_id,active&limit=1`
    );
    const callerContact = contacts?.[0];
    if (!callerContact || !callerContact.active) {
      return jsonResponse({ error: 'No active supplier contact for caller' }, 403);
    }
    const supplierId = callerContact.supplier_id;

    // 2) Fetch order + items
    const orders = await restGet<any[]>(
      `supplier_orders?id=eq.${orderId}&select=*,supplier_order_items(*)`
    );
    const order = orders?.[0];
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);
    if (order.supplier_profile_id !== supplierId) {
      return jsonResponse({ error: 'Order does not belong to your supplier' }, 403);
    }
    const items: any[] = order.supplier_order_items || [];
    if (items.length === 0) return jsonResponse({ error: 'Order has no line items' }, 400);

    // 3) Fetch supplier profile
    const profiles = await restGet<any[]>(`supplier_profiles?id=eq.${supplierId}&select=*`);
    const supplier = profiles?.[0];
    if (!supplier) return jsonResponse({ error: 'Supplier profile not found' }, 404);

    // 4) Compute totals (server forces bonded → 0)
    const bonded = !!options.bonded_supply;
    const computed = computeLines(items, lines, bonded);
    const subtotal = computed.reduce((s, l) => s + l.taxable, 0);
    const vatTotal = computed.reduce((s, l) => s + l.vat_amount, 0);
    const total = subtotal + vatTotal;
    const vatBreakdown = summariseVat(computed);

    // 5) Sequential invoice number
    const invoiceNumberRaw = await rpc<string>('next_invoice_number', { p_supplier_id: supplierId });
    const invoiceNumber = String(invoiceNumberRaw);

    // Dates
    const issueDate = options.issue_date || new Date().toISOString().slice(0, 10);
    const termsDays = Number(options.payment_terms_days)
      || Number(supplier.invoice_payment_terms_days) || 30;
    const dueDate = options.due_date || new Date(Date.parse(issueDate) + termsDays * 86_400_000)
      .toISOString().slice(0, 10);

    // 6) Render HTML — items array gets _effectiveRate / _lineTotal annotations
    //    so the template can read them directly.
    const annotatedItems = items.map((it) => {
      const c = computed.find((l) => l.item_id === it.id);
      return {
        ...it,
        _effectiveRate: c?.vat_rate ?? 0,
        _lineTotal: c?.line_total ?? 0,
        _vatLabel: c?.vat_label ?? '',
      };
    });
    const html = renderInvoiceHtml({
      supplier, order, items: annotatedItems, invoiceNumber,
      issueDate, dueDate,
      totals: { subtotal, total, vatTotal },
      vatBreakdown, options,
    });

    // 7) Convert via PDFShift — Basic auth: api:{API_KEY}
    const pdfRes = await fetch(PDFSHIFT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`api:${PDFSHIFT_API_KEY}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: html,
        format: 'A4',
        margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
        sandbox: false,
      }),
    });
    if (!pdfRes.ok) {
      const errText = await pdfRes.text();
      return jsonResponse({ error: `PDFShift error ${pdfRes.status}: ${errText.slice(0, 400)}` }, 502);
    }
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

    // 8) Upload PDF to supplier-invoices bucket
    //    Path: {supplier_id}/{invoice_number}.pdf — invoice_number is unique
    //    per supplier so no collisions.
    const safeInvName = invoiceNumber.replace(/[^A-Za-z0-9_\-]/g, '_');
    const pdfPath = `${supplierId}/${safeInvName}.pdf`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${pdfPath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        },
        body: pdfBytes,
      }
    );
    if (!uploadRes.ok) {
      return jsonResponse({ error: `Upload failed: ${uploadRes.status} ${await uploadRes.text()}` }, 500);
    }

    // 9) Insert supplier_invoices row
    const lineSnapshot = computed.map((l) => ({
      item_id: l.item_id,
      item_name: l.item_name,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      vat_category_key: l.vat_category_key,
      vat_rate: l.vat_rate,
      vat_amount: l.vat_amount,
      line_total: l.line_total,
    }));

    const inserted = await restPost<any[]>('supplier_invoices', {
      supplier_id: supplierId,
      order_id: orderId,
      invoice_number: invoiceNumber,
      tenant_id: order.tenant_id,
      yacht_name: order.vessel_name,
      issue_date: issueDate,
      due_date: dueDate,
      amount: Number(total.toFixed(2)),
      subtotal: Number(subtotal.toFixed(2)),
      currency: supplier.default_currency || 'EUR',
      status: 'sent',
      pdf_url: pdfPath,
      notes: options.notes ?? null,
      line_items_snapshot: lineSnapshot,
      vat_breakdown: vatBreakdown,
      bonded_supply: bonded,
      payment_method: 'pending',
    });
    const invoice = Array.isArray(inserted) ? inserted[0] : inserted;

    // 10) Snapshot per-line VAT onto supplier_order_items
    await Promise.all(computed.map((l) =>
      restPatch(`supplier_order_items?id=eq.${l.item_id}`, {
        vat_category_key: l.vat_category_key,
        vat_rate_snapshot: l.vat_rate,
      })
    ));

    // 11) Mint a 10-min signed URL for the caller to view immediately
    const signedRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${pdfPath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
      }
    );
    let signedUrl: string | null = null;
    if (signedRes.ok) {
      const sig = await signedRes.json();
      signedUrl = sig?.signedURL
        ? `${SUPABASE_URL}/storage/v1${sig.signedURL}`
        : null;
    }

    return jsonResponse({
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
      pdf_path: pdfPath,
      signed_url: signedUrl,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    }, 200);

  } catch (err: any) {
    console.error('[generateSupplierInvoice]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});

function jsonResponse(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
