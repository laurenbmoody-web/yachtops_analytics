// Supabase Edge Function: submit-feedback
//
// Receives a beta feedback note (text and/or a voice note) from any authenticated
// user and does two things, server-side, so the client never needs elevated
// rights or the owner's address:
//   1. Stores it — uploads any audio to the private feedback-audio bucket and
//      inserts a row into public.feedback (the in-app inbox).
//   2. Emails the product owner the note + page context (+ a signed link to the
//      voice note when present).
//
// Auth: caller's JWT identifies the filer; the row is attributed to them.
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

const FROM = 'Cargo Feedback <feedback@cargotechnology.co.uk>';
const OWNER_EMAIL = 'lauren.moody@hotmail.co.uk';
const AUDIO_BUCKET = 'feedback-audio';

const NAVY = '#1C1B3A';
const TERRA = '#C65A1A';
const CREAM_BG = '#F4F1EC';
const WHITE = '#FFFFFF';
const BORDER = '#E2DDD4';
const MUTED = '#8B8478';
const SERIF = "'DM Serif Display', Georgia, serif";
const SANS = "'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif";

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function callerUser(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.id ? { id: u.id, email: u.email || '' } : null;
}

async function supaGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

async function supaInsert(table: string, rows: unknown[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data[0] : null;
}

// Decode a base64 (optionally data-URL-prefixed) string to bytes.
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const extForMime = (mime: string): string => {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'webm';
};

async function uploadAudio(path: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${AUDIO_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: bytes,
  }).catch(() => null);
  return !!res && res.ok;
}

async function signedAudioUrl(path: string, expiresIn = 60 * 60 * 24 * 7): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${AUDIO_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null;
}

