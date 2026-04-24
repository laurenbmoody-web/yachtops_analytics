// Supabase Edge Functions — shared Cargo email template.
//
// One source of truth for supplier-side transactional email layout.
// All HTML is inline-styled and table-based so it renders in Outlook,
// Gmail, iOS Mail, and dark-mode clients.
//
// Typical flow:
//   import { renderCargoEmail, renderCargoEmailText } from '../_shared/emailTemplate.ts';
//   const html = renderCargoEmail({ preheader, headline, intro, ctaLabel, ctaUrl, ... });
//   const text = renderCargoEmailText({ ... });            // plain-text fallback
//   await fetch('https://api.resend.com/emails', { ..., body: JSON.stringify({ html, text, ... }) });

export type EmailTemplateParams = {
  preheader: string;        // Inbox preview text (40-90 chars).
  headline: string;         // Main Georgia serif headline. May contain {emphasis} token.
  intro: string;            // One-sentence intro below headline.
  ctaLabel: string;         // Primary button text.
  ctaUrl: string;           // Primary button destination.
  secondaryText?: string;   // Optional small paragraph below the button.
  footerNote?: string;      // Optional small-print line in the footer.
  headlineEmphasis?: string; // Optional burnt-orange italic span substituted into {emphasis}.
};

// Brand tokens — mirror the /verify-alias page and marketing site.
const NAVY       = '#1C2340';
const BURNT_ORG  = '#C65A1A';  // reserved for italic emphasis if used in intro; not used on CTAs
const CREAM_BG   = '#F5F1EB';
const WHITE      = '#FFFFFF';
const DARK_TEXT  = '#1C2340';
const MUTED_TEXT = '#6B6F7B';
const BORDER     = '#E5DFD4';

// Hosted wordmark — PNG is the email-safe choice (Gmail frequently strips
// inline SVG and blocks unknown MIME types). Path mirrors the assets the
// public site already serves, so no new file needed.
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

export function renderCargoEmail(params: EmailTemplateParams): string {
  const {
    preheader,
    headline,
    intro,
    ctaLabel,
    ctaUrl,
    secondaryText,
    footerNote,
    headlineEmphasis,
  } = params;

  const safePreheader = escapeHtml(preheader);
  // Headline: escape first, then substitute the {emphasis} token with a safely-
  // escaped burnt-orange <em> span. If headlineEmphasis is absent, {emphasis}
  // is stripped (shouldn't appear) — callers that don't use the feature simply
  // provide a headline without the token.
  const escapedHeadline = escapeHtml(headline);
  const safeHeadline = headlineEmphasis
    ? escapedHeadline.replace(
        /\{emphasis\}/g,
        `<em style="font-style: italic; color: ${BURNT_ORG}; font-weight: inherit;">${escapeHtml(headlineEmphasis)}</em>`
      )
    : escapedHeadline;
  // Plain-text flavour for the <title> tag (no markup allowed inside <title>).
  const titleHeadline = headlineEmphasis
    ? escapedHeadline.replace(/\{emphasis\}/g, escapeHtml(headlineEmphasis))
    : escapedHeadline;
  const safeIntro     = escapeHtml(intro);
  const safeCtaLabel  = escapeHtml(ctaLabel);
  const safeCtaUrl    = escapeHtml(ctaUrl);
  const safeSecondary = secondaryText ? escapeHtml(secondaryText) : '';
  const safeFooter    = footerNote ? escapeHtml(footerNote) : 'Questions? Reply to this email.';

  // VML button fallback for Outlook 2007-2019 (Word rendering engine).
  // Outlook ignores padding on <a>, so we wrap in VML roundrect.
  const vmlButton = `<!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeCtaUrl}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="8%" stroke="f" fillcolor="${NAVY}">
      <w:anchorlock/>
      <center style="color:${WHITE};font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:0.3px;">${safeCtaLabel}</center>
    </v:roundrect>
  <![endif]-->`;

  // Bulletproof <a> button for everything that isn't Outlook.
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

  <!-- Preheader (hidden in body, shown in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_BG};opacity:0;">
    ${safePreheader}
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};width:100%;">
    <tr>
      <td align="center" style="padding:0;">

        <!-- Navy header band -->
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${NAVY};">
          <tr>
            <td style="height:40px;line-height:40px;font-size:0;">&nbsp;</td>
          </tr>
        </table>

        <!-- Spacer between band and card -->
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>
        </table>

        <!-- Content card -->
        <table role="presentation" class="cargo-card" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:4px;">
          <tr>
            <td style="padding:48px 48px 48px 48px;">

              <!-- Wordmark -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:${SERIF};font-size:32px;font-style:italic;color:${NAVY};line-height:1;">
                    <img src="${WORDMARK_URL}" width="144" alt="cargo" style="display:block;width:144px;height:auto;border:0;outline:none;text-decoration:none;" />
                  </td>
                </tr>
              </table>

              <!-- 32px spacer -->
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>
              </table>

              <!-- Headline -->
              <h1 style="margin:0;padding:0;font-family:${SERIF};font-weight:400;font-size:28px;line-height:1.25;color:${NAVY};letter-spacing:-0.01em;">
                ${safeHeadline}
              </h1>

              <!-- 12px spacer -->
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
              </table>

              <!-- Intro -->
              <p style="margin:0;padding:0;font-family:${SANS};font-size:15px;line-height:1.6;color:${DARK_TEXT};">
                ${safeIntro}
              </p>

              <!-- 28px spacer -->
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
              </table>

              <!-- CTA button (VML for Outlook + <a> for everything else) -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    ${vmlButton}
                    ${aButton}
                  </td>
                </tr>
              </table>

              ${safeSecondary ? `
              <!-- 20px spacer -->
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>
              </table>

              <!-- Secondary text -->
              <p style="margin:0;padding:0;font-family:${SANS};font-size:13px;line-height:1.55;color:${MUTED_TEXT};word-break:break-all;">
                ${safeSecondary}
              </p>
              ` : ''}

            </td>
          </tr>
        </table>

        <!-- Footer -->
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

// Plain-text fallback. Same information, no markup.
export function renderCargoEmailText(params: EmailTemplateParams): string {
  const { headline, intro, ctaLabel, ctaUrl, secondaryText, footerNote } = params;
  const lines = [
    headline,
    '',
    intro,
    '',
    `${ctaLabel}: ${ctaUrl}`,
  ];
  if (secondaryText) {
    lines.push('', secondaryText);
  }
  lines.push('', '--', 'Cargo · Built for superyacht crew');
  if (footerNote) {
    lines.push(footerNote);
  } else {
    lines.push('Questions? Reply to this email.');
  }
  return lines.join('\n');
}
