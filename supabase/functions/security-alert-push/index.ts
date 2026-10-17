// Supabase Edge Function: security-alert-push
//
// Pushes a new security alert (public.security_alerts) to the Cargo console
// admins' devices (public.platform_admins) and to alert-only accounts
// (public.security_alert_recipients) — never to a vessel's crew as such. Called by the security_events trigger
// (public.security_event_alert) via pg_net with { alert_id }.
//
// Only the alert id is accepted: the text comes from the database, each alert
// is pushed once (pushed_at), and only while it is fresh, so a caller can't
// use this to send arbitrary messages.
//
// Pushes open /cargo/security (Cargo internal → Security alerts).
//
// Secrets: see _shared/push.ts (VAPID_* for web, APNS_* for iOS,
// FCM_SERVICE_ACCOUNT for Android).
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TITLES: Record<string, string> = {
  screen_recording: 'Screen recording',
  screenshots: 'Screenshots',
  too_many_devices: 'Device limit hit',
  many_devices: 'Possible shared account',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const alertId = Number(body.alert_id);
  if (!Number.isFinite(alertId)) return json({ error: 'alert_id required' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Claim the alert: unpushed and created in the last 10 minutes.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: alert } = await sb.from('security_alerts')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', alertId).is('pushed_at', null).gte('created_at', since)
    .select('id, reason, detail')
    .maybeSingle();
  if (!alert) return json({ ok: true, skipped: 'already pushed, stale or unknown' });

  const pusher = await createPusher();
  if (!pusher.configured) return json({ ok: false, error: 'No push channel configured' }, 500);

  // Cargo console admins + alert-only accounts → every device they have enrolled.
  const { data: admins } = await sb.from('platform_admins').select('email');
  const emails = (admins || []).map((a) => String(a.email || '').toLowerCase()).filter(Boolean);
  const { data: allProfs } = emails.length ? await sb.from('profiles').select('id, email') : { data: [] };
  const profs = (allProfs || []).filter((p) => emails.includes(String(p.email || '').toLowerCase()));
  const { data: extra } = await sb.from('security_alert_recipients').select('user_id').is('removed_at', null);
  const ids = [...new Set([...profs.map((p) => p.id), ...(extra || []).map((r) => r.user_id)])];
  if (!ids.length) return json({ ok: true, sent: 0, reason: 'no recipients' });

  const { data: subs } = await sb.from('push_subscriptions')
    .select('endpoint, p256dh, auth, platform').in('user_id', ids);

  // One push per device, even if a device is enrolled under several topics.
  const seen = new Set<string>();
  let sent = 0;
  let pruned = 0;
  for (const s of subs || []) {
    if (seen.has(s.endpoint)) continue;
    seen.add(s.endpoint);
    const result = await pusher.send(s, {
      title: `Cargo console · ${TITLES[alert.reason] || 'Security alert'}`,
      body: alert.detail || 'New security alert',
      url: '/cargo/security',
      tag: `cargo-security-${alert.id}`,
    });
    if (result === 'sent') sent += 1;
    if (result === 'gone') { await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint); pruned += 1; }
  }
  return json({ ok: true, sent, pruned });
});
