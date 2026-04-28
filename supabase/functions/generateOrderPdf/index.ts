// Supabase Edge Function: generateOrderPdf
//
// Renders a Cargo-branded order acknowledgement PDF, converts via PDFShift,
// uploads to the private supplier-documents bucket, and updates the parent
// supplier_orders row with the storage path + generation timestamp.
//
// Unlike the invoice fn, there is no precondition on quote_status — the
// order PDF is a fulfilment-side artefact (what was ordered, who's receiving
// it, where, when) rather than a billing artefact. It can be regenerated at
// any time; the URL column is overwritten in place.
//
// Branding: Cargo logo + footer stamp. The supplier's own logo is NOT used
// here — that's reserved for the supplier-branded invoice. This document
// represents the platform's view of the order.
//
// Env vars required:
//   PDFSHIFT_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request body: { orderId: uuid }
// Response: { pdf_path, signed_url, expires_at, generated_at }

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
const SIGNED_URL_TTL_SECONDS  = 600;
const BUCKET                  = 'supplier-documents';

const CARGO_WORDMARK_URL =
  'https://cargotechnology.netlify.app/assets/images/cargo_merged_originalmark_syne800_true.png';

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

async function restPatch<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...restHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function restPostNoReturn(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...restHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST POST ${path} failed: ${res.status} ${await res.text()}`);
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

function jsonResponse(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  // supplier_orders.delivery_time stored as 'HH:mm' or 'HH:mm:ss'
  return String(t).slice(0, 5);
}

function shortRef(id: string): string {
  return String(id || '').slice(0, 8).toUpperCase();
}

// Quote status → human label + colour. Used in the right-hand status column.
function quoteStatusBadge(qs: string | null | undefined, fulfilment: string | null | undefined): { label: string; bg: string; fg: string } {
  if (qs === 'unavailable' || fulfilment === 'unavailable') return { label: 'Unavailable', bg: '#FEE2E2', fg: '#991B1B' };
  if (qs === 'declined') return { label: 'Quote declined', bg: '#FEE2E2', fg: '#991B1B' };
  if (qs === 'in_discussion') return { label: 'In discussion', bg: '#FEF3C7', fg: '#92400E' };
  if (qs === 'agreed') return { label: 'Agreed', bg: '#DCFCE7', fg: '#166534' };
  if (qs === 'quoted') return { label: 'Quoted', bg: '#DBEAFE', fg: '#1E3A8A' };
  if (qs === 'awaiting_quote') return { label: 'Awaiting quote', bg: '#F1F5F9', fg: '#475569' };
  if (fulfilment === 'substituted') return { label: 'Substituted', bg: '#FEF3C7', fg: '#92400E' };
  if (fulfilment === 'confirmed') return { label: 'Confirmed', bg: '#DCFCE7', fg: '#166534' };
  return { label: 'Pending', bg: '#F1F5F9', fg: '#475569' };
}

// ─── Render template ─────────────────────────────────────────────────────

interface OrderRenderInput {
  supplier: any;
  order: any;
  items: any[];
  generatedAt: Date;
}

function renderOrderHtml(input: OrderRenderInput): string {
  const { supplier, order, items, generatedAt } = input;
  const orderRef = shortRef(order.id);
  const supplierName = escapeHtml(supplier?.name || 'Supplier');
  const vesselName = escapeHtml(order.vessel_name || order.yacht_name || 'Vessel');

  const itemRows = items.map((it: any) => {
    const qty = `${it.quantity ?? ''}${it.unit ? ' ' + escapeHtml(it.unit) : ''}`.trim();

    // Show the most-trusted price we have, in this order:
    // agreed → quoted → estimated → legacy unit_price.
    const priceVal = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price ?? it.unit_price) || 0;
    const priceCur = it.agreed_currency ?? it.quoted_currency ?? it.estimated_currency ?? supplier?.default_currency ?? '';
    const priceText = priceVal > 0 ? `${escapeHtml(priceCur)} ${fmtAmount(priceVal)}` : '<span style="color:#94A3B8">—</span>';

    const lineTotal = priceVal * (Number(it.quantity) || 0);
    const lineTotalText = priceVal > 0
      ? `${escapeHtml(priceCur)} ${fmtAmount(lineTotal)}`
      : '<span style="color:#94A3B8">—</span>';

    const badge = quoteStatusBadge(it.quote_status, it.status);

    return `
      <tr>
        <td class="desc">
          <div class="item-name">${escapeHtml(it.item_name || '')}</div>
          ${it.notes ? `<div class="item-notes">${escapeHtml(it.notes)}</div>` : ''}
          ${it.substitute_description
            ? `<div class="item-notes"><strong>Substitute:</strong> ${escapeHtml(it.substitute_description)}</div>` : ''}
        </td>
        <td class="num">${qty}</td>
        <td class="num">${priceText}</td>
        <td class="status">
          <span class="badge" style="background:${badge.bg};color:${badge.fg}">${escapeHtml(badge.label)}</span>
        </td>
        <td class="num">${lineTotalText}</td>
      </tr>`;
  }).join('');

  const deliveryBlocks: string[] = [];
  if (order.delivery_date) deliveryBlocks.push(`<div><span class="lbl">Date</span><span class="val">${fmtDate(order.delivery_date)}</span></div>`);
  if (order.delivery_time) deliveryBlocks.push(`<div><span class="lbl">Time</span><span class="val">${escapeHtml(fmtTime(order.delivery_time))}</span></div>`);
  if (order.delivery_port) deliveryBlocks.push(`<div><span class="lbl">Port</span><span class="val">${escapeHtml(order.delivery_port)}</span></div>`);
  if (order.delivery_contact) deliveryBlocks.push(`<div><span class="lbl">Contact</span><span class="val">${escapeHtml(order.delivery_contact)}</span></div>`);

  // Subtotal (best-effort) — only counts lines that have a usable price.
  const subtotal = items.reduce((s: number, it: any) => {
    const p = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price ?? it.unit_price) || 0;
    return s + p * (Number(it.quantity) || 0);
  }, 0);
  const totalCurrency = supplier?.default_currency || 'EUR';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Order ${escapeHtml(orderRef)}</title>
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

    header.top {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 24px; padding-bottom: 14px;
      border-bottom: 1.5px solid #0F172A;
    }
    .cargo-block .wordmark { height: 28px; display: block; margin-bottom: 12px; }
    .cargo-block .doctype {
      font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase;
      color: #64748B; font-weight: 700;
    }
    .cargo-block .ref {
      margin-top: 3px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 22px; font-weight: 800; color: #0F172A;
      letter-spacing: -0.01em;
    }

    .meta-block { text-align: right; }
    .meta-block h1 {
      font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
      margin: 0 0 14px; color: #0F172A;
    }
    .meta {
      font-size: 11px; line-height: 1.7;
      display: inline-block; text-align: left;
    }
    .meta .label {
      display: inline-block; min-width: 86px;
      color: #64748B; font-size: 10px;
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .meta .value { color: #0F172A; font-weight: 600; }

    /* Parties */
    .parties {
      margin: 18px 0 6px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    }
    .parties .block .heading {
      font-size: 9.5px; color: #64748B;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 4px; font-weight: 600;
    }
    .parties .block .body {
      font-size: 12px; color: #0F172A; line-height: 1.5;
    }
    .parties .block .body strong { font-weight: 700; }
    .parties .block .body .sub { font-size: 10.5px; color: #475569; margin-top: 2px; }

    /* Delivery block */
    section.delivery {
      margin-top: 18px;
      padding: 12px 16px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
    }
    section.delivery .lbl {
      display: block;
      font-size: 9.5px; color: #64748B;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 2px; font-weight: 600;
    }
    section.delivery .val {
      display: block;
      font-size: 12px; color: #0F172A; font-weight: 600;
    }

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
    table.lines td.status, table.lines th.status { text-align: center; }
    table.lines td.desc { width: 46%; }
    table.lines .item-name { font-weight: 600; color: #0F172A; }
    table.lines .item-notes {
      font-size: 10px; color: #64748B; margin-top: 2px; line-height: 1.45;
    }
    table.lines .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
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
      padding-top: 10px;
      font-size: 14px; font-weight: 800;
    }
    .indicative-note {
      margin-top: 6px;
      font-size: 9.5px; color: #94A3B8; text-align: right;
    }

    /* Notice */
    .notice {
      margin-top: 22px; padding: 8px 12px;
      background: #EFF6FF; border: 1px solid #BFDBFE;
      border-radius: 5px;
      font-size: 9.5px; color: #1E3A8A; line-height: 1.5;
    }

    /* Footer */
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
    <div class="cargo-block">
      <img src="${CARGO_WORDMARK_URL}" alt="Cargo" class="wordmark"/>
      <div class="doctype">Order</div>
      <div class="ref">#${escapeHtml(orderRef)}</div>
    </div>
    <div class="meta-block">
      <h1>ORDER ACKNOWLEDGEMENT</h1>
      <div class="meta">
        <div><span class="label">Generated</span><span class="value">${fmtDate(generatedAt.toISOString())}</span></div>
        ${order.created_at
          ? `<div><span class="label">Placed</span><span class="value">${fmtDate(order.created_at)}</span></div>` : ''}
        ${order.status
          ? `<div><span class="label">Status</span><span class="value">${escapeHtml(order.status)}</span></div>` : ''}
      </div>
    </div>
  </header>

  <section class="parties">
    <div class="block">
      <div class="heading">From (supplier)</div>
      <div class="body"><strong>${supplierName}</strong></div>
      ${supplier?.business_city ? `<div class="body sub">${escapeHtml(supplier.business_city)}${supplier.business_address_line1 ? ', ' + escapeHtml(supplier.business_address_line1) : ''}</div>` : ''}
    </div>
    <div class="block" style="text-align:right">
      <div class="heading">To (vessel)</div>
      <div class="body"><strong>${vesselName}</strong></div>
      ${order.delivery_contact ? `<div class="body sub">Attn: ${escapeHtml(order.delivery_contact)}</div>` : ''}
    </div>
  </section>

  ${deliveryBlocks.length > 0 ? `<section class="delivery">${deliveryBlocks.join('')}</section>` : ''}

  <table class="lines">
    <thead>
      <tr>
        <th class="desc">Item</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="status">Status</th>
        <th class="num">Line total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr class="grand"><td>Order subtotal</td><td>${escapeHtml(totalCurrency)} ${fmtAmount(subtotal)}</td></tr>
    </table>
  </div>
  <div class="indicative-note">
    Indicative — based on best available price per line. Final billing on the supplier invoice.
  </div>

  <div class="notice">
    This order acknowledgement is an operational record only. Tax, terms, and final pricing apply on the supplier's invoice.
  </div>

  <div class="cargo-stamp">
    <img src="${CARGO_WORDMARK_URL}" alt=""/>
    <span>Generated with Cargo · cargotechnology.co.uk</span>
  </div>

</div>
</body>
</html>`;
}

