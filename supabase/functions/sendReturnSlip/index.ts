// Supabase Edge Function: sendReturnSlip
//
// Builds a professional HTML return slip email and sends it via Resend.
// reply_to is set to the crew member's email so supplier replies route correctly.
//
// Env vars required:
//   RESEND_API_KEY

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';

// ── HTML email builder ────────────────────────────────────────────────────────

function cell(label: string, value: string): string {
  return `<td style="padding:4px 0;font-size:12px;color:#0F172A;width:50%;vertical-align:top">
    <span style="color:#94A3B8">${label}:</span> ${value || '—'}
  </td>`;
}

function buildEmailHtml(b: any): string {
  const fmtMoney = (v: any) => {
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  };

  const showPricing  = b.items.some((i: any) => i.unit_price || i.line_total);
  const showRef      = b.items.some((i: any) => i.item_reference);
  const showOrdered  = b.items.some((i: any) => i.ordered_qty != null);

  const grandTotal   = b.items.reduce((s: number, i: any) => s + (parseFloat(i.line_total) || 0), 0);

  // Table header cells
  const thStyle = 'padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#475569;background:#F8FAFC;border-bottom:2px solid #E2E8F0';
  const tdStyle = 'padding:8px 10px;font-size:12px;color:#0F172A;border-bottom:1px solid #F1F5F9;vertical-align:top';

  const itemRows = b.items.map((i: any) => `
    <tr>
      ${showRef     ? `<td style="${tdStyle};color:#94A3B8;font-size:11px">${i.item_reference || '—'}</td>` : ''}
      <td style="${tdStyle}">${i.raw_name}</td>
      ${showOrdered ? `<td style="${tdStyle};text-align:center;color:#64748B">${i.ordered_qty ?? '—'}</td>` : ''}
      <td style="${tdStyle};text-align:center">${i.quantity ?? '—'}${i.unit ? ' ' + i.unit : ''}</td>
      <td style="${tdStyle};text-align:center;font-weight:600">${i.return_qty ?? i.quantity}</td>
      ${showPricing ? `<td style="${tdStyle};text-align:right;color:#64748B">${fmtMoney(i.unit_price)}</td>` : ''}
      ${showPricing ? `<td style="${tdStyle};text-align:right">${fmtMoney(i.line_total)}</td>` : ''}
      <td style="${tdStyle}">${i.return_reason || '—'}</td>
      <td style="${tdStyle};color:#64748B">${i.return_notes || ''}</td>
    </tr>
  `).join('');

  const totalRow = showPricing && grandTotal > 0 ? `
    <tr>
      <td colspan="${(showRef ? 1 : 0) + 1 + (showOrdered ? 1 : 0) + 1 + 1 + 1}" style="padding:8px 10px;text-align:right;font-weight:600;font-size:12px;background:#F8FAFC;border-top:2px solid #E2E8F0">Total</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;font-size:13px;background:#F8FAFC;border-top:2px solid #E2E8F0">${fmtMoney(grandTotal)}</td>
      <td colspan="2" style="background:#F8FAFC;border-top:2px solid #E2E8F0"></td>
    </tr>` : '';

  // Data URIs are stripped by most email clients (Gmail, Outlook).
  // Show a text-based "Signed digitally" indicator instead — always reliable.
  const sigBlock = b.vesselSignature
    ? `<img src="cid:vessel-signature" alt="Vessel signature" style="height:60px;max-width:240px;display:block;margin-bottom:6px">`
    : `<div style="height:32px"></div>`;

  const vesselSigLine = b.vesselSignature && b.signerName
    ? `<div style="font-size:11px;font-style:italic;color:#334155;margin-top:2px">Signed by ${[b.signerName, b.signerJobTitle].filter(Boolean).join(' · ')}</div>`
    : `<div style="font-size:11px;color:#94A3B8">Name, signature &amp; date</div>`;

  const orderRefText = b.orderRef ? `delivery ${b.orderRef}` : 'the referenced order';
  const replyContact = [b.signerName, b.signerJobTitle].filter(Boolean).join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
<tr><td align="center">

  <!-- ── Single white email container ── -->
  <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">

    <!-- Intro text -->
    <tr><td style="padding:32px 32px 24px">
      <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6">Dear ${b.supplierName || 'Supplier'},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6">
        <strong>${b.vesselName || 'The vessel'}</strong> has submitted a return for ${orderRefText}.
        The return slip is detailed below.
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.6">
        Please review the items and confirm receipt by clicking the button below.
        For any queries relating to this return, please reply to this email which will be directed to ${replyContact ? `<strong>${replyContact}</strong>` : 'the vessel'}.
      </p>
      <p style="margin:0;font-size:14px;color:#334155;line-height:1.8">
        Kind regards,<br>
        <strong>Cargo</strong><br>
        <span style="color:#64748B;font-size:13px">on behalf of ${b.vesselName || 'the vessel'}</span>
      </p>
    </td></tr>

    <!-- Divider -->
    <tr><td style="padding:0 32px"><div style="border-top:1px solid #E2E8F0"></div></td></tr>

    <!-- ── Return slip card (inset with horizontal padding) ── -->
    <tr><td style="padding:20px 20px 24px">

      <!-- Navy header — rounded top corners -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#1E3A5F;border-radius:10px 10px 0 0;padding:22px 24px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px">RETURN SLIP</div>
                  <div style="font-size:12px;color:#93C5FD;margin-top:4px">${b.vesselName}${b.imoNumber ? ' &nbsp;·&nbsp; IMO: ' + b.imoNumber : ''}${b.vesselFlag ? ' &nbsp;·&nbsp; ' + b.vesselFlag : ''}</div>
                </td>
                <td align="right" style="vertical-align:top">
                  <div style="font-size:12px;color:#CBD5E1">${b.date}</div>
                  ${b.preparedBy ? `<div style="font-size:12px;color:#CBD5E1;margin-top:2px">Prepared by: ${b.preparedBy}</div>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- White body — 1px border, rounded bottom corners -->
        <tr>
          <td style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px 24px">

            <!-- Supplier details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:8px;margin-bottom:18px">
              <tr><td style="padding:14px 16px">
                <div style="font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Supplier</div>
                <div style="font-size:15px;font-weight:700;color:#0F172A;margin-bottom:6px">${b.supplierName || '—'}</div>
                ${b.supplierAddress ? `<div style="font-size:12px;color:#64748B;margin-bottom:4px">${b.supplierAddress}</div>` : ''}
                <table cellpadding="0" cellspacing="0"><tr>
                  ${b.supplierPhone ? `<td style="font-size:12px;color:#64748B;padding-right:20px">Tel: ${b.supplierPhone}</td>` : ''}
                  ${b.supplierEmail ? `<td style="font-size:12px;color:#64748B">${b.supplierEmail}</td>` : ''}
                </tr></table>
              </td></tr>
            </table>

            <!-- Order reference -->
            ${(b.orderRef || b.orderDate) ? `
            <table cellpadding="0" cellspacing="4" style="margin-bottom:18px">
              <tr>
                ${b.orderRef  ? `<td style="font-size:12px;color:#475569;padding-right:24px"><strong>Order Ref:</strong> ${b.orderRef}</td>` : ''}
                ${b.orderDate ? `<td style="font-size:12px;color:#475569"><strong>Order Date:</strong> ${b.orderDate}</td>` : ''}
              </tr>
            </table>` : ''}

            <!-- Items table -->
            <div style="font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Items for Return</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-bottom:24px">
              <tr>
                ${showRef     ? `<th style="${thStyle}">Ref</th>` : ''}
                <th style="${thStyle}">Description</th>
                ${showOrdered ? `<th style="${thStyle};text-align:center">Ordered</th>` : ''}
                <th style="${thStyle};text-align:center">Delivered</th>
                <th style="${thStyle};text-align:center">Return Qty</th>
                ${showPricing ? `<th style="${thStyle};text-align:right">Unit Price</th>` : ''}
                ${showPricing ? `<th style="${thStyle};text-align:right">Total</th>` : ''}
                <th style="${thStyle}">Reason</th>
                <th style="${thStyle}">Notes</th>
              </tr>
              ${itemRows}
              ${totalRow}
            </table>

            <!-- Signature blocks -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr valign="top">
                <td width="48%" style="padding-right:16px">
                  ${sigBlock}
                  <div style="border-bottom:1px solid #CBD5E1;margin-bottom:6px"></div>
                  <div style="font-size:12px;color:#64748B">Vessel authorisation</div>
                  ${vesselSigLine}
                </td>
                <td width="4%"></td>
                <td width="48%" style="padding-left:16px">
                  ${b.confirmationToken ? `
                  <a href="https://cargotechnology.netlify.app/return-confirm?token=${b.confirmationToken}"
                     style="display:inline-block;padding:12px 24px;background:#059669;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;margin-bottom:6px">
                    Confirm Receipt &amp; Sign
                  </a>
                  <div style="font-size:11px;color:#94A3B8;margin-top:6px">Click to confirm and add your signature</div>
                  ` : `
                  <div style="height:60px"></div>
                  <div style="border-bottom:1px solid #CBD5E1;margin-bottom:6px"></div>
                  <div style="font-size:12px;color:#64748B">Supplier acknowledgement</div>
                  <div style="font-size:11px;color:#94A3B8">Name, signature &amp; date</div>
                  `}
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>

    </td></tr>

    <!-- Footer -->
    <tr>
      <td style="background:#F8FAFC;padding:14px 28px;border-top:1px solid #E2E8F0;border-radius:0 0 12px 12px">
        <p style="margin:0;font-size:11px;color:#94A3B8;text-align:center">This return slip was sent via Cargo (cargotechnology.app)</p>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.to) {
    return new Response(JSON.stringify({ error: 'Missing required field: to' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const subject = [
    'Return Slip',
    body.vesselName || 'Vessel',
    body.orderRef   || null,
    body.date       || null,
  ].filter(Boolean).join(' — ');

  console.log('[sendReturnSlip] Sending to:', body.to, '| subject:', subject, '| items:', body.items?.length);

  const emailPayload: any = {
    from:     'Cargo Returns <returns@cargotechnology.co.uk>',
    to:       [body.to],
    subject,
    html:     buildEmailHtml(body),
  };
  if (body.replyTo) emailPayload.reply_to = body.replyTo;

  // Attach vessel signature as an inline CID image so email clients render it.
  // Strip the data URI prefix — Resend expects raw base64.
  if (body.vesselSignature) {
    const base64Data = (body.vesselSignature as string).replace(/^data:image\/\w+;base64,/, '');
    emailPayload.attachments = [{
      filename:     'signature.png',
      content:      base64Data,
      content_type: 'image/png',
      disposition:  'inline',
      content_id:   'vessel-signature',
    }];
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  const resendData = await resendRes.json();
  console.log('[sendReturnSlip] Resend response:', resendRes.status, JSON.stringify(resendData));

  if (!resendRes.ok) {
    return new Response(JSON.stringify({ error: resendData?.message || `Resend error ${resendRes.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, id: resendData?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
