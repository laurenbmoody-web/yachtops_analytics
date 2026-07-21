// Supabase Edge Function: generateSupplierInvoice
// (redeploy: bill-to vessel fetch fix — see 20260718 invoice work)
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
//       reverse_charge?: boolean (force all rates to 0, print reverse-charge note),
//       discount_pct?: number (0–100, invoice-level % off net before VAT),
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
  vessel: any;   // buyer bill-to details (vessels row via order.tenant_id), may be null
  items: any[];   // each annotated with _effectiveRate, _lineTotal, _vatLabel
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totals: { subtotal: number; total: number; vatTotal: number; discountAmount?: number };
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
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
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
  // Always show the rate alongside each VAT line so the customer can see
  // the maths at a glance, even on single-rate invoices.
  const taxName = input.options.tax_name || 'VAT';
  const cur = input.supplier.default_currency || 'EUR';
  if (input.vatBreakdown.length === 0) {
    return `<tr><td>${escapeHtml(taxName)} (0%)</td><td>${cur} 0.00</td></tr>`;
  }
  // Show the taxable base each rate applies to, alongside the tax — the
  // "taxable amount + tax per rate" a VAT invoice is expected to itemise.
  return input.vatBreakdown.map((b) => {
    const label = input.vatBreakdown.length > 1 ? `${escapeHtml(b.label)}, ${b.rate.toFixed(1)}%` : `${b.rate.toFixed(1)}%`;
    return `<tr><td>${escapeHtml(taxName)} (${label}) on ${cur} ${fmtAmount(b.taxable_amount)}</td>
        <td>${cur} ${fmtAmount(b.vat_amount)}</td></tr>`;
  }).join('');
}

// Unit column — respects catalogue case/pack structure when present, e.g.
// pack_size 24 + unit_size "330ml" + pack_unit "bottle" → "24 × 330ml bottle".
// Falls back to the order line's free-text unit for non-catalogue lines.
function renderUnitCell(it: any, cat: any): string {
  if (cat && (cat.unit_size || cat.pack_unit)) {
    const base = [cat.unit_size, cat.pack_unit].filter(Boolean).map(escapeHtml).join(' ');
    const size = Number(cat.pack_size);
    if (size > 1) return `${size} × ${base}`;
    if (base) return base;
  }
  return it.unit ? escapeHtml(it.unit) : '—';
}

