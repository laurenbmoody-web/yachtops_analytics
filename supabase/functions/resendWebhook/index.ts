// Supabase Edge Function: resendWebhook
//
// Receives Resend delivery webhooks for EVERY email Cargo sends and surfaces
// the problems so a suppression/bounce never fails silently again. On a
// bounce / complaint / delay it logs to public.email_events; on a bounce or
// complaint it also emails a Cargo OPS address (NOT the tenant admin — only
// the Cargo backend can clear a Resend suppression).
//
// Resend signs webhooks with the Svix scheme; if RESEND_WEBHOOK_SECRET is set
// we verify the signature and reject forgeries. (If unset, we process anyway
// and log a warning, so you can wire it up before adding the secret.)
//
// DEPLOY: must skip JWT verification (Resend can't send a Supabase JWT):
//   supabase functions deploy resendWebhook --no-verify-jwt
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), RESEND_API_KEY,
//      RESEND_WEBHOOK_SECRET (whsec_… from the Resend webhook settings),
//      OPS_ALERT_EMAIL (where bounce/complaint alerts go).
//
// Resend webhook events configured in the dashboard should include at least
// email.bounced and email.complained (email.delivery_delayed optional).

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') || '';
const RESEND_WEBHOOK_SECRET     = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
const OPS_ALERT_EMAIL           = Deno.env.get('OPS_ALERT_EMAIL') || 'alerts@cargotechnology.co.uk';

const PROBLEM_EVENTS = ['email.bounced', 'email.complained', 'email.delivery_delayed'];
const ALERT_EVENTS   = ['email.bounced', 'email.complained'];

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return arr;
}
function b64encode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// Svix signature verification (Resend's scheme). svix-signature is a space-
// separated list of "v1,<base64sig>"; the signed content is id.timestamp.body.
async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  if (!RESEND_WEBHOOK_SECRET) {
    console.warn('[resendWebhook] RESEND_WEBHOOK_SECRET unset — skipping verification');
    return true;
  }
  const id = req.headers.get('svix-id') || req.headers.get('webhook-id') || '';
  const ts = req.headers.get('svix-timestamp') || req.headers.get('webhook-timestamp') || '';
  const sigHeader = req.headers.get('svix-signature') || req.headers.get('webhook-signature') || '';
  if (!id || !ts || !sigHeader) return false;
  try {
    const secretB64 = RESEND_WEBHOOK_SECRET.replace(/^whsec_/, '');
    const key = await crypto.subtle.importKey(
      'raw', b64decode(secretB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signed = `${id}.${ts}.${rawBody}`;
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
    const expected = b64encode(mac);
    const provided = sigHeader.split(' ').map((p) => p.split(',')[1] || p);
    return provided.includes(expected);
  } catch (e) {
    console.error('[resendWebhook] signature verify error', e);
    return false;
  }
}

async function logEvent(row: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/email_events`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  }).catch(() => {});
}

async function alertOps(eventType: string, recipient: string, subject: string, emailId: string, reason: string) {
  if (!RESEND_API_KEY || !OPS_ALERT_EMAIL) return;
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;color:#1C1B3A;line-height:1.6;">
    <h2 style="margin:0 0 12px;font-size:18px;">⚠️ Email delivery problem</h2>
    <p style="margin:0 0 8px;"><b>Event:</b> ${eventType}</p>
    <p style="margin:0 0 8px;"><b>Recipient:</b> ${recipient || '(unknown)'}</p>
    <p style="margin:0 0 8px;"><b>Subject:</b> ${subject || '(none)'}</p>
    <p style="margin:0 0 8px;"><b>Resend id:</b> ${emailId || '(none)'}</p>
    ${reason ? `<p style="margin:0 0 8px;"><b>Reason:</b> ${reason}</p>` : ''}
    <p style="margin:16px 0 0;color:#8B8478;font-size:12px;">This address is now likely on the Resend suppression list — future sends to it will be accepted but not delivered. Remove it from Suppressions in the Resend dashboard once the underlying issue is resolved. The recipient still received the in-app notification.</p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Cargo Alerts <alerts@cargotechnology.co.uk>',
      to: [OPS_ALERT_EMAIL],
      subject: `⚠️ Email ${eventType} — ${recipient || 'unknown recipient'}`,
      html,
    }),
  }).catch(() => {});
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  if (!(await verifySignature(req, rawBody))) {
    console.warn('[resendWebhook] signature verification failed — rejecting');
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(rawBody); } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const type = event.type || '';
  const d = event.data || {};
  const toField = d.to;
  const recipient = Array.isArray(toField) ? toField.join(', ') : String(toField || '');
  const subject = String(d.subject || '');
  const emailId = String(d.email_id || d.id || '');
  // Bounce/complaint detail varies by event; capture whatever's present.
  const reason = (() => {
    const b = d.bounce as Record<string, unknown> | undefined;
    if (b && (b.message || b.subType || b.type)) return String(b.message || `${b.type || ''} ${b.subType || ''}`).trim();
    if (d.reason) return String(d.reason);
    return '';
  })();

  console.log(`[resendWebhook] type=${type} recipient=${recipient} id=${emailId}`);

  if (PROBLEM_EVENTS.includes(type)) {
    await logEvent({
      event_type: type,
      email_id: emailId || null,
      recipient: recipient || null,
      subject: subject || null,
      reason: reason || null,
      payload: event,
      created_at: new Date().toISOString(),
    });
  }
  if (ALERT_EVENTS.includes(type)) {
    await alertOps(type, recipient, subject, emailId, reason);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
