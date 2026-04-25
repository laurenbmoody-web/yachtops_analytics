// Supabase Edge Function: sendSupplierOrder
//
// Sends a branded order-request email via Resend when a vessel sends a
// provisioning order to a supplier. Two flavours:
//
//   - PORTAL email (supplier already on Cargo, supplier_profile_id resolved)
//     CTA → /supplier/orders/<orderId>
//
//   - PUBLIC email (cold supplier, no Cargo account yet)
//     CTA → /order/confirm/<publicToken>
//
// Both branches use the same renderCargoEmail template — only headline /
// intro / cta differ. The public email keeps a soft footer pitch about
// Cargo hosting a free supplier profile; the portal email is pure ops.
//
// Env vars required:
//   RESEND_API_KEY
//   SITE_URL  (optional — defaults to https://cargotechnology.netlify.app)
//
// Request body:
//   {
//     to: string,
//     publicToken: uuid,
//     supplierProfileId?: uuid | null,   // routes to portal email when present
//     orderId?: uuid,                    // required when supplierProfileId is set
//     replyTo?: string,
//     senderName?: string,
//     vesselName?: string,
//     supplierName?: string,
//     deliveryPort?: string,
//     deliveryDate?: string,
//     deliveryTime?: string,
//     deliveryContact?: string,
//     specialInstructions?: string,
//     currency?: 'GBP' | 'USD' | 'EUR' | string,
//     items?: { name, quantity, unit, notes, estimatedPrice }[],
//   }

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
const SITE_URL       = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';

// ─── Inlined from _shared/emailTemplate.ts ──────────────────────────────────
// The Supabase dashboard "Deploy updates" button can't resolve `_shared/`
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

function formatDeliveryDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  try {
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return raw;
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

  // vesselName is sent pre-prefixed from the frontend (e.g. "M/Y Test Laurence").
  const vesselName    = body.vesselName || 'Vessel';
  const deliveryPort  = body.deliveryPort || null;
  const formattedDate = formatDeliveryDate(body.deliveryDate);
  const senderName    = body.senderName ? String(body.senderName).trim() : '';
  const items         = Array.isArray(body.items) ? body.items : [];
  const itemCount     = items.length;

  // Decide which email to send. We need BOTH supplierProfileId and orderId to
  // route to the portal email — without orderId the URL can't be built.
  let usePortalEmail = !!body.supplierProfileId && !!body.orderId;
  if (body.supplierProfileId && !body.orderId) {
    console.warn(
      '[sendSupplierOrder] supplierProfileId present but orderId missing — falling back to public email',
      { to: body.to, publicToken: body.publicToken }
    );
    usePortalEmail = false;
  }

  // Compose the parts that change across both branches into shared snippets.
  const dateAndPort = [formattedDate, deliveryPort].filter(Boolean).join(' at ');
  const subjectTail = [formattedDate, deliveryPort].filter(Boolean).join(' · ');
  const fromBy      = senderName ? `${senderName} from ` : '';
  const itemsLabel  = itemCount === 1 ? 'item' : 'items';
  const itemsClause = itemCount > 0 ? `${itemCount} ${itemsLabel}` : 'a new order';

  let emailParams: EmailTemplateParams;
  let subject: string;

  if (usePortalEmail) {
    const portalUrl = `${SITE_URL}/supplier/orders/${body.orderId}`;
    const deliveryClause = dateAndPort ? ` for delivery on ${dateAndPort}` : '';
    const preheaderTail = dateAndPort
      ? `for delivery on ${dateAndPort}.`
      : 'No delivery date set yet.';

    emailParams = {
      preheader: `${vesselName} sent a new order ${preheaderTail}`,
      headline: `New order from {emphasis}`,
      headlineEmphasis: vesselName,
      intro: `${fromBy}${vesselName} has sent you an order — ${itemsClause}${deliveryClause}. Open it in your portal to confirm, substitute, or flag any issues.`,
      ctaLabel: 'Open in portal',
      ctaUrl: portalUrl,
      secondaryText: `Or paste this link into your browser: ${portalUrl}`,
      footerNote: `Questions? Reply to this email — it goes directly to ${senderName || 'the chief stew'}.`,
    };

    subject = ['New order from ' + vesselName, subjectTail].filter(Boolean).join(' · ');
  } else {
    const confirmUrl = `${SITE_URL}/order/confirm/${body.publicToken}`;
    const deliveryClause = dateAndPort ? ` for delivery on ${dateAndPort}` : '';
    const preheaderTail = dateAndPort
      ? `for ${dateAndPort}.`
      : 'No delivery date set yet.';

    emailParams = {
      preheader: `${vesselName} needs to confirm an order ${preheaderTail} No account needed.`,
      headline: `{emphasis} sent you a new order`,
      headlineEmphasis: vesselName,
      intro: `${fromBy}${vesselName} has sent an order — ${itemsClause}${deliveryClause}. Click below to view items and confirm — no account needed.`,
      ctaLabel: 'View & confirm order',
      ctaUrl: confirmUrl,
      secondaryText: `Or paste this link into your browser: ${confirmUrl}`,
      footerNote: `Questions? Reply to this email — it goes directly to ${senderName || 'the chief stew'}. Cargo can also host your supplier profile, free — visit cargotechnology.netlify.app to learn more.`,
    };

    subject = [`${vesselName} needs to confirm an order`, subjectTail].filter(Boolean).join(' · ');
  }

  const html = renderCargoEmail(emailParams);
  const text = renderCargoEmailText(emailParams);

  console.log(
    '[sendSupplierOrder] Sending',
    usePortalEmail ? 'PORTAL' : 'PUBLIC',
    'to:', body.to,
    '| supplierProfileId:', body.supplierProfileId ?? null,
    '| orderId:', body.orderId ?? null,
    '| subject:', subject,
    '| items:', itemCount
  );

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Cargo Orders <orders@cargotechnology.co.uk>',
      to:      [body.to],
      subject,
      html,
      text,
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

  return new Response(JSON.stringify({ success: true, id: resendData?.id, mode: usePortalEmail ? 'portal' : 'public' }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
