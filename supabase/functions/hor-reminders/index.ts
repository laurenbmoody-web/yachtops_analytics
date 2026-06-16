// Supabase Edge Function: hor-reminders
//
// The EMAIL layer for the Hours-of-Rest reminder engine. The in-app side runs
// in-database (public.hor_run_daily_reminders, scheduled via pg_cron); this
// function handles the daily OVERDUE escalation emails that the SQL engine
// cannot send itself.
//
// Flow:
//   1. Call the RPC hor_run_daily_reminders(current_date, p_commit) with the
//      service role. It returns the day's plan; the 'email' rows (kind=overdue)
//      are the ones that need an email today (the SQL engine never logs email
//      rows, so they keep surfacing until we send + log them here).
//   2. For each overdue subject, resolve their address and send one Resend
//      email, then log it to hor_reminder_log (channel=email) so it isn't
//      re-sent the same day.
//
// Modes (POST body):
//   { "test_to": "you@example.com" }  → DRY: commits nothing, sends ONE sample
//                                       email to that address, and reports how
//                                       many real emails the live run WOULD send.
//   { } or { "commit": true }         → LIVE: commits the in-app pass (deduped),
//                                       sends real overdue emails, logs them.
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
const FROM = 'Cargo Hours of Rest <hor@cargotechnology.co.uk>';

type PlanRow = {
  tenant_id: string;
  subject_user_id: string;
  subject_name: string;
  recipient_user_id: string;
  period_year: number;
  period_month: number;
  kind: string;
  channel: string;
  title: string;
  message: string;
  action_url: string;
};

async function callEngine(commit: boolean): Promise<PlanRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hor_run_daily_reminders`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_commit: commit }),
  });
  if (!res.ok) throw new Error(`engine rpc ${res.status}: ${await res.text()}`);
  return await res.json() as PlanRow[];
}

async function logEmailSends(rows: PlanRow[]): Promise<void> {
  if (!rows.length) return;
  const today = new Date().toISOString().slice(0, 10);
  await fetch(`${SUPABASE_URL}/rest/v1/hor_reminder_log`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(rows.map((r) => ({
      tenant_id: r.tenant_id,
      subject_user_id: r.subject_user_id,
      recipient_user_id: r.subject_user_id,
      period_year: r.period_year,
      period_month: r.period_month,
      kind: 'overdue',
      channel: 'email',
      sent_on: today,
    }))),
  }).catch(() => {});
}

// profiles.email first; fall back to the canonical auth login email.
async function resolveEmail(userId: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=email`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => null);
  const j = res && res.ok ? await res.json().catch(() => []) : [];
  let email = (j && j[0] && j[0].email) || '';
  if (!email) {
    const r2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    }).catch(() => null);
    if (r2 && r2.ok) { const u = await r2.json().catch(() => null); email = u?.email || ''; }
  }
  return email;
}

function monthLabel(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function buildEmail(name: string, y: number, m: number, actionUrl: string, isTest: boolean) {
  const lbl = monthLabel(y, m);
  const ctaUrl = `${SITE_URL}${actionUrl}`;
  const intro = `Your Hours of Rest for ${lbl} have not been signed off yet. Please sign them off${name && name !== 'Crew' ? `, ${name}` : ''} — this reminder repeats daily until it's done.`;
  const params = {
    preheader: `Action needed: sign off your ${lbl} Hours of Rest`,
    headline: `Hours of Rest overdue`,
    intro: (isTest ? '[TEST EMAIL] ' : '') + intro,
    ctaLabel: 'Sign off now',
    ctaUrl,
    footerNote: 'You are receiving this because your monthly Hours of Rest are still open. Your Chief and Command have been notified.',
  };
  return { html: renderCargoEmail(params), text: renderCargoEmailText(params), subject: `Hours of Rest overdue — ${lbl}`, ctaUrl };
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { test_to?: string; commit?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body = live */ }
  const testTo = (body.test_to || '').trim();
  const isTest = !!testTo;

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test = dry (commit nothing); Live = commit the in-app pass too.
    const plan = await callEngine(isTest ? false : true);
    const emailRows = plan.filter((r) => r.channel === 'email' && r.kind === 'overdue');

    // ---- TEST: one sample email to the requester, nothing committed/logged ----
    if (isTest) {
      const sample = emailRows[0];
      const y = sample ? sample.period_year : new Date().getUTCFullYear();
      const m = sample ? sample.period_month : new Date().getUTCMonth() + 1;
      const built = buildEmail(sample ? sample.subject_name : 'Crew', y, m, sample ? sample.action_url : '/profile?tab=hor', true);
      const r = await sendResend([testTo], `[TEST] ${built.subject}`, built.html, built.text);
      return new Response(JSON.stringify({
        ok: r.ok, mode: 'test', test_to: testTo, resend_status: r.status,
        would_send_real_emails: emailRows.length,
        sample_subject_name: sample?.subject_name ?? null,
        resend: r.body,
      }), { status: r.ok ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---- LIVE: one email per overdue subject, then log the sends ----
    let sent = 0; const logged: PlanRow[] = []; const failures: string[] = [];
    for (const row of emailRows) {
      const to = await resolveEmail(row.subject_user_id);
      if (!to) { failures.push(`${row.subject_name}: no address`); continue; }
      const built = buildEmail(row.subject_name, row.period_year, row.period_month, row.action_url, false);
      const r = await sendResend([to], built.subject, built.html, built.text);
      if (r.ok) { sent++; logged.push(row); }
      else { failures.push(`${row.subject_name}: resend ${r.status}`); }
    }
    await logEmailSends(logged); // only log what actually sent

    return new Response(JSON.stringify({ ok: true, mode: 'live', overdue_candidates: emailRows.length, sent, failures }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[hor-reminders] error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
