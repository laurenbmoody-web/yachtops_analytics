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

// ── Email templates ───────────────────────────────────────────────────────────

interface EmailParams {
  firstName: string;
  vesselName: string;
  department: string;
  role: string;
  inviteUrl: string;
}

function buildEmailHtml({ firstName, vesselName, department, role, inviteUrl }: EmailParams): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to ${vesselName}</title>
</head>
<body style="margin:0; padding:0; background:#F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.06);">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px; border-bottom:1px solid #E2E8F0;">
              <div style="font-size:22px; font-weight:900; letter-spacing:-0.02em; color:#1E3A5F;">Cargo</div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:40px 40px 8px;">
              <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#64748B; font-weight:700; margin-bottom:10px;">You're joining the crew</div>
              <div style="font-size:28px; font-weight:900; letter-spacing:-0.01em; color:#1E3A5F; line-height:1.2;">${vesselName}</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 40px 8px; font-size:15px; line-height:1.6; color:#334155;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              <p style="margin:0 0 16px;">You've been invited to join <strong>${vesselName}</strong> on Cargo — the operational platform the vessel uses for inventory, crew, and day-to-day ops.</p>
              <p style="margin:0;">Here's what's waiting for you:</p>
            </td>
          </tr>

          <!-- Role card -->
          <tr>
            <td style="padding:16px 40px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F9FF; border:1px solid #BAE6FD; border-radius:10px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <div style="font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:#64748B; font-weight:700; margin-bottom:4px;">Department</div>
                    <div style="font-size:16px; font-weight:800; color:#1E3A5F; margin-bottom:14px;">${department || '—'}</div>
                    <div style="font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:#64748B; font-weight:700; margin-bottom:4px;">Role</div>
                    <div style="font-size:16px; font-weight:800; color:#1E3A5F;">${role || '—'}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:32px 40px 12px;">
              <a href="${inviteUrl}" style="display:inline-block; background:#1E3A5F; color:#FFFFFF; font-size:15px; font-weight:800; text-decoration:none; padding:14px 32px; border-radius:8px; letter-spacing:0.01em;">Accept invitation →</a>
            </td>
          </tr>

          <!-- Fine print -->
          <tr>
            <td style="padding:0 40px 32px; font-size:12px; color:#94A3B8; line-height:1.6;">
              <p style="margin:0 0 8px;">This link is unique to you and expires in 30 days.</p>
              <p style="margin:0;">Can't click the button? Copy and paste this URL into your browser:<br>
                <a href="${inviteUrl}" style="color:#00A8CC; word-break:break-all;">${inviteUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px; border-top:1px solid #E2E8F0; background:#F8FAFC; font-size:12px; color:#64748B;">
              <div style="font-weight:800; color:#1E3A5F; margin-bottom:4px;">Cargo</div>
              <div>The operational platform for yachts. <a href="https://cargotechnology.co.uk" style="color:#00A8CC; text-decoration:none;">cargotechnology.co.uk</a></div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText({ firstName, vesselName, department, role, inviteUrl }: EmailParams): string {
  return `You've been invited to join ${vesselName} on Cargo

Hi ${firstName},

You've been invited to join ${vesselName} on Cargo — the operational platform the vessel uses for inventory, crew, and day-to-day ops.

Department: ${department || '—'}
Role: ${role || '—'}

Accept your invitation here:
${inviteUrl}

This link is unique to you and expires in 30 days.

—
Cargo · cargotechnology.co.uk`;
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
    `/crew_invites?id=eq.${crewInviteId}&select=email,first_name,department_label,role_label,token,tenant_id&limit=1`
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

  // 3. Build invite URL and resolve first name
  const inviteUrl = `${SITE_URL}/invite-accept?token=${invite.token}`;
  const firstName: string = invite.first_name?.trim() || 'there';
  const department: string = invite.department_label || '';
  const role: string = invite.role_label || '';
  const vessel: string = vesselName || 'your vessel';

  const html = buildEmailHtml({ firstName, vesselName: vessel, department, role, inviteUrl });
  const text = buildEmailText({ firstName, vesselName: vessel, department, role, inviteUrl });

  // 4. Send via Resend
  const subject = `You've been invited to join ${vessel} on Cargo`;
  console.log('[sendCrewInvite] Sending to:', invite.email, '| vessel:', vessel);

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
      text,
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
