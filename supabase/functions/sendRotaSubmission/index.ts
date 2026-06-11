// Supabase Edge Function: sendRotaSubmission
//
// Fires when an HOD submits a rota for review (invoked fire-and-forget from
// the crew-rota footer after submit_rota_department succeeds). Notifies the
// people who'll actually see the item in their /reviews queue:
//   • active CHIEFs in the submitted department, OR
//   • if no chief covers that department, active COMMAND members (the
//     command-fallback reviewer rule — mirrors inboxScope.js / the RLS).
// The submitter is never notified (guards the HOD-is-also-chief edge case).
//
// Does BOTH server-side with the service role (so it bypasses RLS for the
// tenant_members read and the cross-tenant notification inserts):
//   1. Inserts a DB notification per recipient → the nav bell, any device.
//   2. Sends one Resend email to all recipient addresses (a courtesy).
// The bell write happens FIRST and the email is best-effort, so a Resend
// outage never costs the in-app notification.
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL?
// Body: { reviewItemId: uuid }

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
const SITE_URL                  = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';

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

function renderEmail({ dept, rotaName, submitter, shiftCount, ctaUrl }: {
  dept: string; rotaName: string; submitter: string; shiftCount: number | null; ctaUrl: string;
}): string {
  const shifts = shiftCount != null ? ` (${shiftCount} shift${shiftCount === 1 ? '' : 's'})` : '';
  const intro = `<strong>${escapeHtml(submitter)}</strong> submitted the <strong>${escapeHtml(dept)}</strong> rota${rotaName ? ` for <strong>${escapeHtml(rotaName)}</strong>` : ''}${shifts} for your approval.`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${CREAM_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:6px;">
        <tr><td style="height:6px;background:${NAVY};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:40px 44px;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:400;font-size:26px;line-height:1.2;color:${NAVY};">New rota to review</h1>
          <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${intro}</p>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td>
            <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;background:${NAVY};color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">Review now</a>
          </td></tr></table>
          <p style="margin:28px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED_TEXT};">You're receiving this because rota submissions for this department route to you for approval in Cargo.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { reviewItemId?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { reviewItemId } = body;
  if (!reviewItemId) {
    return new Response(JSON.stringify({ error: 'reviewItemId is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const items = await supaGet(`review_items?id=eq.${reviewItemId}&select=tenant_id,assignee_department_id,submitter_id,source_context&limit=1`);
    const item = items && items[0];
    if (!item?.tenant_id) {
      return new Response(JSON.stringify({ ok: true, noop: 'no item' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ctx = item.source_context || {};
    const deptId = item.assignee_department_id;

    // Recipients: active CHIEFs in the dept; if none, active COMMAND in tenant
    // (mirrors the command-fallback reviewer rule). Exclude the submitter.
    let members = await supaGet(
      `tenant_members?tenant_id=eq.${item.tenant_id}&department_id=eq.${deptId}&permission_tier=eq.CHIEF&active=eq.true&select=user_id`,
    ) || [];
    if (!members.length) {
      members = await supaGet(
        `tenant_members?tenant_id=eq.${item.tenant_id}&permission_tier=eq.COMMAND&active=eq.true&select=user_id`,
      ) || [];
    }
    const recipientIds = [...new Set(
      members.map((m: { user_id: string }) => m.user_id).filter((id: string) => id && id !== item.submitter_id),
    )] as string[];

    if (!recipientIds.length) {
      return new Response(JSON.stringify({ ok: true, noop: 'no recipients' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const submitter = ctx.submitter_name || 'A department head';
    const dept = ctx.department_name || 'a department';
    const rotaName = ctx.rota_name || '';
    const shiftCount = typeof ctx.shift_count === 'number' ? ctx.shift_count : null;
    const shifts = shiftCount != null ? ` (${shiftCount} shift${shiftCount === 1 ? '' : 's'})` : '';
    const now = new Date().toISOString();

    // (1) Bell notifications — written first so the in-app alert is guaranteed.
    await supaInsert('notifications', recipientIds.map((uid) => ({
      user_id: uid,
      type: 'ROTA_SUBMITTED',
      title: 'New rota to review',
      message: `${submitter} submitted the ${dept} rota${rotaName ? ` for ${rotaName}` : ''}${shifts} for approval.`,
      severity: 'info',
      action_url: '/reviews',
      read: false,
      created_at: now,
    })));

    // (2) Courtesy email to all recipients (best-effort).
    if (RESEND_API_KEY) {
      const profiles = await supaGet(
        `profiles?id=in.(${recipientIds.join(',')})&select=email`,
      ) || [];
      const emails = [...new Set(
        profiles.map((p: { email: string }) => p.email).filter(Boolean),
      )] as string[];
      if (emails.length) {
        const html = renderEmail({
          dept, rotaName, submitter, shiftCount, ctaUrl: `${SITE_URL}/reviews`,
        });
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Cargo Rotas <rotas@cargotechnology.co.uk>',
            to: emails,
            subject: `New rota to review — ${dept}`,
            html,
          }),
        });
        if (!resendRes.ok) {
          const d = await resendRes.json().catch(() => ({}));
          console.warn('[sendRotaSubmission] Resend error', resendRes.status, JSON.stringify(d));
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, notified: recipientIds.length }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sendRotaSubmission] error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
