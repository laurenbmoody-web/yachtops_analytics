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

// ─── HTML template (placeholder — replaced in Run F) ─────────────────────

interface InvoiceRenderInput {
  supplier: any;
  order: any;
  items: any[];
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totals: { subtotal: number; total: number; vatTotal: number };
  vatBreakdown: Array<{ category_key: string; label: string; rate: number; taxable_amount: number; vat_amount: number }>;
  options: any;
}

function renderInvoiceHtml(input: InvoiceRenderInput): string {
  const fmt = (n: number) => `${input.supplier.default_currency || 'EUR'} ${n.toFixed(2)}`;
  const rows = input.items.map((i: any) => `
    <tr>
      <td>${escapeHtml(i.item_name || '')}</td>
      <td style="text-align:right">${i.quantity ?? ''} ${escapeHtml(i.unit ?? '')}</td>
      <td style="text-align:right">${fmt(Number(i.unit_price) || 0)}</td>
      <td style="text-align:right">${(i._effectiveRate ?? 0).toFixed(1)}%</td>
      <td style="text-align:right">${fmt(i._lineTotal ?? 0)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(input.invoiceNumber)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         color: #0F172A; padding: 40px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .muted { color: #64748B; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 12.5px; text-align: left; }
  th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748B; font-weight: 600; }
  .totals { margin-left: auto; width: 280px; }
  .totals td { border: none; padding: 4px 0; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .grand td { border-top: 1.5px solid #0F172A; font-weight: 700; font-size: 14px; padding-top: 8px; }
  .footer-stamp { position: fixed; bottom: 18px; right: 22px;
                  font-size: 9px; color: #94A3B8; }
</style></head>
<body>
  <h1>INVOICE</h1>
  <div class="muted">${escapeHtml(input.invoiceNumber)} · Issued ${input.issueDate}</div>
  <p>Bill to: ${escapeHtml(input.order.vessel_name || 'Vessel')}</p>
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">VAT</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td>${fmt(input.totals.subtotal)}</td></tr>
    <tr><td>VAT</td><td>${fmt(input.totals.vatTotal)}</td></tr>
    <tr class="grand"><td>Total</td><td>${fmt(input.totals.total)}</td></tr>
  </table>
  <div class="footer-stamp">Generated with Cargo · cargotechnology.co.uk</div>
  <p class="muted" style="margin-top:40px;font-size:10.5px">
    Tax rates shown are Cargo's best-effort defaults. Verify with your accountant before issuing real invoices.
  </p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
