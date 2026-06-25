// Supabase Edge Function: send-sea-service-signature-request
//
// Emails an off-Cargo master a PUBLIC, no-login link to sign a seafarer's
// sea-service testimonial. Invoked from the crew dashboard after
// create_sea_service_sign_request mints the token. Unlike sendSeaTimeSubmission
// (which notifies on-Cargo COMMAND members in-app), this targets a single
// external master by email — they have no account, so the link is the whole
// flow: ${SITE_URL}/sea-service/sign/${token}.
//
// Env: RESEND_API_KEY, SITE_URL?
// Body: { token, captainEmail, captainName?, seafarerName?, vesselName?, dayCount? }

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

const NAVY = '#1C1B3A', CREAM_BG = '#F4F1EC', WHITE = '#FFFFFF', BORDER = '#E2DDD4';
const DARK_TEXT = '#1C1B3A', MUTED_TEXT = '#8B8478';
const SERIF = "'DM Serif Display', Georgia, serif";
const SANS = "'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif";

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderEmail({ seafarer, vessel, dayCount, captain, ctaUrl }: {
  seafarer: string; vessel: string; dayCount: number | null; captain: string; ctaUrl: string;
}): string {
  const days = dayCount != null ? ` (${dayCount} day${dayCount === 1 ? '' : 's'})` : '';
  const hi = captain ? `Capt. ${escapeHtml(captain)},` : 'Hello,';
  const intro = `<strong>${escapeHtml(seafarer)}</strong> has asked you to confirm the sea service they performed under your command${vessel ? ` aboard <strong>${escapeHtml(vessel)}</strong>` : ''}${days}.`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${CREAM_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:6px;">
        <tr><td style="height:6px;background:${NAVY};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:40px 44px;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:400;font-size:26px;line-height:1.2;color:${NAVY};">Sea-service sign-off</h1>
          <p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${hi}</p>
          <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${intro}</p>
          <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">No account is needed — review the days and sign on the secure page below.</p>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td>
            <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;background:${NAVY};color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">Review &amp; sign</a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED_TEXT};">Or paste this link into your browser:<br/>${escapeHtml(ctaUrl)}</p>
          <p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED_TEXT};">If you didn't expect this, you can ignore the email — nothing happens until you sign.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token, captainEmail, captainName, seafarerName, vesselName, dayCount } = await req.json();
    if (!token || !captainEmail) {
      return new Response(JSON.stringify({ error: 'token and captainEmail required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ctaUrl = `${SITE_URL}/sea-service/sign/${token}`;
    if (!RESEND_API_KEY) {
      console.warn('[send-sea-service-signature-request] RESEND_API_KEY missing — email skipped');
      return new Response(JSON.stringify({ ok: false, emailed: false, link: ctaUrl }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const html = renderEmail({
      seafarer: seafarerName || 'A seafarer', vessel: vesselName || '',
      dayCount: typeof dayCount === 'number' ? dayCount : null,
      captain: captainName ? String(captainName).replace('Capt. ', '') : '', ctaUrl,
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Cargo Sea Time <seatime@cargotechnology.co.uk>',
        to: [captainEmail],
        subject: `Sea-service sign-off${seafarerName ? ` — ${seafarerName}` : ''}`,
        html,
      }),
    });
    const rd = await res.json().catch(() => ({}));
    console.log('[send-sea-service-signature-request] Resend status', res.status, JSON.stringify(rd));
    return new Response(JSON.stringify({ ok: res.ok, emailed: res.ok, link: ctaUrl }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[send-sea-service-signature-request] error', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
