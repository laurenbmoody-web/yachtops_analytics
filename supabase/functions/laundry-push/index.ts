// Supabase Edge Function: laundry-push
//
// Sends push notifications to enrolled devices (push_subscriptions.topic
// = 'laundry') — browsers and the iOS / Android app alike, via
// _shared/push.ts. Called hourly by pg_cron and on-demand for tests.
//
// Two modes:
//  • POST { title, body, url, tenant_id? }  → send that message (a test, or a
//    caller-built alert) to the tenant's devices (all devices if no tenant_id).
//  • POST {} (or { force: true })           → scan laundry_items for items that
//    need attention (urgent / overdue / missing / damaged, not delivered) and
//    push each vessel a summary — but only when it's 4pm in that vessel's own
//    timezone (vessels.timezone). `force: true` bypasses the 4pm gate for tests.
//
// Secrets: see _shared/push.ts (VAPID_* for web, APNS_* for iOS,
// FCM_SERVICE_ACCOUNT for Android). Any one channel is enough to run.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPusher } from '../_shared/push.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const isAttention = (i: Record<string, unknown>) => i.status !== 'Delivered' && (
  i.priority === 'Urgent'
  || (i.needed_by && new Date(i.needed_by as string).getTime() < Date.now())
  || i.flag === 'missing' || i.flag === 'damaged'
);

// The daily attention nudge fires at 4pm in each vessel's own timezone. The
// cron runs hourly; we send to a vessel only when it's currently the 4pm hour
// there (which also tracks DST via the IANA zone).
const SEND_HOUR = 16;
function localHour(tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).formatToParts(new Date());
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '', 10);
    return Number.isFinite(h) ? (h === 24 ? 0 : h) : null;
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const pusher = await createPusher();
  if (!pusher.configured) {
    return new Response(JSON.stringify({ ok: false, error: 'No push channel configured (VAPID / APNs / FCM)' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  // Build (tenant_id -> message) targets.
  const targets = new Map<string | null, { title: string; body: string; url: string }>();
  if (body.title || body.body) {
    targets.set((body.tenant_id as string) || null, {
      title: (body.title as string) || 'Cargo laundry',
      body: (body.body as string) || '',
      url: (body.url as string) || '/laundry-management-dashboard',
    });
  } else {
    const { data: items } = await sb.from('laundry_items')
      .select('tenant_id, status, priority, needed_by, flag')
      .neq('status', 'Delivered')
      .limit(5000);
    const byTenant = new Map<string, number>();
    for (const it of items || []) { if (isAttention(it)) byTenant.set(it.tenant_id, (byTenant.get(it.tenant_id) || 0) + 1); }
    if (byTenant.size) {
      const { data: vs } = await sb.from('vessels').select('tenant_id, timezone').in('tenant_id', [...byTenant.keys()]);
      const tzOf = new Map((vs || []).map((v) => [v.tenant_id, v.timezone]));
      const force = body.force === true; // bypass the 4pm gate for a manual scan test
      for (const [tid, n] of byTenant) {
        const tz = tzOf.get(tid);
        if (!tz) continue;                              // no timezone set → don't guess
        if (!force && localHour(tz) !== SEND_HOUR) continue; // only at 4pm vessel-local
        targets.set(tid, { title: 'Laundry needs attention', body: `${n} item${n === 1 ? '' : 's'} overdue or flagged`, url: '/laundry-management-dashboard?filter=attention' });
      }
    }
  }

  let sent = 0;
  let pruned = 0;
  for (const [tid, msg] of targets) {
    let q = sb.from('push_subscriptions').select('endpoint, p256dh, auth, platform').eq('topic', 'laundry');
    if (tid) q = q.eq('tenant_id', tid);
    const { data: subs } = await q;
    for (const s of subs || []) {
      const result = await pusher.send(s, { ...msg, tag: 'cargo-laundry' });
      if (result === 'sent') sent += 1;
      // The device is no longer registered; drop it so the list stays clean.
      if (result === 'gone') { await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint); pruned += 1; }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, pruned, tenants: targets.size }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
