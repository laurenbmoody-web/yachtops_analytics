// Supabase Edge Function: generateDeliveryNote
//
// Renders a Cargo-branded UNSIGNED delivery note PDF, embeds a QR code that
// links to the public signing page (/delivery-sign/<token>), uploads to the
// supplier-documents bucket, and writes back the storage path + signing
// token + timestamp on supplier_orders.
//
// Token policy: the 32-char delivery_signing_token is minted ONCE and
// preserved across regenerations. This means a supplier can regenerate the
// PDF (e.g. after editing the line items) without invalidating any URL the
// receiving crew may have already received. Cleanup of an unwanted token
// would require a deliberate void/replace flow (not in this sprint).
//
// Lock-out: once delivered_signed_at IS NOT NULL the order is considered
// signed and we refuse to regenerate the unsigned note. The signed-PDF path
// (delivery_note_signed_pdf_url) is the canonical record at that point.
// Server returns 409 Conflict with a clear error message.
//
// QR generation: tries npm:qrcode first (data-URL embed, no external
// dependency at PDF render time). If that import or call fails, falls back
// to a hosted api.qrserver.com URL embedded as <img> — PDFShift fetches it
// at render time. Both paths produce a working ~200×200 QR.
//
// Env:
//   PDFSHIFT_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SITE_URL                    (optional; defaults to cargotechnology.netlify.app)
//
// Body: { orderId: uuid }
// Response: { pdf_path, signing_token, signed_url, expires_at, generated_at }

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
const SITE_URL                = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
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
  return String(t).slice(0, 5);
}

function shortRef(id: string): string {
  return String(id || '').slice(0, 8).toUpperCase();
}

// 32-char URL-safe token. Crypto-random — collisions are astronomically
// unlikely but the unique partial index will reject duplicates anyway.
function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url, trim padding, take 32 chars (24 bytes ≈ 32 b64url chars)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    .slice(0, 32);
}

