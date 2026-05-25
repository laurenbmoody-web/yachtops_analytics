// Supabase Edge Function: sendReturnTaskNotification
//
// Sends a branded "you have a return to action" email via Resend when a
// supplier_return_tasks row is created (crew routing a return into the
// supplier's Cargo portal via the route_return_to_portal RPC). The
// crew-side caller fires this fire-and-forget — failures here MUST NOT
// roll back or surface as a routing failure. The supplier_return_tasks
// row is the source of truth; the email is a courtesy on top.
//
// Recipient resolution (server-side, service role — crew callers can't
// read supplier_contacts under RLS):
//   1. supplier_contacts where active = true AND user_id IS NOT NULL
//      AND email IS NOT NULL.
//      (These are the humans with actual portal accounts — the people
//       who'd action the task at /supplier/returns.)
//   2. Fallback: supplier_profiles.contact_email if (1) is empty.
//   3. If both empty: log a warning and return success-with-noop.
//      Never fail the routing for a missing address.
// All resolved recipients go into a single Resend send (Resend supports
// up to 50 in the to array). They're peers on the supplier org so seeing
// each other on the email helps coordination — no BCC needed.
//
// Env vars required:
//   RESEND_API_KEY
//   SUPABASE_URL                 (auto-populated by Supabase Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-populated)
//   SITE_URL                     (optional — defaults to cargotechnology.netlify.app)
//
// Request body:
//   { taskId: uuid }   // the supplier_return_tasks row id

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

// ─── Inlined from _shared/emailTemplate.ts ──────────────────────────────────
// The Supabase dashboard "Deploy updates" button can't resolve `_shared/`
// imports at deploy time, so the template is duplicated here. Keep this block
// in sync with the source-of-truth file in the repo when editing.
//
// LOCAL EXTENSION: this copy adds an optional `itemsList?: string[]` param
// rendered as a short <ul> between the intro and the CTA. The shared file
// doesn't have this slot. Returns emails benefit from showing the items at
// a glance so the supplier can triage from the inbox; if you sync this
// inline copy with the shared template, preserve the extension.

type EmailTemplateParams = {
  preheader: string;
  headline: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  secondaryText?: string;
  footerNote?: string;
  headlineEmphasis?: string;
  itemsList?: string[];   // LOCAL EXTENSION — one line per list item
};

const NAVY       = '#1C2340';
const BURNT_ORG  = '#C65A1A';
const CREAM_BG   = '#F5F1EB';
const WHITE      = '#FFFFFF';
const DARK_TEXT  = '#1C2340';
const MUTED_TEXT = '#6B6F7B';
const BORDER     = '#E5DFD4';

