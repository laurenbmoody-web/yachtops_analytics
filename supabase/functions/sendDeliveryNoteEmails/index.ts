// Supabase Edge Function: sendDeliveryNoteEmails
//
// Sprint 9b Commit 7. Emails the unsigned delivery note's signing link
// to the receiving party (vessel side) so they can click through to
// /delivery-sign/<token>, sign on canvas, and confirm receipt.
//
// === RUN 3 — REAL SEND ===
//
// Validates input, fetches the order, runs idempotency, resolves the
// recipient via the 4-step chain, sends via Resend, stamps
// supplier_orders.delivery_note_emailed_at, and writes a
// 'delivery_note_emailed' activity event.
//
// === Auth ===
//
// Caller must be an active supplier_contacts row for the order's
// supplier_profile_id. Mirrors generateDeliveryNote — only the supplier
// portal triggers this; the vessel side never calls it.
//
// === Recipient resolution chain (per Lauren's spec) ===
//
// Sender = supplier_orders.created_by (the user who clicked Send to
// Supplier on the vessel side at order creation time).
//
//   1. Sender still active on this tenant?
//        → send to sender's email. resolution = 'sender_active'.
//   2. Sender's most-recent tenant_members row (active or not) has a role_id?
//      Active members with the SAME role_id on this tenant?
//        → send to all (deduplicated). resolution = 'role_match'.
//   3. Active permission_tier='COMMAND' members on this tenant?
//        → send to all. resolution = 'command_fallback'.
//   4. None of the above → 422.
//
// Send strategy: single recipient on `to`; multi-recipient = first on
// `to`, rest on `bcc`. One Resend send, one message_id.
//
// === Email tone (resolution-aware) ===
//
//   sender_active                → Hi {first_name},
//   role_match (1 recipient)     → Hi {first_name},
//   role_match (multi recipients)→ Hi team,
//   command_fallback             → Hi team,
//
// === Env ===
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SITE_URL                       (defaults to https://cargotechnology.netlify.app)
//   RESEND_API_KEY
//
// === Body ===
//   { orderId: uuid, force?: boolean }
//
// === Response ===
//   { ok: true, message_id, sent_to, recipient_count, resolution, ... }  (sent)
//   { ok: true, already_sent: true, sent_at, remaining_window_seconds }  (idempotency)
//
// === Order of operations (real send) ===
//   1. Validate + auth + load order
//   2. Idempotency check
//   3. Resolve recipients (4-step chain)
//   4. Build email (subject + HTML + plain text)
//   5. Resend POST → return 502 on failure (no stamp, no activity)
//   6. PATCH supplier_orders SET delivery_note_emailed_at = now()  (best-effort)
//   7. INSERT supplier_order_activity 'delivery_note_emailed'      (best-effort)
//   8. Return success with message_id

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE_URL              = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') || '';

const FROM_EMAIL = 'Cargo Deliveries <deliveries@cargotechnology.co.uk>';
const CARGO_WORDMARK_URL =
  'https://cargotechnology.netlify.app/assets/images/cargo_merged_originalmark_syne800_true.png';

// Idempotency window: refuse sends within this many ms of the previous
// emailed_at unless force=true. 30 minutes per spec.
const IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000;

const restHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function restGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders });
  if (!res.ok) throw new Error(`REST GET ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function restPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...restHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST PATCH ${path} failed: ${res.status} ${await res.text()}`);
}

