// Supabase Edge Function: notify-seatime-signoff
//
// Notifies the SEAFARER when a master signs or declines their sea service —
// both the in-app bell (a notifications row) and a courtesy email. Called from:
//   • the public sign page (SeaServiceSignPage) after sign/decline → { action, token }
//   • the in-app reviews queue after sign/decline               → { action, entryIds }
//
// The recipient + details are derived SERVER-SIDE (from the token's request or
// the entries) — never from client-supplied addresses — so although this runs
// with verify_jwt disabled (the public master has no session), it can only ever
// notify the seafarer who actually owns the service. Best-effort, like the
// submit-side notifier.
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL?
// Body: { action: 'signed'|'declined', token?: string, entryIds?: string[] }

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
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';

const NAVY = '#1C1B3A', CREAM_BG = '#F4F1EC', WHITE = '#FFFFFF', BORDER = '#E2DDD4';
const DARK_TEXT = '#1C1B3A', MUTED_TEXT = '#8B8478', TERRA = '#C65A1A';
const SERIF = "'DM Serif Display', Georgia, serif";
const SANS = "'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif";

const esc = (s: string) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function supaGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supaInsert(table: string, row: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  }).catch(() => {});
}

async function resolveEmail(userId: string): Promise<string> {
  const profs = await supaGet(`profiles?id=eq.${userId}&select=email`) as { email: string }[] | null;
  let email = profs?.[0]?.email || '';
  if (!email) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => null);
    if (res && res.ok) { const u = await res.json().catch(() => null); email = u?.email || ''; }
  }
  return email;
}

function renderEmail({ name, action, vessel, master, days }: {
  name: string; action: 'signed' | 'declined'; vessel: string; master: string; days: number | null;
}): string {
  const d = days != null ? ` (${days} day${days === 1 ? '' : 's'})` : '';
  const signed = action === 'signed';
  const heading = signed ? 'Your sea service was signed' : 'Your sea service was declined';
  const accent = signed ? '#3F7A52' : TERRA;
  const body = signed
    ? `<strong>${esc(master)}</strong> has signed your sea service${vessel ? ` on <strong>${esc(vessel)}</strong>` : ''}${d}. It's now verified and counts towards your pack.`
    : `<strong>${esc(master)}</strong> has declined your sea service${vessel ? ` on <strong>${esc(vessel)}</strong>` : ''}${d}. The days have been returned to you as draft — review and resubmit.`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${CREAM_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:6px;">
        <tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:40px 44px;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:400;font-size:26px;line-height:1.2;color:${NAVY};">${heading}</h1>
          <p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${name ? `${esc(name)},` : 'Hello,'}</p>
          <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${body}</p>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td>
            <a href="${esc(SITE_URL)}/my-profile" style="display:inline-block;padding:13px 26px;background:${NAVY};color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">View your sea service</a>
          </td></tr></table>
          <p style="margin:28px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED_TEXT};">You're receiving this because you requested this sea-service sign-off in Cargo.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { action, token, entryIds } = await req.json();
    if (action !== 'signed' && action !== 'declined') {
      return new Response(JSON.stringify({ error: 'invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let seafarerId = '', seafarerName = '', vessel = '', master = '';
    let days: number | null = null;

    if (token) {
      const reqs = await supaGet(`sea_service_sign_requests?token=eq.${encodeURIComponent(token)}&select=seafarer_user_id,seafarer_name,vessel_name,captain_name,signed_name,row_ids`) as Array<Record<string, unknown>> | null;
      const r = reqs?.[0];
      if (!r) return new Response(JSON.stringify({ error: 'request not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      seafarerId = String(r.seafarer_user_id || '');
      seafarerName = String(r.seafarer_name || '');
      vessel = String(r.vessel_name || '');
      master = String(r.signed_name || r.captain_name || 'The captain');
      days = Array.isArray(r.row_ids) ? r.row_ids.length : null;
    } else if (Array.isArray(entryIds) && entryIds.length) {
      const ids = entryIds.map((x: string) => String(x)).filter(Boolean);
      const rows = await supaGet(`sea_service_entries?id=in.(${ids.join(',')})&select=user_id,vessel_name,master_name,signed_name`) as Array<Record<string, unknown>> | null;
      const r = rows?.[0];
      if (!r) return new Response(JSON.stringify({ error: 'entries not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      seafarerId = String(r.user_id || '');
      vessel = String(r.vessel_name || '');
      master = String(r.signed_name || r.master_name || 'The captain');
      days = ids.length;
      const profs = await supaGet(`profiles?id=eq.${seafarerId}&select=full_name`) as { full_name: string }[] | null;
      seafarerName = profs?.[0]?.full_name || '';
    } else {
      return new Response(JSON.stringify({ error: 'token or entryIds required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!seafarerId) return new Response(JSON.stringify({ error: 'no seafarer' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const d = days != null ? ` (${days} day${days === 1 ? '' : 's'})` : '';
    const title = action === 'signed' ? 'Sea service signed' : 'Sea service declined';
    const message = action === 'signed'
      ? `${master} signed your sea service${vessel ? ` on ${vessel}` : ''}${d}.`
      : `${master} declined your sea service${vessel ? ` on ${vessel}` : ''}${d} — returned to draft.`;

    // (1) Bell — a notifications row for the seafarer.
    await supaInsert('notifications', {
      user_id: seafarerId, type: 'sea_time', severity: 'info',
      title, message, action_url: '/my-profile', read: false, created_at: new Date().toISOString(),
    });

    // (2) Courtesy email (best-effort).
    if (RESEND_API_KEY) {
      const email = await resolveEmail(seafarerId);
      if (email) {
        const html = renderEmail({ name: seafarerName, action, vessel, master, days });
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Cargo Sea Time <seatime@cargotechnology.co.uk>',
            to: [email], subject: `${title}${vessel ? ` — ${vessel}` : ''}`, html,
          }),
        });
        console.log('[notify-seatime-signoff] Resend', res.status);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[notify-seatime-signoff] error', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