// QR generation: prefer npm:qrcode (in-PDF data URL, no fetch at render
// time). Fall back to api.qrserver.com hosted URL on any failure.
async function buildQrSrc(target: string): Promise<string> {
  try {
    // Dynamic import isolates the failure surface — if Deno can't resolve
    // npm:qrcode for any reason we drop into the catch and use the hosted
    // fallback.
    const mod: any = await import('npm:qrcode@1.5.3');
    const toDataURL = mod?.toDataURL || mod?.default?.toDataURL;
    if (typeof toDataURL !== 'function') throw new Error('qrcode.toDataURL not callable');
    const dataUrl: string = await toDataURL(target, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    if (!dataUrl?.startsWith('data:image')) throw new Error('qrcode returned non-data-url');
    return dataUrl;
  } catch (err) {
    console.warn('[generateDeliveryNote] qrcode npm path failed, using qrserver fallback:', err);
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=4&data=${encodeURIComponent(target)}`;
  }
}

// ─── Render template ─────────────────────────────────────────────────────

interface DeliveryNoteRenderInput {
  supplier: any;
  order: any;
  items: any[];
  generatedAt: Date;
  signingUrl: string;
  qrSrc: string;
}

function renderDeliveryNoteHtml(input: DeliveryNoteRenderInput): string {
  const { supplier, order, items, generatedAt, signingUrl, qrSrc } = input;
  const orderRef = shortRef(order.id);
  const supplierName = escapeHtml(supplier?.name || 'Supplier');
  const vesselName = escapeHtml(order.vessel_name || order.yacht_name || 'Vessel');

  const itemRows = items.map((it: any) => {
    const qty = `${it.quantity ?? ''}${it.unit ? ' ' + escapeHtml(it.unit) : ''}`.trim();
    const note = it.notes
      ? `<div class="item-notes">${escapeHtml(it.notes)}</div>` : '';
    const sub = it.substitute_description
      ? `<div class="item-notes"><strong>Substitute:</strong> ${escapeHtml(it.substitute_description)}</div>` : '';
    const isUnavail = it.quote_status === 'unavailable' || it.status === 'unavailable';
    const isSubstituted = it.status === 'substituted' || (it.substitute_description && !isUnavail);
    const statusBadge = isUnavail
      ? `<span class="badge badge-unavail">Unavailable</span>`
      : isSubstituted
      ? `<span class="badge badge-sub">Substituted</span>`
      : '';
    return `
      <tr>
        <td class="check"><div class="checkbox"></div></td>
        <td class="desc">
          <div class="item-name">${escapeHtml(it.item_name || '')} ${statusBadge}</div>
          ${note}${sub}
        </td>
        <td class="num">${qty}</td>
      </tr>`;
  }).join('');

  const deliveryBlocks: string[] = [];
  if (order.delivery_date) deliveryBlocks.push(`<div><span class="lbl">Date</span><span class="val">${fmtDate(order.delivery_date)}</span></div>`);
  if (order.delivery_time) deliveryBlocks.push(`<div><span class="lbl">Time</span><span class="val">${escapeHtml(fmtTime(order.delivery_time))}</span></div>`);
  if (order.delivery_port) deliveryBlocks.push(`<div><span class="lbl">Port</span><span class="val">${escapeHtml(order.delivery_port)}</span></div>`);
  if (order.delivery_contact) deliveryBlocks.push(`<div><span class="lbl">Contact</span><span class="val">${escapeHtml(order.delivery_contact)}</span></div>`);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Delivery note ${escapeHtml(orderRef)}</title>
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

    .parties {
      margin: 18px 0 6px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    }
    .parties .block .heading {
      font-size: 9.5px; color: #64748B;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 4px; font-weight: 600;
    }
    .parties .block .body { font-size: 12px; color: #0F172A; line-height: 1.5; }
    .parties .block .body strong { font-weight: 700; }
    .parties .block .body .sub { font-size: 10.5px; color: #475569; margin-top: 2px; }

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

    /* Items list — checkboxes for crew to tick on paper if needed */
    table.lines {
      width: 100%; margin: 22px 0 0; border-collapse: collapse;
    }
    table.lines th, table.lines td {
      padding: 9px 8px; text-align: left;
      border-bottom: 1px solid #E2E8F0;
      font-size: 11px;
      vertical-align: top;
    }
    table.lines th {
      font-size: 9px; letter-spacing: 0.08em;
      text-transform: uppercase; color: #475569;
      font-weight: 600; border-bottom: 1.5px solid #0F172A;
      padding-bottom: 6px;
    }
    table.lines td.num, table.lines th.num {
      text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    table.lines td.check, table.lines th.check {
      width: 28px; text-align: center;
    }
    table.lines td.desc { width: 70%; }
    table.lines .item-name { font-weight: 600; color: #0F172A; }
    table.lines .item-notes {
      font-size: 10px; color: #64748B; margin-top: 2px; line-height: 1.45;
    }
    table.lines .checkbox {
      width: 14px; height: 14px;
      border: 1.5px solid #94A3B8; border-radius: 3px;
      display: inline-block;
    }
    table.lines .badge {
      display: inline-block; padding: 1px 6px; margin-left: 6px;
      border-radius: 999px; font-size: 9px; font-weight: 700;
      letter-spacing: 0.04em; text-transform: uppercase; vertical-align: middle;
    }
    table.lines .badge-sub { background: #FEF3C7; color: #92400E; }
    table.lines .badge-unavail { background: #FEE2E2; color: #991B1B; }

    /* Sign-off block */
    .sign-block {
      margin-top: 24px;
      display: grid; grid-template-columns: 1fr 240px; gap: 24px;
      padding: 18px;
      border: 1.5px solid #0F172A;
      border-radius: 8px;
      background: #fff;
    }
    .sign-block .left .h2 {
      font-size: 14px; font-weight: 800; margin: 0 0 4px;
      letter-spacing: -0.005em;
    }
    .sign-block .left p {
      margin: 0 0 10px;
      font-size: 11px; color: #475569; line-height: 1.55;
    }
    .sign-block .left .url-line {
      font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
      color: #0F172A; word-break: break-all;
      background: #F1F5F9; padding: 6px 8px; border-radius: 4px;
    }
    .sign-block .left .signature-row {
      margin-top: 14px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    }
    .sign-block .left .signature-row .field .label {
      display: block;
      font-size: 9.5px; color: #64748B;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 4px; font-weight: 600;
    }
    .sign-block .left .signature-row .field .line {
      border-bottom: 1px solid #0F172A; height: 28px;
    }

    .sign-block .right { text-align: center; }
    .sign-block .right img.qr {
      width: 200px; height: 200px; display: block; margin: 0 auto;
    }
    .sign-block .right .qr-cap {
      margin-top: 6px;
      font-size: 9.5px; color: #475569; line-height: 1.5;
    }
    .sign-block .right .qr-cap strong { color: #0F172A; }

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
    <div class="cargo-block">
      <img src="${CARGO_WORDMARK_URL}" alt="Cargo" class="wordmark"/>
      <div class="doctype">Delivery note</div>
      <div class="ref">#${escapeHtml(orderRef)}</div>
    </div>
    <div class="meta-block">
      <h1>DELIVERY NOTE</h1>
      <div class="meta">
        <div><span class="label">Issued</span><span class="value">${fmtDate(generatedAt.toISOString())}</span></div>
        ${order.created_at
          ? `<div><span class="label">Order placed</span><span class="value">${fmtDate(order.created_at)}</span></div>` : ''}
      </div>
    </div>
  </header>

  <section class="parties">
    <div class="block">
      <div class="heading">Delivered by</div>
      <div class="body"><strong>${supplierName}</strong></div>
      ${supplier?.business_city ? `<div class="body sub">${escapeHtml(supplier.business_city)}</div>` : ''}
    </div>
    <div class="block" style="text-align:right">
      <div class="heading">Delivered to</div>
      <div class="body"><strong>${vesselName}</strong></div>
      ${order.delivery_contact ? `<div class="body sub">Attn: ${escapeHtml(order.delivery_contact)}</div>` : ''}
    </div>
  </section>

  ${deliveryBlocks.length > 0 ? `<section class="delivery">${deliveryBlocks.join('')}</section>` : ''}

  <table class="lines">
    <thead>
      <tr>
        <th class="check">✓</th>
        <th class="desc">Item</th>
        <th class="num">Qty</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="sign-block">
    <div class="left">
      <div class="h2">Sign on receipt</div>
      <p>Scan the QR code with a phone to sign on screen, or sign below in pen and return a photo.</p>
      <div class="url-line">${escapeHtml(signingUrl)}</div>
      <div class="signature-row">
        <div class="field">
          <span class="label">Printed name</span>
          <div class="line"></div>
        </div>
        <div class="field">
          <span class="label">Signature</span>
          <div class="line"></div>
        </div>
      </div>
    </div>
    <div class="right">
      <img src="${escapeHtml(qrSrc)}" alt="QR code to signing page" class="qr"/>
      <div class="qr-cap"><strong>Scan to sign</strong><br/>One-time link for this order.</div>
    </div>
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
    if (items.length === 0) return jsonResponse({ error: 'Order has no line items' }, 400);

    // Lock-out: if the order is already signed, refuse to regenerate the
    // unsigned note. The signed PDF is the canonical record.
    if (order.delivered_signed_at) {
      return jsonResponse({
        error: 'Cannot regenerate — delivery note has already been signed. Use the signed copy from Documents.',
      }, 409);
    }

    // 3) Supplier profile
    const profiles = await restGet<any[]>(`supplier_profiles?id=eq.${supplierId}&select=*`);
    const supplier = profiles?.[0];
    if (!supplier) return jsonResponse({ error: 'Supplier profile not found' }, 404);

    // 4) Reuse existing token if one is already minted; otherwise mint a
    //    fresh one. Preserves any URLs the supplier has already shared.
    const tokenWasNew = !order.delivery_signing_token;
    const signingToken = order.delivery_signing_token || mintToken();
    const signingUrl = `${SITE_URL}/delivery-sign/${signingToken}`;

    // 5) QR — try npm:qrcode, fall back to api.qrserver.com
    const qrSrc = await buildQrSrc(signingUrl);

    // 6) Render + convert
    const generatedAt = new Date();
    const html = renderDeliveryNoteHtml({ supplier, order, items, generatedAt, signingUrl, qrSrc });

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

    // 7) Upload — same {supplier_id}/{order_id}/ folder as the order PDF
    const pdfPath = `${supplierId}/${order.id}/delivery_note.pdf`;
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

    // 8) Update parent row
    const patchPayload: Record<string, unknown> = {
      delivery_note_pdf_url: pdfPath,
      delivery_note_generated_at: generatedAt.toISOString(),
    };
    if (tokenWasNew) {
      patchPayload.delivery_signing_token = signingToken;
    }
    await restPatch(`supplier_orders?id=eq.${orderId}`, patchPayload);

    // 9) Activity event — best-effort. Token itself is NOT in the payload.
    try {
      await restPostNoReturn('supplier_order_activity', {
        order_id: orderId,
        event_type: 'delivery_note_generated',
        actor_user_id: user.id,
        actor_supplier_contact_id: callerContact.id,
        actor_name: callerContact.name || null,
        actor_role: 'supplier',
        payload: { url: pdfPath, signing_token_minted: tokenWasNew },
      });
    } catch (logErr) {
      console.warn('[generateDeliveryNote] activity write failed', logErr);
    }

    // 10) Mint a 10-min signed URL for the caller
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
      signing_token: signingToken,
      signed_url: signedUrl,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      generated_at: generatedAt.toISOString(),
      token_was_new: tokenWasNew,
    }, 200);

  } catch (err: any) {
    console.error('[generateDeliveryNote]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});