async function restPostNoReturn(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...restHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST POST ${path} failed: ${res.status} ${await res.text()}`);
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function userFromJwt(authHeader: string): Promise<{ id: string; email: string } | null> {
  const token = authHeader.replace(/^Bearer\s+/, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { id: u.id, email: u.email } : null;
}

function jsonResponse(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function shortRef(id: string): string {
  return String(id || '').slice(0, 8).toUpperCase();
}

// Derive a first-name token from a full name. Falls back to the local
// part of the email address if full_name is null/empty, then to "there".
function deriveFirstName(fullName: string | null | undefined, email: string | null | undefined): string {
  if (fullName && fullName.trim()) {
    const first = fullName.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email) {
    const local = email.split('@')[0];
    if (local) {
      // Soften common email patterns: lauren.moody → Lauren, l.moody → L
      const tok = local.split(/[._-]/)[0];
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    }
  }
  return 'there';
}

// Auth.users.email lookup. Service-role can read auth.users via the
// admin/users endpoint; cheaper to do it batched against tenant_members
// joined with the users table via the REST view if exposed. For
// simplicity here we go through the admin endpoint when needed.
async function fetchAuthEmails(userIds: string[]): Promise<Record<string, string>> {
  // The /auth/v1/admin/users endpoint paginates through ALL users — too
  // expensive for one-off lookups. Use service-role to query auth.users
  // via the PostgREST table when available. Supabase exposes a public
  // helper view in some setups; fall back to the admin endpoint per id
  // otherwise.
  const out: Record<string, string> = {};
  await Promise.all(userIds.map(async (uid) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      });
      if (!res.ok) return;
      const u = await res.json();
      if (u?.email) out[uid] = u.email;
    } catch {
      // skip — caller treats missing as "no email on file"
    }
  }));
  return out;
}

interface ResolvedRecipient {
  user_id: string;
  email: string;
  full_name: string | null;
  first_name: string;
}

interface ResolutionResult {
  recipients: ResolvedRecipient[];
  resolution: 'sender_active' | 'role_match' | 'command_fallback';
  matched_role_id: string | null;
}

// 4-step resolution chain. Throws on no resolution (caller turns into 422).
async function resolveRecipients(senderId: string, tenantId: string): Promise<ResolutionResult | null> {
  // Step 1 — sender still active on this tenant?
  const senderActive = await restGet<any[]>(
    `tenant_members?user_id=eq.${senderId}&tenant_id=eq.${tenantId}&select=user_id,active&limit=1`
  );
  const senderRow = senderActive?.[0];
  const senderIsActive = senderRow && (senderRow.active === true || senderRow.active === null);
  if (senderIsActive) {
    const profile = (await restGet<any[]>(
      `profiles?id=eq.${senderId}&select=id,full_name`
    ))?.[0];
    const emails = await fetchAuthEmails([senderId]);
    const email = emails[senderId];
    if (email) {
      return {
        resolution: 'sender_active',
        matched_role_id: null,
        recipients: [{
          user_id: senderId,
          email,
          full_name: profile?.full_name ?? null,
          first_name: deriveFirstName(profile?.full_name, email),
        }],
      };
    }
    // Sender row exists + active but no email on auth.users — fall through.
  }

  // Step 2 — sender's most-recent role_id (active or not, ORDER BY updated_at DESC)
  const senderRecent = await restGet<any[]>(
    `tenant_members?user_id=eq.${senderId}&tenant_id=eq.${tenantId}&select=role_id&order=updated_at.desc.nullslast&limit=1`
  );
  const matchedRoleId = senderRecent?.[0]?.role_id || null;

  if (matchedRoleId) {
    // Step 3 — active members with the same role_id
    const sameRole = await restGet<any[]>(
      `tenant_members?tenant_id=eq.${tenantId}&role_id=eq.${matchedRoleId}&select=user_id,active`
    );
    const candidateIds = (sameRole || [])
      .filter((r) => r.active === true || r.active === null)
      .map((r) => r.user_id)
      .filter(Boolean);

    if (candidateIds.length > 0) {
      const emails = await fetchAuthEmails(candidateIds);
      const profilesData = await restGet<any[]>(
        `profiles?id=in.(${candidateIds.join(',')})&select=id,full_name`
      );
      const profileMap: Record<string, string | null> = {};
      (profilesData || []).forEach((p) => { profileMap[p.id] = p.full_name ?? null; });

      const recipients: ResolvedRecipient[] = candidateIds
        .filter((uid) => emails[uid])
        .map((uid) => ({
          user_id: uid,
          email: emails[uid],
          full_name: profileMap[uid] ?? null,
          first_name: deriveFirstName(profileMap[uid], emails[uid]),
        }));

      // Deduplicate by email (paranoia against duplicate tenant_members rows)
      const seen = new Set<string>();
      const unique = recipients.filter((r) => {
        if (seen.has(r.email)) return false;
        seen.add(r.email);
        return true;
      });

      if (unique.length > 0) {
        return {
          resolution: 'role_match',
          matched_role_id: matchedRoleId,
          recipients: unique,
        };
      }
    }
  }

  // Step 4 — COMMAND tier fallback
  const command = await restGet<any[]>(
    `tenant_members?tenant_id=eq.${tenantId}&permission_tier=eq.COMMAND&select=user_id,active`
  );
  const commandIds = (command || [])
    .filter((r) => r.active === true || r.active === null)
    .map((r) => r.user_id)
    .filter(Boolean);

  if (commandIds.length > 0) {
    const emails = await fetchAuthEmails(commandIds);
    const profilesData = await restGet<any[]>(
      `profiles?id=in.(${commandIds.join(',')})&select=id,full_name`
    );
    const profileMap: Record<string, string | null> = {};
    (profilesData || []).forEach((p) => { profileMap[p.id] = p.full_name ?? null; });

    const recipients: ResolvedRecipient[] = commandIds
      .filter((uid) => emails[uid])
      .map((uid) => ({
        user_id: uid,
        email: emails[uid],
        full_name: profileMap[uid] ?? null,
        first_name: deriveFirstName(profileMap[uid], emails[uid]),
      }));

    const seen = new Set<string>();
    const unique = recipients.filter((r) => {
      if (seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    });

    if (unique.length > 0) {
      return {
        resolution: 'command_fallback',
        matched_role_id: null,
        recipients: unique,
      };
    }
  }

  return null;
}

// Compute the email subject + greeting + plain-text + HTML for the given
// resolution. Pure function.
function buildEmail(opts: {
  resolution: 'sender_active' | 'role_match' | 'command_fallback';
  recipients: ResolvedRecipient[];
  vesselName: string;
  supplierName: string;
  orderShortId: string;
  signingUrl: string;
}) {
  const { resolution, recipients, vesselName, supplierName, orderShortId, signingUrl } = opts;
  const isMulti = recipients.length > 1;
  const greeting =
    (resolution === 'sender_active' || (resolution === 'role_match' && !isMulti))
      ? `Hi ${recipients[0]?.first_name || 'there'},`
      : 'Hi team,';

  const subject = `Delivery confirmation needed — ${vesselName} order #${orderShortId}`;

  const bodyText = [
    greeting,
    '',
    `A delivery from ${supplierName} is on its way to ${vesselName}. Sign here on receipt to confirm what arrived:`,
    '',
    signingUrl,
    '',
    'Thanks,',
    'Cargo',
  ].join('\n');

  // Email-client safe HTML — table layout, inline styles, no JS, fonts via
  // system stack. Cargo wordmark hosted on Netlify (existing CDN path used
  // by the supplier portal emails). CTA button uses VML/MSO fallback for
  // Outlook.
  const bodyHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FDF8F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FDF8F4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

          <!-- Wordmark -->
          <tr>
            <td align="center" style="padding:0 0 22px;">
              <img src="${CARGO_WORDMARK_URL}" alt="Cargo" height="22" style="display:block;height:22px;border:0;outline:none;text-decoration:none;"/>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#FFFFFF;border-radius:12px;box-shadow:0 1px 4px rgba(15,23,42,0.06),0 4px 24px rgba(15,23,42,0.04);overflow:hidden;">

              <!-- Header band -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#1E3A5F;padding:22px 28px;">
                    <h1 style="margin:0 0 5px;font-size:19px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;font-family:inherit;">
                      Delivery confirmation needed
                    </h1>
                    <p style="margin:0;font-size:12px;color:#93C5FD;font-family:inherit;">
                      ${escapeHtml(vesselName)} · Order #${escapeHtml(orderShortId)}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:28px;">
                    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#0F172A;font-family:inherit;">
                      ${escapeHtml(greeting)}
                    </p>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#334155;font-family:inherit;">
                      A delivery from <strong>${escapeHtml(supplierName)}</strong> is on its way to <strong>${escapeHtml(vesselName)}</strong>. Sign here on receipt to confirm what arrived.
                    </p>

                    <!-- CTA button -->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
                      <tr>
                        <td bgcolor="#059669" style="border-radius:8px;">
                          <a href="${escapeHtml(signingUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#FFFFFF;background:#059669;border-radius:8px;text-decoration:none;font-family:inherit;letter-spacing:0.01em;">
                            Confirm delivery
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0 0 6px;font-size:11px;color:#94A3B8;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;font-family:inherit;">
                      Or paste this link into your browser
                    </p>
                    <p style="margin:0;font-size:12px;line-height:1.5;color:#475569;word-break:break-all;font-family:'JetBrains Mono',monospace;">
                      <a href="${escapeHtml(signingUrl)}" style="color:#1E3A5F;text-decoration:underline;">${escapeHtml(signingUrl)}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:18px 16px 4px;font-size:11px;color:#94A3B8;font-family:inherit;">
              You're receiving this because you're listed as a contact for ${escapeHtml(vesselName)} on Cargo.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 16px 12px;font-size:11px;color:#CBD5E1;font-family:inherit;">
              Powered by <a href="https://cargotechnology.app" style="color:#94A3B8;text-decoration:none;">Cargo</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, greeting, body_text: bodyText, body_html: bodyHtml, signing_url: signingUrl };
}

