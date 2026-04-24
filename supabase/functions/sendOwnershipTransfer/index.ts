// Supabase Edge Function: sendOwnershipTransfer
//
// Sends a branded ownership-transfer confirmation email via Resend when the
// current OWNER initiates a transfer to another team member. The link points
// at /confirm-ownership-transfer/<token>.
//
// Env vars required:
//   RESEND_API_KEY
//   SITE_URL                         (optional — defaults to https://cargotechnology.netlify.app)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (only used as a fallback when
//     the caller doesn't pass supplierName / fromName in the body)
//
// Request body:
//   { token: uuid, targetEmail: string, supplierName?: string, fromName?: string }

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
const SITE_URL                  = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ─── Inlined from ../_shared/emailTemplate.ts ───────────────────────────────
// The Supabase dashboard "Deploy updates" button can't resolve `../_shared/`
// imports at deploy time, so the template is duplicated here. Keep this block
// in sync with the source-of-truth file in the repo when editing.

type EmailTemplateParams = {
  preheader: string;
  headline: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  secondaryText?: string;
  footerNote?: string;
  headlineEmphasis?: string;
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
  const { preheader, headline, intro, ctaLabel, ctaUrl, secondaryText, footerNote, headlineEmphasis } = params;

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
  const { headline, intro, ctaLabel, ctaUrl, secondaryText, footerNote, headlineEmphasis } = params;
  const headlineText = headlineEmphasis ? headline.replace(/\{emphasis\}/g, headlineEmphasis) : headline;
  const lines = [headlineText, '', intro, '', `${ctaLabel}: ${ctaUrl}`];
  if (secondaryText) lines.push('', secondaryText);
  lines.push('', '--', 'Cargo · Built for superyacht crew');
  lines.push(footerNote || 'Questions? Reply to this email.');
  return lines.join('\n');
}

// ─── End inlined template ───────────────────────────────────────────────────

// Fallback lookup when the caller didn't pass supplierName/fromName. Uses the
// transfer token (which is uniquely indexed) to join supplier_profiles and the
// originating contact.
async function fetchContext(token: string): Promise<{ supplierName?: string; fromName?: string }> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return {};
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/supplier_ownership_transfer_requests?token=eq.${token}&select=supplier_profiles!inner(name),from_contact:from_contact_id(name,email)`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return {};
    const rows = await res.json();
    const row = rows?.[0];
    return {
      supplierName: row?.supplier_profiles?.name ?? undefined,
      fromName: row?.from_contact?.name ?? row?.from_contact?.email ?? undefined,
    };
  } catch {
    return {};
  }
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

  let body: {
    token?: string;
    targetEmail?: string;
    supplierName?: string;
    fromName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.token || !body.targetEmail) {
    return new Response(JSON.stringify({ error: 'Missing required fields: token, targetEmail' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let supplierName = body.supplierName;
  let fromName     = body.fromName;
  if ((!supplierName || !fromName) && body.token) {
    const ctx = await fetchContext(body.token);
    supplierName = supplierName ?? ctx.supplierName;
    fromName     = fromName     ?? ctx.fromName;
  }
  supplierName = supplierName || 'your supplier account';
  fromName     = fromName     || 'The current owner';

  const confirmUrl = `${SITE_URL}/confirm-ownership-transfer/${body.token}`;

  const emailParams: EmailTemplateParams = {
    preheader: `Confirm you're ready to become the owner of ${supplierName} on Cargo.`,
    headline: `Confirm ownership of {emphasis}`,
    headlineEmphasis: supplierName,
    intro: `${fromName} has requested to transfer ownership of the ${supplierName} Cargo supplier account to you. You have 72 hours to confirm. After confirmation, you'll have full admin control — including billing, team management, and ownership settings.`,
    ctaLabel: 'Confirm ownership transfer',
    ctaUrl: confirmUrl,
    secondaryText: `Or paste this link into your browser: ${confirmUrl}`,
    footerNote: "If you weren't expecting this request, contact the account owner directly before taking action. Do not click the link if you're unsure.",
  };

  const html = renderCargoEmail(emailParams);
  const text = renderCargoEmailText(emailParams);

  console.log('[sendOwnershipTransfer] Sending to:', body.targetEmail, '| supplier:', supplierName);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Cargo Suppliers <suppliers@cargotechnology.co.uk>',
      to:      [body.targetEmail],
      subject: 'Ownership transfer — confirm within 72 hours',
      html,
      text,
    }),
  });

  const resendData = await resendRes.json();
  console.log('[sendOwnershipTransfer] Resend response:', resendRes.status, JSON.stringify(resendData));

  if (!resendRes.ok) {
    return new Response(JSON.stringify({ error: resendData?.message || `Resend error ${resendRes.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, id: resendData?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