const WORDMARK_URL =
  'https://cargotechnology.netlify.app/assets/images/cargo_merged_originalmark_syne800_true.png';

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCargoEmail(params: EmailTemplateParams): string {
  const { preheader, headline, intro, ctaLabel, ctaUrl, secondaryText, footerNote, headlineEmphasis, itemsList } = params;

  const safePreheader = escapeHtml(preheader);
  const escapedHeadline = escapeHtml(headline);
  const safeHeadline = headlineEmphasis
    ? escapedHeadline.replace(
        /\{emphasis\}/g,
        `<em style="font-style: italic; color: ${BURNT_ORG}; font-weight: inherit;">${escapeHtml(headlineEmphasis)}</em>`
      )
    : escapedHeadline;
  const titleHeadline = headlineEmphasis
    ? escapedHeadline.replace(/\{emphasis\}/g, escapeHtml(headlineEmphasis))
    : escapedHeadline;
  const safeIntro     = escapeHtml(intro);
  const safeCtaLabel  = escapeHtml(ctaLabel);
  const safeCtaUrl    = escapeHtml(ctaUrl);
  const safeSecondary = secondaryText ? escapeHtml(secondaryText) : '';
  const safeFooter    = footerNote ? escapeHtml(footerNote) : 'Questions? Reply to this email.';

  // LOCAL EXTENSION — items list rendered between intro and CTA.
  const itemsHtml = (itemsList && itemsList.length > 0)
    ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
         <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
       </table>
       <ul style="margin:0;padding:0 0 0 20px;font-family:${SANS};font-size:14px;line-height:1.7;color:${DARK_TEXT};">
         ${itemsList.map((line) => `<li style="padding:2px 0;">${escapeHtml(line)}</li>`).join('')}
       </ul>`
    : '';

  const vmlButton = `<!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeCtaUrl}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="8%" stroke="f" fillcolor="${NAVY}">
      <w:anchorlock/>
      <center style="color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:0.3px;">${safeCtaLabel}</center>
    </v:roundrect>
  <![endif]-->`;

  const aButton = `<!--[if !mso]><!-- -->
    <a href="${safeCtaUrl}"
       style="display:inline-block;padding:14px 28px;background:${NAVY};color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:0.3px;text-decoration:none;border-radius:4px;mso-hide:all;">
      ${safeCtaLabel}
    </a>
  <!--<![endif]-->`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${titleHeadline}</title>
  <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      .cargo-card {
        width: 100% !important;
        padding: 32px 24px !important;
      }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${CREAM_BG};-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:none;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_BG};opacity:0;">
    ${safePreheader}
  </div>

  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};width:100%;">
    <tr>
      <td align="center" style="padding:0;">

        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${NAVY};">
          <tr><td style="height:40px;line-height:40px;font-size:0;">&nbsp;</td></tr>
        </table>

        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>
        </table>

        <table role="presentation" class="cargo-card" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:4px;">
          <tr>
            <td style="padding:48px 48px 48px 48px;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:${SERIF};font-size:32px;font-style:italic;color:${NAVY};line-height:1;">
                    <img src="${WORDMARK_URL}" width="144" alt="cargo" style="display:block;width:144px;height:auto;border:0;outline:none;text-decoration:none;" />
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>
              </table>

              <h1 style="margin:0;padding:0;font-family:${SERIF};font-weight:400;font-size:28px;line-height:1.25;color:${NAVY};letter-spacing:-0.01em;">
                ${safeHeadline}
              </h1>

              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:0;padding:0;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">
                ${safeIntro}
              </p>

              ${itemsHtml}

              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
              </table>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    ${vmlButton}
                    ${aButton}
                  </td>
                </tr>
              </table>

              ${safeSecondary ? `
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:0;padding:0;font-family:${SANS};font-size:13px;line-height:1.55;color:${MUTED_TEXT};word-break:break-all;">
                ${safeSecondary}
              </p>
              ` : ''}

            </td>
          </tr>
        </table>

        <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;">
          <tr>
            <td style="padding:40px 24px 32px;text-align:center;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED_TEXT};">
              Cargo · Built for superyacht crew<br />
              ${safeFooter}
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

function renderCargoEmailText(params: EmailTemplateParams): string {
  const { headline, intro, ctaLabel, ctaUrl, secondaryText, footerNote, headlineEmphasis, itemsList } = params;
  const headlineText = headlineEmphasis ? headline.replace(/\{emphasis\}/g, headlineEmphasis) : headline;
  const lines = [headlineText, '', intro];
  if (itemsList && itemsList.length > 0) {
    lines.push('');
    for (const item of itemsList) lines.push(`· ${item}`);
  }
  lines.push('', `${ctaLabel}: ${ctaUrl}`);
  if (secondaryText) lines.push('', secondaryText);
  lines.push('', '--', 'Cargo · Built for superyacht crew');
  lines.push(footerNote || 'Questions? Reply to this email.');
  return lines.join('\n');
}

// ─── End inlined template ───────────────────────────────────────────────────

// Lightweight PostgREST helper. The Supabase JS client isn't pulled in here
// because the existing pattern in other edge functions (sendDeliveryNoteEmails,
// signDeliveryNote, generateDeliveryNote) uses raw fetch — no extra deps.
async function pgRead(path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`PostgREST ${res.status} on ${path}: ${errText}`);
  }
  return res.json();
}

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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.taskId) {
    return new Response(JSON.stringify({ error: 'Missing required field: taskId' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch the task ────────────────────────────────────────────────────────
  let tasks: any[];
  try {
    tasks = await pgRead(
      `supplier_return_tasks?id=eq.${encodeURIComponent(body.taskId)}&select=id,supplier_id,items,slip_metadata,order_id`
    );
  } catch (err) {
    console.error('[sendReturnTaskNotification] task fetch failed:', err);
    return new Response(JSON.stringify({ error: 'Task fetch failed' }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const task = tasks?.[0];
  if (!task) {
    return new Response(JSON.stringify({ error: `Task ${body.taskId} not found` }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Resolve recipients ────────────────────────────────────────────────────
  // 1. Active supplier_contacts with portal accounts.
  let recipients: string[] = [];
  try {
    const contacts = await pgRead(
      `supplier_contacts?supplier_id=eq.${encodeURIComponent(task.supplier_id)}&active=eq.true&user_id=not.is.null&email=not.is.null&select=email`
    );
    recipients = (contacts || [])
      .map((c: any) => (c.email || '').trim())
      .filter((e: string) => e.length > 0);
  } catch (err) {
    console.error('[sendReturnTaskNotification] contacts fetch failed:', err);
    // Don't bail — try the fallback before giving up.
  }
  // 2. Fallback: supplier_profiles.contact_email.
  if (recipients.length === 0) {
    try {
      const profiles = await pgRead(
        `supplier_profiles?id=eq.${encodeURIComponent(task.supplier_id)}&select=contact_email`
      );
      const fallback = (profiles?.[0]?.contact_email || '').trim();
      if (fallback) recipients = [fallback];
    } catch (err) {
      console.error('[sendReturnTaskNotification] profile fallback fetch failed:', err);
    }
  }
  // 3. No-op success if there's nobody to email.
  if (recipients.length === 0) {
    console.warn(
      '[sendReturnTaskNotification] no recipients resolved for supplier',
      task.supplier_id, 'task', task.id, '— returning noop success'
    );
    return new Response(JSON.stringify({ success: true, mode: 'noop', reason: 'no_recipients' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Compose ───────────────────────────────────────────────────────────────
  const md         = task.slip_metadata || {};
  const items      = Array.isArray(task.items) ? task.items : [];
  const vesselName = md.vessel_name || 'A vessel';
  const itemCount  = items.length;
  const itemsLabel = itemCount === 1 ? 'item' : 'items';

  // Items list — one line per item: "Name · qty unit · reason"
  const itemsList: string[] = items.map((it: any) => {
    const name   = it.raw_name || 'Item';
    const qty    = it.return_qty ?? it.quantity ?? '?';
    const unit   = it.unit ? ` ${it.unit}` : '';
    const reason = it.return_reason || 'Other';
    return `${name} · ${qty}${unit} · ${reason}`;
  });

  const portalUrl = `${SITE_URL}/supplier/returns`;
  const intro = `${vesselName} has routed a return into your Cargo portal — ${itemCount} ${itemsLabel}. Open it in the portal to acknowledge and confirm next steps.`;

  const emailParams: EmailTemplateParams = {
    preheader:        `${vesselName} has routed a return to your portal — ${itemCount} ${itemsLabel}.`,
    headline:         `New return from {emphasis}`,
    headlineEmphasis: vesselName,
    intro,
    itemsList,
    ctaLabel:         'Open in portal',
    ctaUrl:           portalUrl,
    secondaryText:    `Or paste this link into your browser: ${portalUrl}`,
    footerNote:       'Questions? Reply to this email.',
  };

  const subject = `New return from ${vesselName} · ${itemCount} ${itemsLabel}`;
  const html    = renderCargoEmail(emailParams);
  const text    = renderCargoEmailText(emailParams);

  console.log(
    '[sendReturnTaskNotification] Sending',
    '| taskId:', task.id,
    '| supplierId:', task.supplier_id,
    '| recipients:', recipients.length, recipients,
    '| subject:', subject,
    '| items:', itemCount
  );

  // ── Send via Resend ───────────────────────────────────────────────────────
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Cargo Returns <orders@cargotechnology.co.uk>',
      to:      recipients,
      subject,
      html,
      text,
    }),
  });

  const resendData = await resendRes.json().catch(() => ({}));
  console.log('[sendReturnTaskNotification] Resend response:', resendRes.status, JSON.stringify(resendData));

  if (!resendRes.ok) {
    return new Response(JSON.stringify({ error: resendData?.message || `Resend error ${resendRes.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    id: resendData?.id,
    recipientCount: recipients.length,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