// ─── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Supabase env not configured' }, 500);
  }

  // Auth
  const auth = req.headers.get('Authorization') || '';
  const user = await userFromJwt(auth);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Parse body
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const { orderId, force } = body || {};
  if (!orderId) return jsonResponse({ error: 'Missing orderId' }, 400);

  try {
    // Caller must be an active supplier_contacts row for this order's supplier
    const contacts = await restGet<any[]>(
      `supplier_contacts?user_id=eq.${user.id}&select=id,supplier_id,active&limit=1`
    );
    const contact = contacts?.[0];
    if (!contact || !contact.active) {
      return jsonResponse({ error: 'No active supplier contact for caller' }, 403);
    }

    // Fetch order
    const orders = await restGet<any[]>(
      `supplier_orders?id=eq.${orderId}&select=*`
    );
    const order = orders?.[0];
    if (!order) return jsonResponse({ error: 'Order not found' }, 404);
    if (order.supplier_profile_id !== contact.supplier_id) {
      return jsonResponse({ error: 'Order does not belong to your supplier' }, 403);
    }

    // Precondition: delivery note must have been generated. Refuse if not —
    // do NOT auto-regenerate. Surface clearly so the supplier portal UI can
    // gate the email button behind the PDF existing.
    if (!order.delivery_note_pdf_url) {
      return jsonResponse({
        error: 'Delivery note has not been generated yet. Generate it first.',
        code: 'no_delivery_note',
      }, 409);
    }
    if (!order.delivery_signing_token) {
      return jsonResponse({
        error: 'Delivery note has no signing token on record. Regenerate the delivery note.',
        code: 'no_signing_token',
      }, 409);
    }

    // Idempotency check — refuse if last send is within the 30-minute window
    // unless force=true is passed.
    if (!force && order.delivery_note_emailed_at) {
      const lastSent = new Date(order.delivery_note_emailed_at).getTime();
      const elapsed = Date.now() - lastSent;
      if (elapsed < IDEMPOTENCY_WINDOW_MS) {
        const remaining = Math.ceil((IDEMPOTENCY_WINDOW_MS - elapsed) / 1000);
        return jsonResponse({
          ok: true,
          already_sent: true,
          sent_at: order.delivery_note_emailed_at,
          remaining_window_seconds: remaining,
          message: 'Within idempotency window. Pass { force: true } to override.',
        }, 200);
      }
    }

    // Resolve recipients
    const senderId = order.created_by;
    if (!senderId) {
      return jsonResponse({
        error: 'Order has no created_by on record — cannot resolve sender for recipient lookup.',
        code: 'no_sender',
      }, 422);
    }

    const resolved = await resolveRecipients(senderId, order.tenant_id);
    if (!resolved || resolved.recipients.length === 0) {
      return jsonResponse({
        error: 'Cannot resolve recipient for this order.',
        code: 'no_recipient',
        attempted: ['sender_active', 'role_match', 'command_fallback'],
      }, 422);
    }

    // Build email + signing URL
    const signingUrl = `${SITE_URL}/delivery-sign/${order.delivery_signing_token}`;
    const orderShortId = shortRef(order.id);
    const vesselName = order.vessel_name || 'the vessel';

    // Supplier display name
    const profiles = await restGet<any[]>(
      `supplier_profiles?id=eq.${order.supplier_profile_id}&select=id,name`
    );
    const supplierName = profiles?.[0]?.name || 'your supplier';

    const email = buildEmail({
      resolution: resolved.resolution,
      recipients: resolved.recipients,
      vesselName,
      supplierName,
      orderShortId,
      signingUrl,
    });

    const toEmail = resolved.recipients[0].email;
    const bccEmails = resolved.recipients.slice(1).map((r) => r.email);

    // === Real send (Run 3) ===

    if (!RESEND_API_KEY) {
      return jsonResponse({ error: 'RESEND_API_KEY not configured' }, 500);
    }

    const resendPayload: any = {
      from: FROM_EMAIL,
      to: [toEmail],
      subject: email.subject,
      html: email.body_html,
      text: email.body_text,
    };
    if (bccEmails.length > 0) resendPayload.bcc = bccEmails;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    const resendBody = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error('[sendDeliveryNoteEmails] Resend send failed', resendRes.status, resendBody);
      return jsonResponse({
        error: resendBody?.message || `Resend error ${resendRes.status}`,
        resend_status: resendRes.status,
      }, 502);
    }

    const messageId: string = resendBody?.id || '';
    const sentAt = new Date().toISOString();

    // Stamp the order — best-effort. If this fails the email already
    // went out, so we log + still return success rather than misleading
    // the caller into thinking the send didn't happen.
    try {
      await restPatch(`supplier_orders?id=eq.${order.id}`, {
        delivery_note_emailed_at: sentAt,
      });
    } catch (stampErr) {
      console.error('[sendDeliveryNoteEmails] emailed_at stamp failed (email already sent)', stampErr);
    }

    // Activity event — best-effort. Payload shape per Lauren's 9b.7 spec:
    // resolution + matched_role_id are queryable for debugging ("show me
    // orders where rotation fallback fired") and analytics.
    try {
      await restPostNoReturn('supplier_order_activity', {
        order_id: order.id,
        event_type: 'delivery_note_emailed',
        actor_user_id: user.id,
        actor_supplier_contact_id: contact.id,
        actor_role: 'supplier',
        payload: {
          to: resolved.recipients.map((r) => r.email),
          sent_by: senderId,
          resolution: resolved.resolution,
          matched_role_id: resolved.matched_role_id,
          recipient_count: resolved.recipients.length,
          message_id: messageId,
          attached: false,
          force: !!force,
        },
      });
    } catch (logErr) {
      console.error('[sendDeliveryNoteEmails] activity event write failed', logErr);
    }

    return jsonResponse({
      ok: true,
      message_id: messageId,
      sent_to: resolved.recipients.map((r) => r.email),
      recipient_count: resolved.recipients.length,
      resolution: resolved.resolution,
      matched_role_id: resolved.matched_role_id,
      attached: false,
      force: !!force,
      sent_at: sentAt,
    }, 200);

  } catch (err: any) {
    console.error('[sendDeliveryNoteEmails]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});