// ─── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!PDFSHIFT_API_KEY) return jsonResponse({ error: 'PDFSHIFT_API_KEY not configured' }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: 'Supabase env not configured' }, 500);

  const auth = req.headers.get('Authorization') || '';
  const user = await userFromJwt(auth);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const { orderId } = body || {};
  if (!orderId) return jsonResponse({ error: 'Missing orderId' }, 400);

  try {
    // 1) Resolve caller → supplier_id
    const contacts = await restGet<any[]>(
      `supplier_contacts?user_id=eq.${user.id}&select=id,supplier_id,active,name&limit=1`
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

    // 3) Supplier profile (for currency + display)
    const profiles = await restGet<any[]>(`supplier_profiles?id=eq.${supplierId}&select=*`);
    const supplier = profiles?.[0];
    if (!supplier) return jsonResponse({ error: 'Supplier profile not found' }, 404);

    // 4) Render + convert
    const generatedAt = new Date();
    const html = renderOrderHtml({ supplier, order, items, generatedAt });

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

    // 5) Upload — path scoped under {supplier_id}/{order_id}/order.pdf so the
    //    delivery note and signed pdf can live alongside it under the same
    //    folder. Storage RLS keys off (storage.foldername(name))[1] === supplierId.
    const pdfPath = `${supplierId}/${order.id}/order.pdf`;
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

    // 6) Update parent row
    await restPatch(`supplier_orders?id=eq.${orderId}`, {
      order_pdf_url: pdfPath,
      order_pdf_generated_at: generatedAt.toISOString(),
    });

    // 7) Activity event — best-effort (don't fail the request if the activity
    //    table is missing for any reason).
    try {
      await restPostNoReturn('supplier_order_activity', {
        order_id: orderId,
        event_type: 'order_pdf_generated',
        actor_user_id: user.id,
        actor_supplier_contact_id: callerContact.id,
        actor_name: callerContact.name || null,
        actor_role: 'supplier',
        payload: { url: pdfPath, generated_by_role: 'supplier' },
      });
    } catch (logErr) {
      console.warn('[generateOrderPdf] activity write failed', logErr);
    }

    // 8) Mint a 10-min signed URL for the caller
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
      signedUrl = sig?.signedURL ? `${SUPABASE_URL}/storage/v1${sig.signedURL}` : null;
    }

    return jsonResponse({
      pdf_path: pdfPath,
      signed_url: signedUrl,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      generated_at: generatedAt.toISOString(),
    }, 200);

  } catch (err: any) {
    console.error('[generateOrderPdf]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});
