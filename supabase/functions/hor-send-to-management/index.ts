// Supabase Edge Function: hor-send-to-management
//
// Emails a vessel's monthly Record of Hours of Rest (PDF + CSV, generated in the
// browser by the SAME code the rota export uses) to the management company held
// in vessel settings. The function does NOT generate the documents — it receives
// them as base64 attachments and forwards them by email — so the management pack
// is a byte-for-byte duplicate of the on-screen rota export.
//
// Authorisation: the caller's JWT must belong to an active COMMAND or CHIEF
// member of the target tenant. The recipient address is read server-side from
// vessels.hor_management_company_email (never trusted from the client).
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Body: { tenantId, periodLabel, attachments: [{ filename, contentBase64, contentType? }] }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const FROM = 'Cargo Hours of Rest <hor@cargotechnology.co.uk>';
const ALLOWED_TIERS = new Set(['COMMAND', 'CHIEF']);

const NAVY = '#1C1B3A';
const CREAM_BG = '#F4F1EC';
const WHITE = '#FFFFFF';
const BORDER = '#E2DDD4';
const DARK_TEXT = '#1C1B3A';
const MUTED_TEXT = '#8B8478';
const SERIF = "'DM Serif Display', Georgia, serif";
const SANS = "'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif";

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderEmail({ intro, senderName, identityLine }: { intro: string; senderName: string; identityLine: string }): string {
  const signoff = senderName
    ? `<p style="margin:22px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">Kind regards,</p>
          <p style="margin:6px 0 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${DARK_TEXT};"><strong style="color:${NAVY};">${escapeHtml(senderName)}</strong>${identityLine ? `<br/><span style="color:${MUTED_TEXT};">${escapeHtml(identityLine)}</span>` : ''}</p>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${CREAM_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:6px;">
        <tr><td style="height:6px;background:${NAVY};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:40px 44px;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:400;font-size:26px;line-height:1.2;color:${NAVY};">Record of Hours of Rest</h1>
          <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${intro}</p>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;background:${CREAM_BG};border:1px solid ${BORDER};border-radius:6px;"><tr><td style="padding:14px 18px;font-family:${SANS};font-size:13px;line-height:1.7;color:${DARK_TEXT};">
            <strong style="color:${NAVY};">Attached</strong><br/>
            &bull;&nbsp; Record of Hours of Rest — signed PDF<br/>
            &bull;&nbsp; Hours of rest — CSV data export
          </td></tr></table>
          ${signoff}
          <p style="margin:24px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED_TEXT};">Sent via Cargo. If you have any queries about this record, simply reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function supaGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supaInsert(table: string, rows: unknown[]) {
  if (!rows.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  }).catch(() => {});
}

// Resolve the caller's user id from their JWT.
async function callerUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.id || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Not configured' }, 500);

  let body: {
    tenantId?: string;
    periodLabel?: string;
    attachments?: { filename: string; contentBase64: string; contentType?: string }[];
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { tenantId, periodLabel } = body;
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!tenantId) return json({ error: 'tenantId is required' }, 400);
  if (!attachments.length) return json({ error: 'No attachments to send' }, 400);

  // ── Authorise: active COMMAND/CHIEF of this tenant ──
  const uid = await callerUserId(req);
  if (!uid) return json({ error: 'Not authenticated' }, 401);
  const members = await supaGet(
    `tenant_members?tenant_id=eq.${tenantId}&user_id=eq.${uid}&active=eq.true`
    + `&select=permission_tier,display_name,role:roles!role_id(name),custom_role:tenant_custom_roles!custom_role_id(name)`,
  ) || [];
  const member = members[0];
  const tier = member?.permission_tier;
  if (!tier || !ALLOWED_TIERS.has(String(tier).toUpperCase())) {
    return json({ error: 'Not permitted — command or chief only' }, 403);
  }

  // ── Sender identity (for the sign-off + reply-to) ──
  const profiles = await supaGet(`profiles?id=eq.${uid}&select=email,full_name`) || [];
  const profile = profiles[0] || {};
  let senderEmail = profile.email || '';
  if (!senderEmail) {
    const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    }).catch(() => null);
    if (adminRes && adminRes.ok) senderEmail = (await adminRes.json().catch(() => ({})))?.email || '';
  }
  const senderName = member?.display_name || profile.full_name || '';
  const senderRole = member?.role?.name || member?.custom_role?.name || '';

  // ── Recipient (server-side, from vessel settings) ──
  const vessels = await supaGet(
    `vessels?tenant_id=eq.${tenantId}&select=name,hor_management_company_email,hor_management_company_name`,
  ) || [];
  const vessel = vessels[0] || {};
  const to = vessel.hor_management_company_email;
  if (!to) return json({ error: 'No management company email set in vessel settings' }, 400);
  const vesselName = vessel.name || 'the vessel';
  const recipientName = vessel.hor_management_company_name || '';

  if (!RESEND_API_KEY) return json({ error: 'Email not configured' }, 500);

  const period = periodLabel || 'this month';
  const subject = `Record of Hours of Rest — ${vesselName} — ${period}`;
  const greeting = recipientName ? `${escapeHtml(recipientName)}, ` : '';
  const intro = `${greeting}attached is the Record of Hours of Rest for <strong>${escapeHtml(vesselName)}</strong> `
    + `covering <strong>${escapeHtml(period)}</strong> (MLC 2006 A2.3 / STCW A-VIII/1).`;
  // "Captain | M/Y Belongers" — role and vessel under the sender's name.
  const identityLine = [senderRole, vesselName].filter(Boolean).join('  |  ');
  const signoffText = senderName
    ? `\n\nKind regards,\n${senderName}${identityLine ? `\n${identityLine}` : ''}`
    : '';
  const text = `${recipientName ? `${recipientName}, ` : ''}attached is the Record of Hours of Rest for ${vesselName} `
    + `covering ${period} (MLC 2006 A2.3 / STCW A-VIII/1).\n\n`
    + `Attached:\n  - Record of Hours of Rest — signed PDF\n  - Hours of rest — CSV data export`
    + `${signoffText}\n\nSent via Cargo. If you have any queries about this record, simply reply to this email.`;

  const payload: Record<string, unknown> = {
    from: FROM,
    to: [to],
    subject,
    html: renderEmail({ intro, senderName, identityLine }),
    text,
    attachments: attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
  };
  // Replies go to whoever sent it (captain / purser / etc.), not the no-reply sender.
  if (senderEmail) payload.reply_to = senderEmail;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => { console.error('[hor-send-to-management] resend fetch failed', e); return null; });

  if (!resendRes || !resendRes.ok) {
    const detail = resendRes ? await resendRes.text().catch(() => '') : 'network error';
    console.error('[hor-send-to-management] Resend error', resendRes?.status, detail);
    return json({ error: 'Email provider rejected the message' }, 502);
  }

  // Courtesy bell notification to the sender (best-effort).
  await supaInsert('notifications', [{
    user_id: uid,
    type: 'HOR_SENT_TO_MANAGEMENT',
    title: 'Hours of Rest sent to management',
    message: `The Record of Hours of Rest for ${vesselName} (${period}) was emailed to ${to}.`,
    severity: 'info',
    action_url: '/month-end',
    read: false,
    created_at: new Date().toISOString(),
  }]);

  return json({ ok: true, to });
});
