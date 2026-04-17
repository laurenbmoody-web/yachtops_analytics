// Supabase Edge Function: sendSupplierOrder
//
// Builds a professional HTML order-request email and sends it via Resend.
// Includes a confirmation link so the supplier can confirm/amend the order online.
//
// Env vars required:
//   RESEND_API_KEY
//   SITE_URL  (e.g. https://app.cargotechnology.co.uk)

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
const SITE_URL = Deno.env.get('SITE_URL') || 'https://app.cargotechnology.co.uk';

// ── HTML email builder ────────────────────────────────────────────────────────

function infoRow(label: string, value: string): string {
  if (!value) return '';
  return `<tr>
    <td style="padding:4px 12px 4px 0;font-size:13px;color:#64748B;white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:4px 0;font-size:13px;color:#0F172A;vertical-align:top">${value}</td>
  </tr>`;
}

function itemRow(item: any, index: number): string {
  const bg = index % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
  return `<tr style="background:${bg}">
    <td style="padding:8px 12px;font-size:13px;color:#0F172A;border-bottom:1px solid #E2E8F0">${item.name || item.item_name || '—'}</td>
    <td style="padding:8px 12px;font-size:13px;color:#0F172A;text-align:center;border-bottom:1px solid #E2E8F0">${item.quantity ?? item.qty ?? '—'}</td>
    <td style="padding:8px 12px;font-size:13px;color:#64748B;border-bottom:1px solid #E2E8F0">${item.unit || '—'}</td>
    <td style="padding:8px 12px;font-size:13px;color:#64748B;border-bottom:1px solid #E2E8F0">${item.notes || ''}</td>
  </tr>`;
}

function buildEmailHtml(b: any): string {
  const confirmUrl = `${SITE_URL}/order/confirm/${b.publicToken}`;
  const items: any[] = b.items || [];

  const deliveryRows = [
    infoRow('Port / Location', b.deliveryPort),
    infoRow('Date', b.deliveryDate),
    infoRow('Time', b.deliveryTime),
    infoRow('Contact', b.deliveryContact),
  ].filter(Boolean).join('');

  const specialBlock = b.specialInstructions ? `
    <div style="margin:24px 0;padding:12px 16px;background:#FFFBEB;border-left:4px solid #F59E0B;border-radius:4px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#92400E;text-transform:uppercase;letter-spacing:.05em">Special Instructions</p>
      <p style="margin:0;font-size:13px;color:#78350F;line-height:1.5">${b.specialInstructions}</p>
    </div>` : '';

  const itemsTable = items.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;margin-top:8px">
      <thead>
        <tr style="background:#0F172A">
          <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#94A3B8;text-align:left;text-transform:uppercase;letter-spacing:.05em">Item</th>
          <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#94A3B8;text-align:center;text-transform:uppercase;letter-spacing:.05em">Qty</th>
          <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#94A3B8;text-align:left;text-transform:uppercase;letter-spacing:.05em">Unit</th>
          <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#94A3B8;text-align:left;text-transform:uppercase;letter-spacing:.05em">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, i) => itemRow(item, i)).join('')}
      </tbody>
    </table>` : '<p style="color:#64748B;font-size:13px">No items included.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order Request</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

  <!-- Header -->
  <tr>
    <td style="background:#0F172A;padding:28px 32px">
      <p style="margin:0;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.08em">Order Request</p>
      <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;color:#FFFFFF">${b.vesselName || 'Vessel Order'}</h1>
      ${b.orderRef ? `<p style="margin:4px 0 0;font-size:13px;color:#64748B">${b.orderRef}</p>` : ''}
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px">

      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6">
        Dear ${b.supplierName || 'Supplier'},<br><br>
        Please find below our order request. Kindly confirm availability and pricing at your earliest convenience.
      </p>

      <!-- Delivery details -->
      ${deliveryRows ? `
      <div style="padding:16px;background:#F0FDFA;border-left:4px solid #0D9488;border-radius:4px;margin-bottom:24px">
        <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#0F766E;text-transform:uppercase;letter-spacing:.05em">Delivery Details</p>
        <table cellpadding="0" cellspacing="0">
          ${deliveryRows}
        </table>
      </div>` : ''}

      ${specialBlock}

      <!-- Items -->
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;letter-spacing:.05em">Order Items (${items.length})</p>
      ${itemsTable}

      <!-- CTA -->
      <div style="text-align:center;margin:32px 0 8px">
        <a href="${confirmUrl}"
           style="display:inline-block;padding:14px 32px;background:#0D9488;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:.01em">
          Confirm Order Online
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#94A3B8">
          Or copy this link: <a href="${confirmUrl}" style="color:#0D9488">${confirmUrl}</a>
        </p>
      </div>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0">
      <p style="margin:0;font-size:11px;color:#94A3B8;text-align:center">
        This order was sent via <strong style="color:#64748B">Cargo Technology</strong> — yacht provisioning &amp; logistics platform.<br>
        Questions? Reply to this email and we'll get back to you.
      </p>
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
  if (!body.publicToken) {
    return new Response(JSON.stringify({ error: 'Missing required field: publicToken' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const subject = [
    'Order Request',
    body.vesselName || 'Vessel',
    body.deliveryPort || null,
    body.deliveryDate || null,
  ].filter(Boolean).join(' — ');

  console.log('[sendSupplierOrder] Sending to:', body.to, '| subject:', subject, '| items:', body.items?.length);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Cargo Orders <orders@cargotechnology.co.uk>',
      to:      [body.to],
      subject,
      html:    buildEmailHtml(body),
      ...(body.replyTo ? { reply_to: body.replyTo } : {}),
    }),
  });

  const resendData = await resendRes.json();
  console.log('[sendSupplierOrder] Resend response:', resendRes.status, JSON.stringify(resendData));

  if (!resendRes.ok) {
    return new Response(JSON.stringify({ error: resendData?.message || `Resend error ${resendRes.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, id: resendData?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
