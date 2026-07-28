// Supabase Edge Function: generateSupplierPaymentReceipt
//
// Renders a Cargo payment RECEIPT (proof of payment) for a settled supplier
// invoice, converts it to PDF via PDFShift, uploads it to the private
// `supplier-invoices` bucket under {supplier_id}/receipts/, and returns a
// short-lived signed URL. Shows the Stripe payment ID so the supplier (and the
// paying crew) have a concrete reference for the transaction.
//
// The money itself settles directly into the supplier's connected Stripe
// account — this document is the in-app confirmation of that payment.
//
// Env: PDFSHIFT_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Request body: { invoiceId: uuid }
// Response: { signed_url, expires_at, pdf_path }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PDFSHIFT_API_KEY     = Deno.env.get('PDFSHIFT_API_KEY') || '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PDFSHIFT_ENDPOINT    = 'https://api.pdfshift.io/v3/convert/pdf';
const SIGNED_URL_TTL       = 600; // 10 minutes
const BUCKET               = 'supplier-invoices';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtMoney(amount: unknown, currency = 'EUR'): string {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

// ISO / timestamp → dd/mm/yyyy (Cargo date convention).
function fmtDate(iso: unknown): string {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return String(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

interface ReceiptInput {
  supplier: any;
  invoice: any;
  payment: any | null;   // supplier_payments row, or null for manual mark-paid
  payerName: string;
}

function buildReceiptHtml(input: ReceiptInput): string {
  const { supplier, invoice, payment, payerName } = input;
  const supplierName = escapeHtml(supplier.name || 'Supplier');
  const currency = invoice.currency || supplier.default_currency || 'EUR';
  const amount = Number(invoice.amount) || 0;
  const fee = payment?.application_fee != null ? Number(payment.application_fee) : null;
  const net = fee != null ? amount - fee : null;
  const isCard = (invoice.payment_method || payment?.status) === 'card' || invoice.payment_method === 'card';
  const methodLabel = invoice.payment_method === 'card' || payment ? 'Card — via Stripe' : (invoice.payment_method || 'Recorded');
  const pi = payment?.stripe_payment_intent_id || null;

  const logoBlock = supplier.invoice_logo_url
    ? `<img src="${escapeHtml(supplier.invoice_logo_url)}" alt="${supplierName}" class="logo"/>`
    : `<div class="logo-fallback">${supplierName}</div>`;

  // Detail rows — only render the Stripe fields we actually have.
  const rows: Array<[string, string]> = [
    ['Invoice', escapeHtml(invoice.invoice_number || '—')],
    ['Amount paid', fmtMoney(amount, currency)],
    ['Date paid', fmtDate(invoice.paid_at)],
    ['Method', escapeHtml(methodLabel)],
  ];
  if (pi) rows.push(['Stripe payment ID', `<span class="mono">${escapeHtml(pi)}</span>`]);
  if (fee != null) rows.push(['Platform fee (Cargo)', fmtMoney(fee, currency)]);
  if (net != null) rows.push(['Net to supplier', fmtMoney(net, currency)]);

  const detailRows = rows.map(([k, v]) =>
    `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${v}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, Helvetica, Arial, sans-serif;
      color: #1C1B3A; font-size: 12px; line-height: 1.5;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .masthead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 34px; }
    .logo { max-height: 66px; max-width: 240px; display: block; }
    .logo-fallback { font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; color: #1C1B3A; }
    .doc-title { text-align: right; }
    .doc-title .eyebrow {
      font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #12855A;
    }
    .doc-title h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 26px; color: #1C1B3A; }
    .doc-title .sub { font-size: 10.5px; color: #8B8478; margin-top: 2px; }

    .paid-band {
      display: flex; align-items: baseline; gap: 12px;
      border-top: 2px solid #1C1B3A; border-bottom: 1px solid #ECEAE3;
      padding: 18px 0; margin-bottom: 26px;
    }
    .paid-band .amount { font-family: 'DM Serif Display', Georgia, serif; font-size: 34px; color: #1C1B3A; }
    .paid-tag {
      font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
      color: #0F7A52; background: #E7F6EC; border-radius: 999px; padding: 4px 12px;
    }

    .parties { display: flex; gap: 40px; margin-bottom: 26px; }
    .party { flex: 1; }
    .party .label { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #8B8478; margin-bottom: 5px; }
    .party .name { font-size: 13px; font-weight: 600; color: #1C1B3A; }

    table.details { width: 100%; border-collapse: collapse; margin-bottom: 26px; }
    table.details td { padding: 9px 0; border-bottom: 1px solid #F0F1F5; vertical-align: top; }
    table.details td.k { font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #8B8478; width: 210px; }
    table.details td.v { font-size: 13px; font-weight: 600; color: #1C1B3A; text-align: right; }
    .mono { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 11px; letter-spacing: 0.2px; }

    .note {
      font-size: 10.5px; color: #6B7280; line-height: 1.6;
      background: #F8FAFC; border: 1px solid #EEF0F4; border-radius: 10px; padding: 14px 16px;
    }
    .foot { margin-top: 28px; font-size: 9px; color: #AEB4C2; text-align: center; }
  </style></head><body>
    <div class="masthead">
      <div class="brand">${logoBlock}</div>
      <div class="doc-title">
        <div class="eyebrow">Payment receipt</div>
        <h1>Paid</h1>
        <div class="sub">Issued ${fmtDate(new Date().toISOString())}</div>
      </div>
    </div>

    <div class="paid-band">
      <span class="amount">${fmtMoney(amount, currency)}</span>
      <span class="paid-tag">Paid in full</span>
    </div>

    <div class="parties">
      <div class="party">
        <div class="label">Paid to</div>
        <div class="name">${supplierName}</div>
      </div>
      <div class="party">
        <div class="label">Paid by</div>
        <div class="name">${escapeHtml(payerName || 'Vessel')}</div>
      </div>
    </div>

    <table class="details">${detailRows}</table>

    <div class="note">
      ${pi
        ? `This payment was processed by Stripe and settled directly to ${supplierName}'s connected Stripe account. The Stripe payment ID above is the authoritative reference for the transaction.`
        : `This confirms the payment recorded against invoice ${escapeHtml(invoice.invoice_number || '')} in Cargo.`}
    </div>

    <div class="foot">Generated by Cargo · This receipt confirms a payment recorded in the Cargo provisioning platform.</div>
  </body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!PDFSHIFT_API_KEY) return jsonResponse({ error: 'PDFSHIFT_API_KEY not configured' }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: 'Supabase env not configured' }, 500);

  const user = await userFromJwt(req.headers.get('Authorization') || '');
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const invoiceId = body?.invoiceId || body?.supplier_invoice_id;
  if (!invoiceId) return jsonResponse({ error: 'Missing invoiceId' }, 400);

  try {
    const invoices = await restGet<any[]>(
      `supplier_invoices?id=eq.${invoiceId}&select=id,invoice_number,supplier_id,tenant_id,order_id,amount,currency,status,paid_at,payment_method,yacht_name`
    );
    const invoice = invoices?.[0];
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    if (invoice.status !== 'paid') return jsonResponse({ error: 'This invoice has not been paid yet.' }, 409);

    // Authorise: the invoice's supplier (via supplier_contacts) OR a member of
    // the buying tenant (the payer). Either party may pull the receipt.
    const [contacts, members] = await Promise.all([
      restGet<any[]>(`supplier_contacts?user_id=eq.${user.id}&supplier_id=eq.${invoice.supplier_id}&active=eq.true&select=id&limit=1`),
      restGet<any[]>(`tenant_members?user_id=eq.${user.id}&tenant_id=eq.${invoice.tenant_id}&active=eq.true&select=user_id&limit=1`),
    ]);
    if (!(contacts?.length) && !(members?.length)) {
      return jsonResponse({ error: 'You do not have access to this receipt.' }, 403);
    }

    const suppliers = await restGet<any[]>(
      `supplier_profiles?id=eq.${invoice.supplier_id}&select=name,invoice_logo_url,default_currency`
    );
    const supplier = suppliers?.[0] || { name: 'Supplier' };

    // Stripe reference — most-recent successful/paid payment row for the invoice.
    const payments = await restGet<any[]>(
      `supplier_payments?supplier_invoice_id=eq.${invoiceId}&select=stripe_payment_intent_id,application_fee,amount,currency,status,created_at&order=created_at.desc&limit=1`
    );
    const payment = payments?.[0] || null;

    const payerName = invoice.yacht_name || 'Vessel';
    const html = buildReceiptHtml({ supplier, invoice, payment, payerName });

    const pdfRes = await fetch(PDFSHIFT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`api:${PDFSHIFT_API_KEY}`), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: html,
        format: 'A4',
        margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' },
        sandbox: false,
      }),
    });
    if (!pdfRes.ok) {
      const t = await pdfRes.text();
      return jsonResponse({ error: `PDFShift error ${pdfRes.status}: ${t.slice(0, 300)}` }, 502);
    }
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

    const safeInvName = String(invoice.invoice_number || invoiceId).replace(/[^A-Za-z0-9_\-]/g, '_');
    const pdfPath = `${invoice.supplier_id}/receipts/${safeInvName}-receipt.pdf`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${pdfPath}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: pdfBytes,
    });
    if (!uploadRes.ok) {
      return jsonResponse({ error: `Storage upload failed: ${uploadRes.status} ${await uploadRes.text()}` }, 502);
    }

    const signedRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${pdfPath}`, {
      method: 'POST',
      headers: restHeaders,
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
    });
    let signedUrl: string | null = null;
    if (signedRes.ok) {
      const sig = await signedRes.json();
      signedUrl = sig?.signedURL ? `${SUPABASE_URL}/storage/v1${sig.signedURL}` : null;
    }

    return jsonResponse({
      signed_url: signedUrl,
      pdf_path: pdfPath,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString(),
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error)?.message || 'Receipt generation failed' }, 500);
  }
});