function renderEmail(opts: {
  message: string; kind: string; filerName: string; filerEmail: string;
  vesselName: string; pagePath: string; pageTitle: string; audioUrl: string | null;
  viewport: string; userAgent: string; appVersion: string;
}): string {
  const row = (label: string, value: string) => value
    ? `<tr><td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${MUTED};width:120px;vertical-align:top;">${escapeHtml(label)}</td>
         <td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${NAVY};">${escapeHtml(value)}</td></tr>`
    : '';
  const audioBlock = opts.audioUrl
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;background:${CREAM_BG};border:1px solid ${BORDER};border-radius:8px;"><tr><td style="padding:14px 18px;font-family:${SANS};font-size:13px;color:${NAVY};">
         &#127908;&nbsp; <strong>Voice note attached.</strong> <a href="${escapeHtml(opts.audioUrl)}" style="color:${TERRA};">Listen &rarr;</a>
         <span style="color:${MUTED};">(link valid 7 days)</span>
       </td></tr></table>`
    : '';
  const messageBlock = opts.message
    ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;background:${WHITE};border:1px solid ${BORDER};border-left:3px solid ${TERRA};border-radius:6px;"><tr><td style="padding:16px 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:${NAVY};white-space:pre-wrap;">${escapeHtml(opts.message)}</td></tr></table>`
    : (opts.audioUrl ? '' : `<p style="font-family:${SANS};font-size:14px;color:${MUTED};">(No message text.)</p>`);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${CREAM_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CREAM_BG};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:${WHITE};border:1px solid ${BORDER};border-radius:6px;">
        <tr><td style="height:6px;background:${TERRA};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:34px 40px;">
          <p style="margin:0 0 4px;font-family:${SANS};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${TERRA};font-weight:700;">Beta feedback</p>
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:400;font-size:24px;line-height:1.2;color:${NAVY};">New note from ${escapeHtml(opts.filerName || 'a crew member')}</h1>
          ${messageBlock}
          ${audioBlock}
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:10px 0 0;border-top:1px solid ${BORDER};padding-top:8px;">
            ${row('From', [opts.filerName, opts.filerEmail].filter(Boolean).join(' · '))}
            ${row('Vessel', opts.vesselName)}
            ${row('Page', opts.pageTitle ? `${opts.pageTitle} (${opts.pagePath})` : opts.pagePath)}
            ${row('Device', [opts.viewport, opts.appVersion ? `v${opts.appVersion}` : ''].filter(Boolean).join(' · '))}
            ${row('Agent', opts.userAgent)}
          </table>
          <p style="margin:22px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">Reply to this email to follow up with ${escapeHtml(opts.filerName || 'them')} directly.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Not configured' }, 500);

  let body: {
    tenantId?: string;
    message?: string;
    kind?: string;
    audioBase64?: string;
    audioMime?: string;
    audioMs?: number;
    pagePath?: string;
    pageTitle?: string;
    userAgent?: string;
    viewport?: string;
    appVersion?: string;
    userName?: string;
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const caller = await callerUser(req);
  if (!caller) return json({ error: 'Not authenticated' }, 401);

  const message = (body.message || '').trim().slice(0, 8000);
  const hasAudio = !!body.audioBase64;
  if (!message && !hasAudio) return json({ error: 'Empty feedback' }, 400);

  const tenantId = body.tenantId || null;
  const kind = hasAudio ? 'voice' : 'text';

  // ── Upload the voice note (if any) ──
  let audioPath: string | null = null;
  let audioContentType = body.audioMime || 'audio/webm';
  if (hasAudio) {
    try {
      const bytes = base64ToBytes(body.audioBase64 as string);
      // Path: {tenantId|_}/{userId}-{ms}.{ext} — unique without Date/random.
      const folder = tenantId || '_';
      const stamp = `${caller.id}-${body.audioMs || bytes.length}`;
      audioPath = `${folder}/${stamp}.${extForMime(audioContentType)}`;
      const ok = await uploadAudio(audioPath, bytes, audioContentType);
      if (!ok) audioPath = null;
    } catch (_e) {
      audioPath = null;
    }
  }

  // ── Filer identity + vessel name (best-effort) ──
  const profiles = await supaGet(`profiles?id=eq.${caller.id}&select=full_name,email`) || [];
  const profile = profiles[0] || {};
  const filerName = body.userName || profile.full_name || '';
  const filerEmail = caller.email || profile.email || '';

  let vesselName = '';
  if (tenantId) {
    const vessels = await supaGet(`vessels?tenant_id=eq.${tenantId}&select=name`) || [];
    vesselName = vessels[0]?.name || '';
  }

  // ── Store the row (in-app inbox) ──
  const inserted = await supaInsert('feedback', [{
    tenant_id: tenantId,
    user_id: caller.id,
    user_email: filerEmail || null,
    user_name: filerName || null,
    kind,
    message: message || null,
    audio_path: audioPath,
    audio_ms: body.audioMs || null,
    page_path: body.pagePath || null,
    page_title: body.pageTitle || null,
    user_agent: body.userAgent || null,
    viewport: body.viewport || null,
    app_version: body.appVersion || null,
  }]);

  // ── Email the owner (best-effort; storing already succeeded) ──
  if (RESEND_API_KEY) {
    const audioUrl = audioPath ? await signedAudioUrl(audioPath) : null;
    const subjectBits = message
      ? message.replace(/\s+/g, ' ').slice(0, 60)
      : 'Voice note';
    const subject = `Feedback: ${subjectBits}${message.length > 60 ? '…' : ''}`;
    const payload: Record<string, unknown> = {
      from: FROM,
      to: [OWNER_EMAIL],
      subject,
      html: renderEmail({
        message, kind, filerName, filerEmail,
        vesselName, pagePath: body.pagePath || '', pageTitle: body.pageTitle || '',
        audioUrl, viewport: body.viewport || '', userAgent: body.userAgent || '',
        appVersion: body.appVersion || '',
      }),
      text: `New beta feedback from ${filerName || 'a crew member'} (${filerEmail}).\n\n`
        + `${message || '(voice note only)'}\n\n`
        + `Vessel: ${vesselName || '—'}\nPage: ${body.pageTitle || ''} ${body.pagePath || ''}\n`
        + (audioUrl ? `Voice note (7-day link): ${audioUrl}\n` : ''),
    };
    if (filerEmail) payload.reply_to = filerEmail;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((e) => { console.error('[submit-feedback] resend failed', e); });
  }

  return json({ ok: true, id: inserted?.id || null, stored: !!inserted });
});
