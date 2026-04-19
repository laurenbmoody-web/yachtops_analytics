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
const SITE_URL = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const LOGO_BEIGE = 'https://cargotechnology.netlify.app/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg';
const LOGO_NAVY  = 'https://cargotechnology.netlify.app/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg';

// ── HTML email builder ────────────────────────────────────────────────────────

function buildEmailHtml(b: any): string {
  const items: any[] = b.items || [];

  const currSymbol = b.currency === 'GBP' ? '£' : b.currency === 'USD' ? '$' : b.currency === 'EUR' ? '€' : (b.currency || '') + ' ';
  const fmtPrice = (v: any) => {
    const n = parseFloat(v);
    return isNaN(n) ? '—' : `${currSymbol}${n.toFixed(2)}`;
  };

  const hasPrices = items.some((i: any) => i.estimatedPrice != null && i.estimatedPrice !== '');
  const totalEstimated = items.reduce((sum: number, i: any) =>
    sum + ((parseFloat(i.estimatedPrice) || 0) * (parseFloat(i.quantity) || 0)), 0);

  const itemRows = items.map((i: any) => `
    <tr>
      <td style="padding:10px 14px;font-size:13px;color:#0F172A;border-bottom:1px solid #F1F5F9">${i.name || i.item_name || '—'}</td>
      <td style="padding:10px 14px;font-size:13px;color:#0F172A;text-align:center;border-bottom:1px solid #F1F5F9">${i.quantity ?? i.qty ?? '—'}</td>
      <td style="padding:10px 14px;font-size:13px;color:#64748B;border-bottom:1px solid #F1F5F9">${i.unit || '—'}</td>
      ${hasPrices ? `<td style="padding:10px 14px;font-size:13px;color:#0F172A;text-align:right;border-bottom:1px solid #F1F5F9">${(i.estimatedPrice != null && i.estimatedPrice !== '') ? fmtPrice(i.estimatedPrice) : '—'}</td>` : ''}
    </tr>
  `).join('');

  const totalRow = (hasPrices && totalEstimated > 0) ? `
    <tr style="background:#F8FAFC">
      <td colspan="${hasPrices ? 3 : 2}" style="padding:12px 14px;font-size:13px;font-weight:700;color:#0F172A;text-align:right;border-top:2px solid #E2E8F0">Estimated Total</td>
      <td style="padding:12px 14px;font-size:14px;font-weight:700;color:#0F172A;text-align:right;border-top:2px solid #E2E8F0">${fmtPrice(totalEstimated)}</td>
    </tr>` : '';

  const specialBlock = b.specialInstructions ? `
    <div style="background:#FEF3C7;border-radius:8px;padding:14px 18px;margin-bottom:28px;border:1px solid #FDE68A">
      <div style="font-size:11px;font-weight:600;color:#92400E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Special Instructions</div>
      <p style="font-size:13px;color:#78350F;line-height:1.5;margin:0">${b.specialInstructions}</p>
    </div>` : '';

  const itemCount = items.length;
  const confirmUrl = `${SITE_URL}/order/confirm/${b.publicToken}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">

    <!-- Navy header -->
    <tr><td style="background:#1E3A5F;padding:28px 32px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td><img src="${LOGO_BEIGE}" alt="Cargo" style="height:28px;display:block" /></td>
          <td align="right" style="vertical-align:bottom">
            <div style="font-size:11px;color:#93C5FD;text-transform:uppercase;letter-spacing:1.5px;font-weight:600">Provisioning Order</div>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- Body -->
    <tr><td style="padding:32px">
      <p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 20px">
        Hi ${b.supplierName || 'there'},
      </p>
      <p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 28px">
        You have a new provisioning order from <strong>${b.vesselTypeLabel ? `${b.vesselTypeLabel} ` : ''}${b.vesselName || 'the vessel'}</strong>. Please review the details below and confirm availability.
      </p>

      <!-- Delivery details card -->
      <div style="background:#F8FAFC;border-left:4px solid #00A8CC;border-radius:0 8px 8px 0;padding:20px 24px;margin-bottom:28px">
        <div style="font-size:11px;font-weight:600;color:#00A8CC;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:14px">Delivery Details</div>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="50%" style="padding:4px 0;font-size:13px;color:#334155;vertical-align:top">
              <span style="color:#94A3B8;font-size:12px">Port</span><br><strong>${b.deliveryPort || '—'}</strong>
            </td>
            <td width="50%" style="padding:4px 0;font-size:13px;color:#334155;vertical-align:top">
              <span style="color:#94A3B8;font-size:12px">Date</span><br><strong>${b.deliveryDate || '—'}</strong>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0 0;font-size:13px;color:#334155;vertical-align:top">
              <span style="color:#94A3B8;font-size:12px">Time</span><br><strong>${b.deliveryTime || '—'}</strong>
            </td>
            <td style="padding:8px 0 0;font-size:13px;color:#334155;vertical-align:top">
              <span style="color:#94A3B8;font-size:12px">Contact on Board</span><br><strong>${b.deliveryContact || '—'}</strong>
            </td>
          </tr>
        </table>
      </div>

      ${specialBlock}

      <!-- Items table -->
      <div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px">Order Items</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-bottom:8px">
        <tr>
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:#475569;background:#F8FAFC;border-bottom:2px solid #E2E8F0">Item</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;color:#475569;background:#F8FAFC;border-bottom:2px solid #E2E8F0">Qty</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:#475569;background:#F8FAFC;border-bottom:2px solid #E2E8F0">Unit</th>
          ${hasPrices ? `<th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:600;color:#475569;background:#F8FAFC;border-bottom:2px solid #E2E8F0">Est. Price</th>` : ''}
        </tr>
        ${itemRows}
        ${totalRow}
      </table>
      <p style="font-size:11px;color:#94A3B8;margin-bottom:28px">${itemCount} item${itemCount !== 1 ? 's' : ''}${hasPrices ? ' · Prices are estimates and may be adjusted when you confirm.' : ''}</p>

      <!-- CTA Button -->
      <div style="text-align:center;margin-bottom:28px">
        <a href="${confirmUrl}" style="display:inline-block;padding:16px 48px;background:#00A8CC;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.2px">
          View &amp; Confirm Order
        </a>
        <p style="font-size:12px;color:#94A3B8;margin-top:10px">No account needed — confirm directly from the link above</p>
      </div>

      <div style="border-top:1px solid #E2E8F0;margin-bottom:20px"></div>

      <p style="font-size:13px;color:#64748B;line-height:1.6;margin:0">
        If you have any questions about this order, reply to this email — it will go directly to <strong style="color:#334155">${b.senderName || 'the crew'}</strong> on board ${b.vesselName || 'the vessel'}.
      </p>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td><img src="${LOGO_NAVY}" alt="Cargo" style="height:16px;display:block;opacity:0.4" /></td>
          <td align="right"><span style="font-size:11px;color:#94A3B8">Provisioning management for superyachts</span></td>
        </tr>
      </table>
    </td></tr>

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

  // Normalize vessel type to M/Y or S/Y regardless of how it's stored in the DB.
  const rawVesselType  = (body.vesselTypeLabel || '').toLowerCase().trim();
  const vesselTypeAbbr = rawVesselType.includes('sail') ? 'S/Y' : 'M/Y';
  body.vesselTypeLabel = vesselTypeAbbr; // propagate normalized value to email body

  const vesselName  = body.vesselName || 'Vessel';
  const fullVessel  = `${vesselTypeAbbr} ${vesselName}`;
  const datePart      = body.deliveryDate ? `delivery ${body.deliveryDate}` : null;
  const portPart      = body.deliveryPort ? `at ${body.deliveryPort}` : null;
  const subject       = ['New order from ' + fullVessel, datePart, portPart].filter(Boolean).join(' — ');

  console.log('[sendSupplierOrder] Sending to:', body.to, '| subject:', subject, '| items:', body.items?.length);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:     'Cargo Orders <orders@cargotechnology.co.uk>',
      to:       [body.to],
      subject,
      html:     buildEmailHtml(body),
      // reply_to goes to the crew member who sent the order, not a Cargo address
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
