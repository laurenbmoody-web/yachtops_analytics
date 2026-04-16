// Supabase Edge Function: sendCrewInvite
//
// Sends a crew invitation email via Resend.
// Looks up the invite and vessel from Supabase, builds a branded HTML email,
// and updates crew_invites.email_sent_at on success or email_send_error on failure.
//
// Env vars required:
//   RESEND_API_KEY
//   SUPABASE_URL             (auto-injected by Supabase runtime)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase runtime)
//   SITE_URL                 (optional — defaults to https://cargotechnology.netlify.app)
//
// ⚠ SITE_URL flag: if not set in Supabase Edge Function secrets per environment,
//   invite links in preview/staging deploys will point to the production URL.

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const RESEND_API_KEY          = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE_URL                = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Supabase service-role REST helper ────────────────────────────────────────

async function sbFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init?.headers || {}),
    },
  });
}

// ── HTML email template ───────────────────────────────────────────────────────

function buildEmailHtml(params: {
  firstName: string;
  vesselName: string;
  departmentLabel: string;
  roleLabel: string;
  inviteLink: string;
}): string {
  const { firstName, vesselName, departmentLabel, roleLabel, inviteLink } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
<tr><td align="center">

  <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">

    <!-- Navy header -->
    <tr>
      <td style="background:#1E3A5F;padding:28px 32px">
        <div style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px">You've been invited to join Cargo</div>
        <div style="font-size:13px;color:#93C5FD;margin-top:6px">${vesselName}</div>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:32px 32px 24px">
        <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6">Hi ${firstName},</p>
        <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6">
          You've been invited to join <strong>${vesselName}</strong> on Cargo — the vessel's shared operational platform for inventory, crew information, and departmental workflows.
        </p>

        <!-- Role card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #E2E8F0;border-radius:8px">
          <tr>
            <td style="padding:16px 20px">
              <table width="100%" cellpadding="0" cellspacing="4">
                <tr>
                  <td width="50%" style="font-size:12px;color:#64748B">Department</td>
                  <td width="50%" style="font-size:12px;color:#64748B">Role</td>
                </tr>
                <tr>
                  <td style="font-size:14px;font-weight:600;color:#0F172A">${departmentLabel || '—'}</td>
                  <td style="font-size:14px;font-weight:600;color:#0F172A">${roleLabel || '—'}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- CTA button -->
        <table cellpadding="0" cellspacing="0" style="margin:24px 0">
          <tr>
            <td>
              <a href="${inviteLink}"
                 style="display:inline-block;padding:14px 32px;background:#1E3A5F;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
                Accept Invitation
              </a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 6px;font-size:13px;color:#64748B;line-height:1.5">
          Or copy this link into your browser:
        </p>
        <p style="margin:0;font-size:12px;color:#00A8CC;word-break:break-all">${inviteLink}</p>

        <p style="margin:24px 0 0;font-size:13px;color:#94A3B8;line-height:1.5">
          This invite expires in 14 days. If you have any questions, please contact the vessel directly.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:#F8FAFC;padding:14px 28px;border-top:1px solid #E2E8F0;border-radius:0 0 12px 12px">
        <p style="margin:0;font-size:11px;color:#94A3B8;text-align:center">
          This invitation was sent via Cargo (cargotechnology.app)
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
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase service role env vars not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { crewInviteId } = body;
  if (!crewInviteId) {
    return new Response(JSON.stringify({ error: 'Missing required field: crewInviteId' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1. Fetch crew invite (service-role bypasses RLS)
  const inviteRes = await sbFetch(
    `/crew_invites?id=eq.${crewInviteId}&select=email,invitee_name,department_label,role_label,token,tenant_id&limit=1`
  );
  if (!inviteRes.ok) {
    const errText = await inviteRes.text();
    console.error('[sendCrewInvite] crew_invites fetch failed', inviteRes.status, errText);
    return new Response(JSON.stringify({ error: 'Failed to fetch crew invite' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const invites: any[] = await inviteRes.json();
  const invite = invites?.[0];
  if (!invite) {
    return new Response(JSON.stringify({ error: 'Crew invite not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Fetch vessel name
  let vesselName = '';
  const tenantRes = await sbFetch(`/tenants?id=eq.${invite.tenant_id}&select=name&limit=1`);
  if (tenantRes.ok) {
    const tenants: any[] = await tenantRes.json();
    vesselName = tenants?.[0]?.name || '';
  }

  // 3. Build invite URL and derive first name
  const inviteLink = `${SITE_URL}/invite-accept?token=${invite.token}`;
  const firstName = invite.invitee_name?.trim()?.split(' ')?.[0]
    || invite.email?.split('@')?.[0]
    || 'there';

  const html = buildEmailHtml({
    firstName,
    vesselName: vesselName || 'your vessel',
    departmentLabel: invite.department_label || '',
    roleLabel: invite.role_label || '',
    inviteLink,
  });

  // 4. Send via Resend
  const subject = `You've been invited to join ${vesselName || 'your vessel'} on Cargo`;
  console.log('[sendCrewInvite] Sending to:', invite.email, '| vessel:', vesselName);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Cargo <crew@cargotechnology.co.uk>',
      to: [invite.email],
      subject,
      html,
    }),
  });

  const resendData = await resendRes.json();
  console.log('[sendCrewInvite] Resend response:', resendRes.status, JSON.stringify(resendData));

  // 5. Update crew_invites with send result
  if (resendRes.ok) {
    await sbFetch(`/crew_invites?id=eq.${crewInviteId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        email_sent_at: new Date().toISOString(),
        email_send_error: null,
      }),
    });
    return new Response(JSON.stringify({ success: true, id: resendData?.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } else {
    const errMsg: string = resendData?.message || `Resend error ${resendRes.status}`;
    await sbFetch(`/crew_invites?id=eq.${crewInviteId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ email_send_error: errMsg }),
    });
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