function renderInvoiceHtml(input: InvoiceRenderInput): string {
  const cur = input.supplier.default_currency || 'EUR';
  const supplierName = escapeHtml(input.supplier.name || 'Supplier');
  // Country-specific tax label (TVA / IVA / GST etc.) — the modal looks it up
  // from the country preset and passes it in via options.tax_name. Falls back
  // to "VAT" for countries without a registry entry.
  const taxNumberLabel = input.options.tax_name || 'VAT';
  const v = input.vessel || {};
  const billToName = escapeHtml(v.billing_legal_name || input.order.vessel_name || 'Vessel');
  const billToAddress = v.billing_address ? escapeHtml(v.billing_address).replace(/\n/g, '<br/>') : '';
  const billToVat = v.billing_vat_number ? escapeHtml(v.billing_vat_number) : '';
  const deliveryLine = [
    input.order.delivery_port ? escapeHtml(input.order.delivery_port) : '',
    fmtDate(input.order.delivery_date),
  ].filter(Boolean).join(' · ');
  const isBonded = !!input.options.bonded_supply;
  const isReverseCharge = !isBonded && !!input.options.reverse_charge;

  const itemRows = input.items.map((it: any) => {
    const cat = it.catalogue_item || null;
    // Qty is just the count; the pack/case structure lives in its own Unit
    // column so the two aren't mashed together.
    const qty = `${it.quantity ?? ''}`.trim() || '—';
    const unitCell = renderUnitCell(it, cat);
    const sku = cat?.sku ? escapeHtml(cat.sku) : '';
    const category = cat?.category ? escapeHtml(cat.category) : '';
    const unitPrice = `${cur} ${fmtAmount(Number(it.agreed_price ?? it.unit_price) || 0)}`;
    const rate = `${(it._effectiveRate ?? 0).toFixed(1)}%`;
    // Net (ex-VAT) so line amounts sum to the Subtotal; VAT is added below.
    const netAmount = `${cur} ${fmtAmount(it._net ?? 0)}`;
    return `
      <tr>
        <td class="desc">
          <div class="item-name">${escapeHtml(it.item_name || '')}</div>
          ${category ? `<div class="item-cat">${category}</div>` : ''}
          ${it.notes ? `<div class="item-notes">${escapeHtml(it.notes)}</div>` : ''}
        </td>
        <td class="sku mono">${sku || '—'}</td>
        <td class="num">${qty}</td>
        <td class="unit">${unitCell}</td>
        <td class="num">${unitPrice}</td>
        <td class="num">${rate}</td>
        <td class="num">${netAmount}</td>
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
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap');
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #1C1B3A;
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
      gap: 24px; padding-bottom: 16px;
      border-bottom: 1px solid #1C1B3A;
    }
    .supplier-block { font-size: 11px; line-height: 1.55; color: #6B7280; }
    .supplier-block .name {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 19px; font-weight: 400; color: #1C1B3A;
      margin-bottom: 6px; letter-spacing: 0;
    }
    .supplier-block .tax-id {
      margin-top: 6px; font-size: 10.5px; color: #8B8478;
    }
    .supplier-block .supplier-contact {
      margin-top: 5px; font-size: 10.5px; color: #6B7280;
    }
    .brand { align-self: center; }
    .brand .logo { margin-bottom: 0; }
    .brand .logo-fallback { margin-bottom: 0; }
    .logo { max-height: 76px; max-width: 260px; display: block; margin-bottom: 8px; }
    .logo-fallback {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 24px; font-weight: 400; color: #1C1B3A;
      letter-spacing: 0; margin-bottom: 8px;
    }

    .invoice-block { text-align: right; }
    .invoice-block h1 {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 30px; font-weight: 400; letter-spacing: 0.02em;
      margin: 0 0 14px; color: #C65A1A;
    }
    .invoice-meta {
      display: grid; grid-template-columns: auto auto;
      column-gap: 20px; row-gap: 3px;
      justify-content: end; align-items: baseline;
      font-size: 11px;
    }
    .invoice-meta .label {
      text-align: left;
      color: #8B8478; font-size: 9px; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
    }
    .invoice-meta .value { color: #1C1B3A; font-weight: 600; text-align: right; }
    .invoice-meta .number { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

    /* Bonded badge */
    .bonded-badge {
      display: inline-block; margin-top: 8px;
      padding: 3px 11px; border-radius: 999px;
      background: #FBEFE9; color: #C65A1A;
      font-size: 9.5px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
    }

    /* Bill to */
    .bill-to {
      margin: 18px 0 6px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    }
    .bill-to .block .heading {
      font-size: 9px; color: #8B8478;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 4px; font-weight: 700;
    }
    .bill-to .block .body {
      font-size: 12px; color: #1C1B3A; line-height: 1.5;
    }
    .bill-to .block .body strong { font-weight: 700; }
    .bill-to .block .bill-addr { font-size: 10.5px; color: #6B7280; line-height: 1.5; margin-top: 3px; }
    .bill-to .block .bill-meta { font-size: 10px; color: #8B8478; margin-top: 3px; }

    /* Line items */
    table.lines {
      width: 100%; margin: 22px 0 0;
      border-collapse: collapse;
    }
    table.lines th, table.lines td {
      padding: 9px 8px; text-align: left;
      border-bottom: 1px solid #ECEAE3;
      font-size: 10.5px;
      vertical-align: top;
    }
    /* Flush the outer columns to the page margins so the first column lines up
       with Bill-To / Terms on the left and the last with the totals on the right. */
    table.lines th:first-child, table.lines td:first-child { padding-left: 0; }
    table.lines th:last-child, table.lines td:last-child { padding-right: 0; }
    table.lines th {
      font-size: 9px; letter-spacing: 0.08em;
      text-transform: uppercase; color: #6B7280;
      font-weight: 600; border-bottom: 1.5px solid #1C1B3A;
      padding-bottom: 6px;
    }
    table.lines td.num, table.lines th.num {
      text-align: right; font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    table.lines td.desc, table.lines th.desc { width: 34%; }
    table.lines td.sku, table.lines th.sku { width: 12%; font-size: 10px; color: #6B7280; white-space: nowrap; }
    table.lines td.unit, table.lines th.unit { width: 16%; font-size: 10px; color: #4A4A63; }
    table.lines .item-name { font-weight: 600; color: #1C1B3A; }
    table.lines .item-cat {
      font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase;
      color: #C65A1A; margin-top: 2px; font-weight: 700;
    }
    table.lines .item-notes {
      font-size: 10px; color: #8B8478; margin-top: 2px; line-height: 1.45;
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
    table.totals td:first-child { color: #6B7280; padding-right: 24px; }
    table.totals td:last-child { text-align: right; color: #1C1B3A; font-weight: 500; }
    table.totals tr.grand td {
      border-top: 1.5px solid #C65A1A;
      padding-top: 10px; padding-bottom: 0;
      font-size: 15px; font-weight: 700; color: #1C1B3A;
      letter-spacing: 0;
    }
    table.totals tr.grand td:first-child {
      font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #8B8478;
    }
    table.totals tr.disc td:last-child { color: #C65A1A; }
    table.totals tr.due td {
      padding-top: 8px; font-size: 12px; font-weight: 700; color: #C65A1A;
    }
    table.totals tr.due td:first-child {
      font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #C65A1A;
    }

    /* Reverse-charge / bonded statutory statement */
    .tax-statement {
      margin-top: 18px; padding: 10px 13px;
      background: #FBEFE9; border: 1px solid #F3D9CB;
      border-radius: 8px;
      font-size: 10px; color: #8A4A22; line-height: 1.5;
    }
    .tax-statement strong { color: #7A3E1C; font-weight: 600; }

    /* Bank block — borderless editorial section (content flush to the left
       margin, aligned with Bill-To / line items / terms). */
    section.bank {
      margin-top: 26px;
      padding: 16px 0 0;
      border-top: 1px solid #ECEAE3;
    }
    section.bank h3 {
      font-size: 9.5px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #6B7280;
      margin: 0 0 8px; font-weight: 600;
    }
    section.bank table { width: 100%; border-collapse: collapse; font-size: 11px; }
    section.bank th {
      text-align: left; color: #8B8478; font-weight: 500;
      font-size: 10.5px; padding: 3px 12px 3px 0; width: 130px; vertical-align: top;
    }
    section.bank td { padding: 3px 0; color: #1C1B3A; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }

    /* Notes / footer terms */
    section.notes {
      margin-top: 22px;
      font-size: 10.5px; color: #6B7280;
      line-height: 1.55;
    }
    section.notes .heading {
      font-size: 9.5px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #6B7280;
      margin-bottom: 4px; font-weight: 600;
    }
    section.notes p { margin: 0 0 6px; }

    /* Disclaimer (small) */
    .disclaimer {
      margin-top: 24px; padding: 9px 13px;
      background: #FAFAF8; border: 1px solid #ECEAE3;
      border-left: 2px solid #C65A1A; border-radius: 8px;
      font-size: 9.5px; color: #8B8478; line-height: 1.5;
    }

    /* Cargo footer stamp */
    .cargo-stamp {
      position: absolute; bottom: 14mm; right: 18mm;
      display: flex; align-items: center; gap: 6px;
      font-size: 8.5px; color: #AEB4C2;
    }
    .cargo-stamp img { height: 11px; opacity: 0.85; }
  </style>
</head>
<body>
<div class="page">

  <header class="top">
    <div class="brand">
      ${logoBlock}
    </div>
    <div class="invoice-block">
      <h1>INVOICE</h1>
      <div class="invoice-meta">
        <span class="label">Number</span><span class="value number">${escapeHtml(input.invoiceNumber)}</span>
        <span class="label">Issued</span><span class="value">${fmtDate(input.issueDate)}</span>
        <span class="label">Due</span><span class="value">${fmtDate(input.dueDate)}</span>
      </div>
      ${isBonded ? `<div class="bonded-badge">Bonded yacht supply · 0% VAT</div>` : ''}
    </div>
  </header>

  <section class="bill-to">
    <div class="block">
      <div class="heading">Bill to</div>
      <div class="body"><strong>${billToName}</strong></div>
      ${billToAddress ? `<div class="bill-addr">${billToAddress}</div>` : ''}
      ${billToVat ? `<div class="bill-meta">${taxNumberLabel} no: ${billToVat}</div>` : ''}
    </div>
    <div class="block from-block" style="text-align:right">
      <div class="heading">From</div>
      <div class="body"><strong>${supplierName}</strong></div>
      <div class="bill-addr">${renderAddress(input.supplier)}</div>
      ${[input.supplier.contact_email, input.supplier.contact_phone].filter(Boolean).length
        ? `<div class="bill-addr">${[input.supplier.contact_email, input.supplier.contact_phone].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      ${input.supplier.vat_number
        ? `<div class="bill-meta">${taxNumberLabel}: ${escapeHtml(input.supplier.vat_number)}</div>` : ''}
      ${input.supplier.company_registration_number
        ? `<div class="bill-meta">Co. reg: ${escapeHtml(input.supplier.company_registration_number)}</div>` : ''}
      <div class="bill-meta" style="margin-top:8px">Order ref <span class="mono">#${escapeHtml(String(input.order.id || '').slice(0, 8).toUpperCase())}</span></div>
      ${deliveryLine ? `<div class="bill-meta">Delivery: ${deliveryLine}</div>` : ''}
    </div>
  </section>

  <table class="lines">
    <thead>
      <tr>
        <th class="desc">Description</th>
        <th class="sku">SKU</th>
        <th class="num">Qty</th>
        <th class="unit">Unit</th>
        <th class="num">Unit price</th>
        <th class="num">VAT</th>
        <th class="num">Net amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr><td>Subtotal</td><td>${cur} ${fmtAmount(input.totals.subtotal)}</td></tr>
      ${input.totals.discountAmount ? `<tr class="disc"><td>Discount${input.options.discount_pct ? ` (${Number(input.options.discount_pct).toFixed(input.options.discount_pct % 1 ? 1 : 0)}%)` : ''}</td><td>− ${cur} ${fmtAmount(input.totals.discountAmount)}</td></tr>` : ''}
      ${renderVatBreakdownRows(input)}
      <tr class="grand"><td>Total</td><td>${cur} ${fmtAmount(input.totals.total)}</td></tr>
      <tr class="due"><td>Amount due</td><td>${cur} ${fmtAmount(input.totals.total)}</td></tr>
    </table>
  </div>

  ${isReverseCharge ? `
    <div class="tax-statement">
      <strong>Reverse charge:</strong> ${escapeHtml(taxNumberLabel)} to be accounted for by the
      customer under the reverse-charge procedure. No ${escapeHtml(taxNumberLabel)} charged by the supplier.
    </div>` : ''}
  ${isBonded ? `
    <div class="tax-statement">
      <strong>Bonded yacht supply:</strong> zero-rated stores supplied to a commercial
      vessel. No ${escapeHtml(taxNumberLabel)} charged.
    </div>` : ''}

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
  unit_currency: string | null;
  vat_category_key: string;
  vat_rate: number;     // effective rate after bonded / reverse-charge check
  vat_label: string;
  taxable: number;        // net, before any invoice-level discount
  discounted_net: number; // net the VAT is actually charged on (post-discount)
  vat_amount: number;
  line_total: number;
}

// bonded OR reverse_charge force every line to 0% (VAT accounted for elsewhere).
// discountPct is an invoice-level % off the net; VAT is charged on the
// discounted base, but each line still shows its undiscounted net.
function computeLines(items: any[], optionsLines: any[], bonded: boolean, reverseCharge = false, discountPct = 0): ComputedLine[] {
  const byId = new Map(optionsLines.map((l) => [l.item_id, l]));
  const zeroRated = bonded || reverseCharge;
  const discFactor = 1 - Math.max(0, Math.min(100, Number(discountPct) || 0)) / 100;
  return items.map((it) => {
    const meta = byId.get(it.id) || {};
    const rawRate = zeroRated ? 0 : (Number(meta.rate) || 0);
    const rate = Math.max(0, Math.min(100, rawRate));
    const qty = Number(it.quantity) || 0;
    // Sprint 9.5: read agreed_price (the negotiated value). Fall back to
    // unit_price for legacy rows backfilled from before the split.
    const price = Number(it.agreed_price ?? it.unit_price) || 0;
    const currency = it.agreed_currency ?? it.estimated_currency ?? null;
    const taxable = qty * price;
    const discountedNet = taxable * discFactor;
    const vat = discountedNet * rate / 100;
    const label = bonded ? 'Bonded supply' : reverseCharge ? 'Reverse charge' : (meta.label || 'Standard');
    const catKey = bonded ? 'bonded' : reverseCharge ? 'reverse_charge' : (meta.category_key || 'standard');
    return {
      item_id: it.id,
      item_name: it.item_name || '',
      quantity: qty,
      unit: it.unit ?? null,
      unit_price: price,
      unit_currency: currency,
      vat_category_key: catKey,
      vat_rate: rate,
      vat_label: label,
      taxable,
      discounted_net: discountedNet,
      vat_amount: vat,
      line_total: discountedNet + vat,
    };
  });
}

function summariseVat(lines: ComputedLine[]) {
  const buckets = new Map<string, { category_key: string; label: string; rate: number; taxable_amount: number; vat_amount: number }>();
  for (const l of lines) {
    const key = `${l.vat_category_key}:${l.vat_rate}`;
    const existing = buckets.get(key);
    // Base each rate on the discounted net — that's the amount the tax is
    // actually charged on and what the per-rate row should reconcile against.
    if (existing) {
      existing.taxable_amount += l.discounted_net;
      existing.vat_amount += l.vat_amount;
    } else {
      buckets.set(key, {
        category_key: l.vat_category_key,
        label: l.vat_label,
        rate: l.vat_rate,
        taxable_amount: l.discounted_net,
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
      `supplier_orders?id=eq.${orderId}&select=*,supplier_order_items(*,catalogue_item:catalogue_item_id(sku,category,pack_size,pack_unit,unit_size))`
    );
    const order = orders?.[0];
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);
    if (order.supplier_profile_id !== supplierId) {
      return jsonResponse({ error: 'Order does not belong to your supplier' }, 403);
    }
    const items: any[] = order.supplier_order_items || [];
    if (items.length === 0) return jsonResponse({ error: 'Order has no line items' }, 400);

    // Sprint 9.5 precondition: every line must be agreed or unavailable
    // before we'll generate an invoice. The Generate Invoice modal surfaces
    // the same check client-side, but this is the canonical guard.
    const blockingLines = items.filter((it: any) => {
      const qs = it.quote_status;
      return qs && qs !== 'agreed' && qs !== 'unavailable';
    });
    if (blockingLines.length > 0) {
      return jsonResponse({
        error: `Cannot generate invoice — ${blockingLines.length} line${blockingLines.length === 1 ? '' : 's'} still awaiting agreement`,
        blocking_count: blockingLines.length,
        blocking_items: blockingLines.map((it: any) => ({
          id: it.id,
          item_name: it.item_name,
          quote_status: it.quote_status,
        })),
      }, 400);
    }

    // 3) Fetch supplier profile
    const profiles = await restGet<any[]>(`supplier_profiles?id=eq.${supplierId}&select=*`);
    const supplier = profiles?.[0];
    if (!supplier) return jsonResponse({ error: 'Supplier profile not found' }, 404);

    // Buyer bill-to details (vessels row via the order's tenant_id). Best-effort
    // — a vessel with no billing profile just falls back to the vessel name.
    let vessel: any = null;
    if (order.tenant_id) {
      const vessels = await restGet<any[]>(
        `vessels?tenant_id=eq.${order.tenant_id}&select=billing_legal_name,billing_address,billing_vat_number,billing_reg_number,billing_email`
      ).catch(() => []);
      vessel = vessels?.[0] || null;
    }

    // 4) Compute totals. Server forces bonded / reverse-charge → 0% and
    //    applies any invoice-level discount to the net before VAT.
    const bonded = !!options.bonded_supply;
    const reverseCharge = !!options.reverse_charge;
    const discountPct = Math.max(0, Math.min(100, Number(options.discount_pct) || 0));
    const computed = computeLines(items, lines, bonded, reverseCharge, discountPct);
    const subtotal = computed.reduce((s, l) => s + l.taxable, 0);          // gross net, pre-discount
    const discountedNet = computed.reduce((s, l) => s + l.discounted_net, 0);
    const discountAmount = subtotal - discountedNet;
    const vatTotal = computed.reduce((s, l) => s + l.vat_amount, 0);
    const total = discountedNet + vatTotal;
    const vatBreakdown = summariseVat(computed);

    // 5) One invoice per order. If this order already has one, regenerating
    //    REPLACES it in place — same invoice number, row updated, PDF
    //    overwritten — so the outstanding total isn't double-counted. Only a
    //    brand-new order mints the next sequential number.
    const priorInvoices = await restGet<any[]>(
      `supplier_invoices?order_id=eq.${orderId}&supplier_id=eq.${supplierId}&select=id,invoice_number,status&order=created_at.asc&limit=1`
    );
    const priorInvoice = priorInvoices?.[0] || null;
    if (priorInvoice && priorInvoice.status === 'paid') {
      return jsonResponse({ error: 'This invoice has already been paid and can’t be regenerated.' }, 409);
    }
    const invoiceNumber = priorInvoice
      ? String(priorInvoice.invoice_number)
      : String(await rpc<string>('next_invoice_number', { p_supplier_id: supplierId }));

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
        _net: c?.taxable ?? 0,
        _vatAmount: c?.vat_amount ?? 0,
        _lineTotal: c?.line_total ?? 0,
        _vatLabel: c?.vat_label ?? '',
      };
    });
    const html = renderInvoiceHtml({
      supplier, order, vessel, items: annotatedItems, invoiceNumber,
      issueDate, dueDate,
      totals: { subtotal, total, vatTotal, discountAmount },
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
        margin: { top: '15mm', right: '15mm', bottom: '18mm', left: '15mm' },
        // Page numbering for multi-page invoices. PDFShift substitutes
        // {{page}}/{{total}} and renders this HTML in the bottom margin.
        footer: {
          source: '<div style="width:100%;font-family:Inter,system-ui,sans-serif;font-size:8px;color:#AEB4C2;text-align:center;">Page {{page}} of {{total}}</div>',
          height: '12mm',
        },
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

    const invoiceFields = {
      issue_date: issueDate,
      due_date: dueDate,
      amount: Number(total.toFixed(2)),
      subtotal: Number(subtotal.toFixed(2)),
      currency: supplier.default_currency || 'EUR',
      pdf_url: pdfPath,
      notes: options.notes ?? null,
      line_items_snapshot: lineSnapshot,
      vat_breakdown: vatBreakdown,
      bonded_supply: bonded,
    };
    // Regenerate → update the existing row (keeps its number, status and
    // payment state); first time → insert a fresh 'sent' row.
    const written = priorInvoice
      ? await restPatch<any[]>(`supplier_invoices?id=eq.${priorInvoice.id}`, invoiceFields)
      : await restPost<any[]>('supplier_invoices', {
          supplier_id: supplierId,
          order_id: orderId,
          invoice_number: invoiceNumber,
          tenant_id: order.tenant_id,
          yacht_name: order.vessel_name,
          status: 'sent',
          payment_method: 'pending',
          ...invoiceFields,
        });
    const invoice = Array.isArray(written) ? written[0] : written;

    // 10) Snapshot per-line VAT + invoiced price onto supplier_order_items.
    // invoiced_price catches any divergence between agreed_price and what
    // actually got billed — Sprint 10's reconciliation view will flag
    // mismatches.
    await Promise.all(computed.map((l) =>
      restPatch(`supplier_order_items?id=eq.${l.item_id}`, {
        vat_category_key: l.vat_category_key,
        vat_rate_snapshot: l.vat_rate,
        invoiced_price: l.unit_price,
        invoiced_currency: l.unit_currency ?? supplier.default_currency ?? null,
      })
    ));

    // 10b) First-issuance side-effects (skipped on regenerate). Advancing from
    //      'received' → 'invoiced' moves both progress bars (supplier timeline +
    //      crew lifecycle); the bell fan-out tells the crew the invoice is in.
    //      Regenerating an already-invoiced/paid order must not repeat either.
    if (order.status === 'received') {
      await restPatch(`supplier_orders?id=eq.${orderId}`, {
        status: 'invoiced',
        invoiced_at: new Date().toISOString(),
      });

      // Notify every crew member on the tenant (best-effort — a notify hiccup
      // must never fail invoice generation itself).
      try {
        const curCode = supplier.default_currency || 'EUR';
        const dueDmy = fmtDate(dueDate);
        const members = await restGet<any[]>(
          `tenant_members?tenant_id=eq.${order.tenant_id}&status=neq.invited&select=user_id`
        );
        const notifRows = (members || [])
          .filter((m) => m.user_id)
          .map((m) => ({
            user_id: m.user_id,
            type: 'supplier_invoice',
            title: `${supplier.name || 'Supplier'} sent an invoice`,
            message: `${invoiceNumber} · ${curCode} ${total.toFixed(2)} · due ${dueDmy}`,
            severity: 'info',
            action_url: '/accounts/payables',
            read: false,
          }));
        if (notifRows.length) await restPost('notifications', notifRows);
      } catch (notifyErr) {
        console.error('[generateSupplierInvoice] crew notify failed', notifyErr);
      }
    }

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
