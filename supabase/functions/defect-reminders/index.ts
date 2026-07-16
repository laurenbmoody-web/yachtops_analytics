// Supabase Edge Function: defect-reminders
//
// The EMAIL layer for High/Critical defects. The in-app side runs in-database
// (public.defects_run_daily_reminders, scheduled via pg_cron). This function
// emails the same nudges — but only for High/Critical priority — and also sends
// an immediate email when a High/Critical defect is assigned to someone.
//
// Modes (POST body):
//   { }                                   → CRON: email today's High/Critical
//                                           repair-due + quote-signoff reminders
//                                           (deduped once per day via
//                                           defect_reminder_log channel='email').
//   { mode:'assignment', defectId,        → REAL-TIME: email the given users that
//     userIds:[...], title, priority }      a High/Critical defect was assigned.
//   { test_to:'you@example.com' }         → DRY: one sample email, nothing logged.
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL?
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

const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE_URL                  = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const FROM = 'Cargo Defects <defects@cargotechnology.co.uk>';

type PlanRow = {
  defect_id: string;
  tenant_id: string;
  recipient_user_id: string;
  kind: string;
  title_txt: string;
  msg: string;
  priority: string;
};

const svc = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function emailPlan(run: string): Promise<PlanRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/defects_email_plan`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_run: run }),
  });
  if (!res.ok) throw new Error(`plan rpc ${res.status}: ${await res.text()}`);
  return await res.json() as PlanRow[];
}

async function logEmailSends(rows: { defect_id: string; tenant_id: string; recipient_user_id: string; kind: string }[], run: string): Promise<void> {
  if (!rows.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/defect_reminder_log`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(rows.map((r) => ({
      tenant_id: r.tenant_id, defect_id: r.defect_id, recipient_user_id: r.recipient_user_id,
      kind: r.kind, channel: 'email', sent_on: run,
    }))),
  }).catch(() => {});
}

// profiles.email first; fall back to the canonical auth login email.
async function resolveEmail(userId: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=email`, { headers: svc }).catch(() => null);
  const j = res && res.ok ? await res.json().catch(() => []) : [];
  let email = (j && j[0] && j[0].email) || '';
  if (!email) {
    const r2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: svc }).catch(() => null);
    if (r2 && r2.ok) { const u = await r2.json().catch(() => null); email = u?.email || ''; }
  }
  return email;
}

// Kept defect emails on? Missing prefs row = on.
async function defectEmailOn(userId: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${userId}&select=email_defect_reminders`,
    { headers: svc },
  ).catch(() => null);
  const j = res && res.ok ? await res.json().catch(() => []) : [];
  return !(j && j[0] && j[0].email_defect_reminders === false);
}

function buildEmail(headline: string, intro: string, defectId: string, priority: string, isTest = false) {
  const ctaUrl = `${SITE_URL}/defects/${defectId}`;
  const params = {
    preheader: intro.slice(0, 120),
    headline,
    headlineEmphasis: priority === 'Critical' ? 'Critical' : 'High',
    intro: (isTest ? '[TEST EMAIL] ' : '') + intro,
    ctaLabel: 'View defect',
    ctaUrl,
    footerNote: 'You are receiving this because this defect is High/Critical priority. Manage defect emails in your notification settings.',
  };
  return { html: renderCargoEmail(params), text: renderCargoEmailText(params), ctaUrl };
}

async function sendResend(to: string[], subject: string, html: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let body: { test_to?: string; mode?: string; defectId?: string; userIds?: string[]; title?: string; priority?: string } = {};
  try { body = await req.json(); } catch { /* empty = cron */ }
  const run = new Date().toISOString().slice(0, 10);

  try {
    // ── DRY test ──────────────────────────────────────────────────────────
    if (body.test_to) {
      const built = buildEmail('Defect needs attention', 'A sample High-priority defect notification.', '00000000-0000-0000-0000-000000000000', 'High', true);
      const r = await sendResend([body.test_to.trim()], '[TEST] Defect needs attention', built.html, built.text);
      return new Response(JSON.stringify({ ok: r.ok, mode: 'test', resend_status: r.status, resend: r.body }), { status: r.ok ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Real-time assignment email ───────────────────────────────────────
    if (body.mode === 'assignment') {
      const { defectId, userIds = [], title = 'A defect', priority = 'High' } = body;
      if (!defectId || !['High', 'Critical'].includes(priority)) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      let sent = 0; const failures: string[] = [];
      for (const uid of [...new Set(userIds)].filter(Boolean)) {
        if (!(await defectEmailOn(uid))) continue;
        const to = await resolveEmail(uid);
        if (!to) { failures.push(`${uid}: no address`); continue; }
        const built = buildEmail('Defect assigned to you', `${title} — a ${priority}-priority defect has been assigned to you.`, defectId, priority);
        const r = await sendResend([to], `${priority} defect assigned — ${title}`, built.html, built.text);
        if (r.ok) sent++; else failures.push(`${uid}: resend ${r.status}`);
      }
      return new Response(JSON.stringify({ ok: true, mode: 'assignment', sent, failures }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── CRON: daily High/Critical reminder emails ────────────────────────
    const plan = await emailPlan(run);
    let sent = 0; const logged: PlanRow[] = []; const failures: string[] = [];
    for (const row of plan) {
      if (!(await defectEmailOn(row.recipient_user_id))) continue;
      const to = await resolveEmail(row.recipient_user_id);
      if (!to) { failures.push(`${row.defect_id}: no address`); continue; }
      const built = buildEmail(row.title_txt, row.msg, row.defect_id, row.priority);
      const subj = `${row.priority} defect — ${row.kind === 'quote_signoff' ? 'quote awaiting sign-off' : 'repair due'}`;
      const r = await sendResend([to], subj, built.html, built.text);
      if (r.ok) { sent++; logged.push(row); } else { failures.push(`${row.defect_id}: resend ${r.status}`); }
    }
    await logEmailSends(logged, run);

    return new Response(JSON.stringify({ ok: true, mode: 'cron', candidates: plan.length, sent, failures }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[defect-reminders] error', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
