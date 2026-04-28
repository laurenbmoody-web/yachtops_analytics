// Supabase Edge Function: signDeliveryNote
//
// Public capability-token endpoint hit by /delivery-sign/<token> when the
// receiving crew submits the form. Writes the signature back to
// supplier_orders, snapshots the signature PNG to the supplier-documents
// bucket, regenerates the SIGNED delivery note PDF, advances the order
// status (dispatched → delivered), and writes a delivery_signed activity
// event.
//
// Auth model: NO JWT REQUIRED. Possession of the 32-char delivery_signing_
// token IS the authorisation. We trust the token, validate its shape, and
// look up the order via the service role. This mirrors the
// fetch_order_for_delivery_signing RPC's stance — capability URL semantics.
//
// Sprint 9c note: status currently advances dispatched → delivered on
// crew signature alone. When 9c lands supplier-side dual signing, the
// rule becomes: only advance when both supplier_signed_at AND
// crew_signed_at are populated. This file is the place to update that
// gate. Discrepancy notes already write to crew_discrepancy_notes which
// is queryable from the vessel side via RLS on supplier_orders — Sprint 9c
// will surface it as a return-trigger hint.
//
// Env:
//   PDFSHIFT_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Body: {
//   token: string,                    // 32-char capability token
//   signer_name: string,              // typed printed name
//   signature_data_url: string,       // 'data:image/png;base64,...' from canvas
//   discrepancy_notes?: string|null,  // optional free-text
// }
//
// Response: { ok: true, signed_pdf_path } on success
//           { error } on failure

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
const BUCKET                  = 'supplier-documents';

// Sanity cap on signature payload — a 560×110 PNG base64-encoded is
// typically <30KB; 2MB is generous enough for any reasonable canvas.
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

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

function fmtDateTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function shortRef(id: string): string {
  return String(id || '').slice(0, 8).toUpperCase();
}

