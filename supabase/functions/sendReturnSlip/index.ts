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
    ? `<div style="margin-bottom:6px">
         <span style="font-style:italic;font-size:13px;color:#1E40AF">Signed digitally by ${b.signerName || 'crew member'}</span>
         ${b.signerJobTitle ? `<div style="font-size:11px;color:#64748B;margin-top:2px">${b.signerJobTitle}</div>` : ''}
       </div>`
    : `<div style="height:32px"></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">

  <!-- ── Header ── -->
  <tr>
    <td style="background:#1E3A5F;padding:24px 28px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px">RETURN SLIP</div>
            <div style="font-size:13px;color:#93C5FD;margin-top:4px">${b.vesselName}${b.imoNumber ? ' &nbsp;·&nbsp; IMO: ' + b.imoNumber : ''}${b.vesselFlag ? ' &nbsp;·&nbsp; ' + b.vesselFlag : ''}</div>
          </td>
          <td align="right" style="vertical-align:top">
            <div style="font-size:12px;color:#CBD5E1">${b.date}</div>
            ${b.preparedBy ? `<div style="font-size:12px;color:#CBD5E1;margin-top:2px">Prepared by: ${b.preparedBy}</div>` : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr><td style="padding:24px 28px">


    <!-- ── Supplier details ── -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:8px;margin-bottom:20px">
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

    <!-- ── Order reference ── -->
    ${(b.orderRef || b.orderDate) ? `
    <table cellpadding="0" cellspacing="4" style="margin-bottom:20px">
      <tr>
        ${b.orderRef  ? `<td style="font-size:12px;color:#475569;padding-right:24px"><strong>Order Ref:</strong> ${b.orderRef}</td>` : ''}
        ${b.orderDate ? `<td style="font-size:12px;color:#475569"><strong>Order Date:</strong> ${b.orderDate}</td>` : ''}
      </tr>
    </table>` : ''}

    <!-- ── Items table ── -->
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

    <!-- ── Signature blocks ── -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
      <tr valign="top">
        <td width="48%" style="padding-right:16px">
          ${sigBlock}
          <div style="border-bottom:1px solid #CBD5E1;margin-bottom:6px"></div>
          <div style="font-size:12px;color:#64748B">Vessel authorisation</div>
          <div style="font-size:11px;color:#94A3B8">Name, signature &amp; date</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="padding-left:16px">
          <div style="height:60px"></div>
          <div style="border-bottom:1px solid #CBD5E1;margin-bottom:6px"></div>
          <div style="font-size:12px;color:#64748B">Supplier acknowledgement</div>
          <div style="font-size:11px;color:#94A3B8">Name, signature &amp; date</div>
        </td>
      </tr>
    </table>

    <!-- ── Action note ── -->
    <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;padding:12px 14px;margin-bottom:24px">
      <p style="margin:0;font-size:12px;color:#9A3412">Please confirm receipt of the returned items by replying to this email.</p>
    </div>

  </td></tr>

  <!-- ── Footer ── -->
  <tr>
    <td style="background:#F8FAFC;padding:14px 28px;border-top:1px solid #E2E8F0">
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
