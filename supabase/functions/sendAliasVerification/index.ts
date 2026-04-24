// Supabase Edge Function: sendAliasVerification
//
// Sends a branded verification email via Resend when a supplier adds a new
// email alias to their account. The link points at /verify-alias/<token>,
// which calls the verify_supplier_email_alias RPC on mount.
//
// Env vars required:
//   RESEND_API_KEY
//   SITE_URL  (optional — defaults to https://cargotechnology.netlify.app)

import { renderCargoEmail, renderCargoEmailText } from '../_shared/emailTemplate.ts';

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
const SITE_URL = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';

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

  let body: { aliasId?: string; email?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.email || !body.token) {
    return new Response(JSON.stringify({ error: 'Missing required fields: email, token' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const verifyUrl = `${SITE_URL}/verify-alias/${body.token}`;

  const emailParams = {
    preheader: 'Click the link to confirm this email for your Cargo supplier portal.',
    headline: 'Verify your email address',
    intro:
      "We've added this email to your Cargo supplier portal. Click below to confirm it belongs to you — this lets orders sent to this address appear in your portal.",
    ctaLabel: 'Verify email address',
    ctaUrl: verifyUrl,
    secondaryText: `Or paste this link into your browser: ${verifyUrl}`,
    footerNote: "If you didn't request this, you can ignore this email — nothing will change.",
  };

  const html = renderCargoEmail(emailParams);
  const text = renderCargoEmailText(emailParams);

  console.log('[sendAliasVerification] Sending to:', body.email, '| aliasId:', body.aliasId);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Cargo Suppliers <suppliers@cargotechnology.co.uk>',
      to:      [body.email],
      subject: 'Verify your email for Cargo Suppliers',
      html,
      text,
    }),
  });

  const resendData = await resendRes.json();
  console.log('[sendAliasVerification] Resend response:', resendRes.status, JSON.stringify(resendData));

  if (!resendRes.ok) {
    return new Response(JSON.stringify({ error: resendData?.message || `Resend error ${resendRes.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, id: resendData?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