// Decode a 'data:image/png;base64,...' URL into raw bytes. Returns null
// if the input doesn't look like a PNG data URL.
function decodePngDataUrl(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl || '');
  if (!match) return null;
  try {
    const b64 = match[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ─── Render template (signed variant) ────────────────────────────────────

interface SignedRenderInput {
  supplier: any;
  order: any;
  items: any[];
  signedAt: Date;
  signerName: string;
  signatureDataUrl: string;
  discrepancyNotes: string | null;
}

function renderSignedHtml(input: SignedRenderInput): string {
  const { supplier, order, items, signedAt, signerName, signatureDataUrl, discrepancyNotes } = input;
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
        <td class="check"><div class="checkbox checked">✓</div></td>
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

  const discrepancyBlock = discrepancyNotes
    ? `
    <section class="discrepancy">
      <div class="heading">Discrepancies noted at signing</div>
      <p>${escapeHtml(discrepancyNotes)}</p>
    </section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Signed delivery note ${escapeHtml(orderRef)}</title>
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
    .signed-badge {
      display: inline-block; margin-bottom: 10px;
      padding: 4px 12px; border-radius: 999px;
      background: #DCFCE7; color: #166534;
      font-size: 10.5px; font-weight: 800;
      letter-spacing: 0.1em; text-transform: uppercase;
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
      border: 1.5px solid #166534; border-radius: 3px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; color: #166534; font-weight: 800;
      background: #DCFCE7;
    }
    table.lines .badge {
      display: inline-block; padding: 1px 6px; margin-left: 6px;
      border-radius: 999px; font-size: 9px; font-weight: 700;
      letter-spacing: 0.04em; text-transform: uppercase; vertical-align: middle;
    }
    table.lines .badge-sub { background: #FEF3C7; color: #92400E; }
    table.lines .badge-unavail { background: #FEE2E2; color: #991B1B; }

    /* Discrepancy panel — only present when notes captured */
    section.discrepancy {
      margin-top: 18px; padding: 12px 16px;
      background: #FFFBEB; border: 1px solid #FDE68A;
      border-radius: 6px;
    }
    section.discrepancy .heading {
      font-size: 9.5px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #92400E;
      font-weight: 700; margin-bottom: 6px;
    }
    section.discrepancy p {
      margin: 0; font-size: 11.5px; color: #78350F; line-height: 1.55;
    }

    /* Signed block — replaces the QR / signature lines from the unsigned template */
    .sign-block {
      margin-top: 24px;
      padding: 18px;
      border: 1.5px solid #166534;
      border-radius: 8px;
      background: #F0FDF4;
    }
    .sign-block .h2 {
      font-size: 14px; font-weight: 800; margin: 0 0 4px;
      letter-spacing: -0.005em; color: #166534;
    }
    .sign-block .signature-row {
      margin-top: 14px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
      align-items: end;
    }
    .sign-block .field .label {
      display: block;
      font-size: 9.5px; color: #64748B;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 6px; font-weight: 600;
    }
    .sign-block .field .signature-img {
      max-width: 100%; max-height: 80px; display: block;
      border-bottom: 1px solid #166534;
      padding-bottom: 4px;
    }
    .sign-block .field .printed {
      font-size: 14px; font-weight: 700; color: #0F172A;
      border-bottom: 1px solid #166534; padding-bottom: 4px;
      min-height: 28px;
    }
    .sign-block .field .signed-at {
      margin-top: 6px; font-size: 10px; color: #475569;
    }

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
      <div class="signed-badge">✓ Signed</div>
      <h1>DELIVERY NOTE</h1>
      <div class="meta">
        <div><span class="label">Signed</span><span class="value">${fmtDate(signedAt.toISOString())}</span></div>
        ${order.delivery_note_generated_at
          ? `<div><span class="label">Issued</span><span class="value">${fmtDate(order.delivery_note_generated_at)}</span></div>` : ''}
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
      <div class="heading">Received by</div>
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

  ${discrepancyBlock}

  <div class="sign-block">
    <div class="h2">Signed on receipt</div>
    <div class="signature-row">
      <div class="field">
        <span class="label">Printed name</span>
        <div class="printed">${escapeHtml(signerName)}</div>
        <div class="signed-at">${fmtDateTime(signedAt.toISOString())}</div>
      </div>
      <div class="field">
        <span class="label">Signature</span>
        <img src="${escapeHtml(signatureDataUrl)}" alt="Signature" class="signature-img"/>
      </div>
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

  // No JWT validation — capability token IS the auth.

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const {
    token,
    signer_name,
    signature_data_url,
    discrepancy_notes,
  } = body || {};

  // Input validation
  if (typeof token !== 'string' || token.length < 16) {
    return jsonResponse({ error: 'Invalid token' }, 400);
  }
  if (typeof signer_name !== 'string' || !signer_name.trim()) {
    return jsonResponse({ error: 'signer_name is required' }, 400);
  }
  if (typeof signature_data_url !== 'string' || !signature_data_url.startsWith('data:image/png;base64,')) {
    return jsonResponse({ error: 'signature_data_url must be a base64-encoded PNG data URL' }, 400);
  }
  const sigBytes = decodePngDataUrl(signature_data_url);
  if (!sigBytes) {
    return jsonResponse({ error: 'Could not decode signature_data_url' }, 400);
  }
  if (sigBytes.length > MAX_SIGNATURE_BYTES) {
    return jsonResponse({ error: 'Signature image too large' }, 413);
  }
  const trimmedSignerName = signer_name.trim();
  const trimmedDiscrepancy = (typeof discrepancy_notes === 'string' && discrepancy_notes.trim())
    ? discrepancy_notes.trim()
    : null;

  // Forensic envelope — captured from the request and stamped into
  // crew_signature.jsonb for audit. ip is best-effort; behind Supabase's
  // edge proxy it's the client-facing forwarded value.
  const forensicIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;

  try {
    // 1) Look up order by token (service role bypasses RLS)
    const orders = await restGet<any[]>(
      `supplier_orders?delivery_signing_token=eq.${encodeURIComponent(token)}&select=*,supplier_order_items(*)&limit=1`
    );
    const order = orders?.[0];
    if (!order) {
      return jsonResponse({ error: 'Token not found' }, 404);
    }

    // Preconditions
    if (!order.delivery_note_pdf_url) {
      return jsonResponse({ error: 'Delivery note has not been generated yet' }, 409);
    }
    if (order.crew_signed_at) {
      return jsonResponse({
        error: 'This delivery has already been signed',
        already_signed: true,
        signed_at: order.crew_signed_at,
      }, 409);
    }

    const supplierId = order.supplier_profile_id;
    const items: any[] = order.supplier_order_items || [];

    // 2) Supplier display info
    const profiles = await restGet<any[]>(`supplier_profiles?id=eq.${supplierId}&select=*`);
    const supplier = profiles?.[0];
    if (!supplier) return jsonResponse({ error: 'Supplier profile not found' }, 404);

    const signedAt = new Date();

    // 3) Snapshot signature PNG to the bucket. Lives alongside the order's
    //    other documents at {supplier_id}/{order_id}/signature.png so
    //    auditors can pull the canonical image without re-decoding the
    //    JSONB envelope.
    const signaturePath = `${supplierId}/${order.id}/signature.png`;
    const sigUploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${signaturePath}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'image/png',
          'x-upsert': 'true',
        },
        body: sigBytes,
      }
    );
    if (!sigUploadRes.ok) {
      const txt = await sigUploadRes.text();
      console.error('[signDeliveryNote] signature upload failed', sigUploadRes.status, txt);
      // Non-fatal — JSONB envelope still has the data URL. Continue.
    }

    // 4) Render signed PDF + convert via PDFShift
    const html = renderSignedHtml({
      supplier, order, items, signedAt,
      signerName: trimmedSignerName,
      signatureDataUrl: signature_data_url,
      discrepancyNotes: trimmedDiscrepancy,
    });

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

    // 5) Upload signed PDF — distinct path so the unsigned copy stays
    //    on file (audit trail).
    const signedPdfPath = `${supplierId}/${order.id}/delivery_note_signed.pdf`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${signedPdfPath}`,
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
      return jsonResponse({ error: `Signed PDF upload failed: ${uploadRes.status} ${await uploadRes.text()}` }, 500);
    }

    // 6) Update parent row. Status advance is conditional — only flip
    //    dispatched → delivered. We don't move backward (e.g. from
    //    'invoiced') and we don't skip ahead from earlier states (a
    //    supplier signing while still 'picking' is unusual; we honour
    //    the signature but leave the lifecycle alone for them to advance
    //    manually).
    //
    //    Sprint 9c will add a parallel supplier_signed_at; the rule
    //    becomes "advance only when both supplier_signed_at AND
    //    crew_signed_at are populated".
    const newStatus = order.status === 'dispatched' ? 'delivered' : order.status;

    await restPatch(`supplier_orders?id=eq.${order.id}`, {
      crew_signed_at:           signedAt.toISOString(),
      crew_signature: {
        data_url:   signature_data_url,
        ip:         forensicIp,
        user_agent: userAgent,
        signed_at:  signedAt.toISOString(),
      },
      crew_signer_name:         trimmedSignerName,
      crew_discrepancy_notes:   trimmedDiscrepancy,
      delivery_note_signed_pdf_url: signedPdfPath,
      status:                   newStatus,
    });

    // 7) Activity event — best-effort. actor_role='vessel' so the supplier
    //    portal feed labels it as crew-side.
    try {
      await restPostNoReturn('supplier_order_activity', {
        order_id: order.id,
        event_type: 'delivery_signed',
        actor_user_id: null,           // anon — capability URL signer
        actor_supplier_contact_id: null,
        actor_name: trimmedSignerName,
        actor_role: 'vessel',
        payload: {
          signer_name:           trimmedSignerName,
          has_discrepancy_notes: !!trimmedDiscrepancy,
          signed_pdf_url:        signedPdfPath,
          status_advanced:       newStatus !== order.status,
          status_from:           order.status,
          status_to:             newStatus,
        },
      });
    } catch (logErr) {
      console.warn('[signDeliveryNote] activity write failed', logErr);
    }

    return jsonResponse({
      ok: true,
      signed_pdf_path: signedPdfPath,
      signed_at: signedAt.toISOString(),
      status: newStatus,
    }, 200);

  } catch (err: any) {
    console.error('[signDeliveryNote]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});
