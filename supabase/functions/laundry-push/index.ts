// Supabase Edge Function: laundry-push  (COMMITTED, NOT YET DEPLOYED)
//
// Sends web-push notifications to enrolled devices (push_subscriptions). Deploy
// this and set the VAPID secrets only once we're testing together — until then
// it does nothing (it isn't deployed and no cron calls it).
//
// Two modes:
//  • POST { title, body, url, tenant_id? }  → send that message (a test, or a
//    caller-built alert) to the tenant's devices (all devices if no tenant_id).
//  • POST {} (or { scan: true })            → scan laundry_items for items that
//    need attention (overdue / missing / damaged, not delivered) and send each
//    tenant a summary to its devices.
//
// Secrets required at deploy time (set in Supabase → Edge Functions):
//   VAPID_PUBLIC_KEY   (same base64url public key shipped in the client)
//   VAPID_PRIVATE_KEY  (base64url private scalar — server-only, never in repo)
//   VAPID_SUBJECT      (mailto: or https: contact, e.g. mailto:ops@cargo.app)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:ops@cargo.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const bytesToB64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Raw base64url VAPID keys → the JWK pair @negrel/webpush expects.
function vapidJwks() {
  const pub = b64urlToBytes(VAPID_PUBLIC);      // 0x04 || x(32) || y(32)
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] } as JsonWebKey,
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: VAPID_PRIVATE, ext: true, key_ops: ['sign'] } as JsonWebKey,
  };
}

const isAttention = (i: Record<string, unknown>) => i.status !== 'Delivered' && (
  i.priority === 'Urgent'
  || (i.needed_by && new Date(i.needed_by as string).getTime() < Date.now())
  || i.flag === 'missing' || i.flag === 'damaged'
);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ ok: false, error: 'VAPID keys not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
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
    for (const [tid, n] of byTenant) {
      targets.set(tid, { title: 'Laundry needs attention', body: `${n} item${n === 1 ? '' : 's'} overdue or flagged`, url: '/laundry-management-dashboard?filter=attention' });
    }
  }

  const appServer = await webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys: await webpush.importVapidKeys(vapidJwks(), { extractable: false }),
  });

  let sent = 0;
  let pruned = 0;
  for (const [tid, msg] of targets) {
    let q = sb.from('push_subscriptions').select('endpoint, p256dh, auth').eq('topic', 'laundry');
    if (tid) q = q.eq('tenant_id', tid);
    const { data: subs } = await q;
    for (const s of subs || []) {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        const subscriber = appServer.subscribe(subscription as unknown as PushSubscriptionJSON);
        await subscriber.pushTextMessage(JSON.stringify(msg), {});
        sent += 1;
      } catch (err) {
        // 404/410 → subscription is dead; drop it so the list stays clean
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) { await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint); pruned += 1; }
        else console.error('[laundry-push] send failed', err);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, pruned, tenants: targets.size }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
