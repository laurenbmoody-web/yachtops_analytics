// Supabase Edge Function: sendRotaDecision
//
// Emails the HOD who submitted a rota for review a quick overview of the
// reviewer's decision (accepted / accepted with edits / rejected). Fired
// fire-and-forget from /reviews after the decision RPC succeeds — failures
// here MUST NOT surface as a decision failure; the in-app (DB) notification
// is the guarantee, the email is a courtesy.
//
// Recipient resolution runs server-side with the service role (the reviewer
// can't read another member's email under RLS):
//   review_items.submitter_id → profiles.email (+ full_name).
//   If no email: log and return success-with-noop.
//
// Env vars required:
//   RESEND_API_KEY
//   SUPABASE_URL                 (auto-populated by the Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-populated)
//   SITE_URL                     (optional — defaults to the prod site)
//
// Request body:
//   { reviewItemId: uuid, decision: 'accepted'|'accepted_with_edits'|'rejected', note?: string }

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
const TERRACOTTA = '#C65A1A';
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

async function supaRest(path: string) {
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

const DECISION_COPY: Record<string, { headline: string; verb: string; tone: string }> = {
  accepted:            { headline: 'Your rota was accepted', verb: 'accepted and published', tone: NAVY },
  accepted_with_edits: { headline: 'Your rota was accepted with edits', verb: 'reviewed, edited and published', tone: NAVY },
  rejected:            { headline: 'Your rota was sent back', verb: 'sent back to draft', tone: TERRACOTTA },
};

function renderEmail({ headline, name, dept, rotaName, verb, note, ctaUrl, accent }: {
  headline: string; name: string; dept: string; rotaName: string; verb: string;
  note: string | null; ctaUrl: string; accent: string;
}): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  const intro = `Your <strong>${escapeHtml(dept)}</strong> submission${rotaName ? ` for <strong>${escapeHtml(rotaName)}</strong>` : ''} was ${escapeHtml(verb)} by the reviewer.`;
  const noteBlock = note
    ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:14px 16px;background:${CREAM_BG};border-left:3px solid ${accent};border-radius:4px;font-family:${SANS};font-size:14px;line-height:1.55;color:${DARK_TEXT};"><strong>Reviewer note:</strong> ${escapeHtml(note)}</td></tr></table>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${CREAM_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:6px;">
        <tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:40px 44px;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:400;font-size:26px;line-height:1.2;color:${NAVY};">${escapeHtml(headline)}</h1>
          <p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${greeting}</p>
          <p style="margin:0 0 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">${intro}</p>
          ${noteBlock}
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td>
            <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;background:${NAVY};color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">Open the rota</a>
          </td></tr></table>
          <p style="margin:28px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED_TEXT};">You're receiving this because you submitted a rota for review in Cargo.</p>
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

  let body: { reviewItemId?: string; decision?: string; note?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { reviewItemId, decision, note } = body;
  const copy = DECISION_COPY[decision || ''] || null;
  if (!reviewItemId || !copy) {
    return new Response(JSON.stringify({ error: 'reviewItemId and a valid decision are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Email not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const items = await supaRest(`review_items?id=eq.${reviewItemId}&select=submitter_id,source_context&limit=1`);
    const item = items && items[0];
    if (!item?.submitter_id) {
      return new Response(JSON.stringify({ ok: true, noop: 'no submitter' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ctx = item.source_context || {};
    const profiles = await supaRest(`profiles?id=eq.${item.submitter_id}&select=email,full_name&limit=1`);
    const profile = profiles && profiles[0];
    const email = profile?.email;
    if (!email) {
      return new Response(JSON.stringify({ ok: true, noop: 'no email' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const changed = decision === 'accepted_with_edits'
      ? `/crew?changed=${ctx.rota_id}:${ctx.department_id}` : '/crew';
    const html = renderEmail({
      headline: copy.headline,
      name: (profile?.full_name || '').split(' ')[0] || '',
      dept: ctx.department_name || 'your department',
      rotaName: ctx.rota_name || '',
      verb: copy.verb,
      note: note || null,
      ctaUrl: `${SITE_URL}${changed}`,
      accent: copy.tone,
    });
    const subject = `${copy.headline} — ${ctx.department_name || 'rota'}`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Cargo Rotas <rotas@cargotechnology.co.uk>',
        to: [email],
        subject,
        html,
      }),
    });
    const resendData = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.warn('[sendRotaDecision] Resend error', resendRes.status, JSON.stringify(resendData));
      return new Response(JSON.stringify({ error: resendData?.message || `Resend ${resendRes.status}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, id: resendData?.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sendRotaDecision] error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
