// Supabase Edge Function: job-reminder-push
//
// The buzz half of Remind Me. public.jobs_run_due_reminders (pg_cron, every
// five minutes) does the deciding and writes the bell row; this runs straight
// after it and pushes the same thing to the recipient's enrolled devices.
//
// The split matters: the notification row is the record and is written whether
// or not anyone has a device enrolled, so a reminder is never lost to a push
// that failed. The push is only the nudge towards it.
//
// pushed_at stops a retry ringing the same phone twice.
//
// Modes (POST body):
//   { }                          → CRON: push reminders sent in the last 15
//                                  minutes that have not been pushed yet.
//   { test_user_id: '<uuid>' }   → DRY: one sample push to that user's
//                                  devices, nothing marked.
//
// Secrets (already set for laundry-push):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
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
const bytesToB64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Raw base64url VAPID keys → the JWK pair @negrel/webpush expects.
function vapidJwks() {
  const pub = b64urlToBytes(VAPID_PUBLIC); // 0x04 || x(32) || y(32)
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] } as JsonWebKey,
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: VAPID_PRIVATE, ext: true, key_ops: ['sign'] } as JsonWebKey,
  };
}

type Msg = { title: string; body: string; url: string };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ ok: false, error: 'VAPID keys not configured' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  // user_id → what to say, and which reminder rows it covers.
  const perUser = new Map<string, { msg: Msg; ids: string[] }>();
  const testUser = (body.test_user_id as string) || '';

  if (testUser) {
    perUser.set(testUser, {
      msg: { title: 'Reminder', body: '[TEST] A job reminder would look like this.', url: '/team-jobs-management' },
      ids: [],
    });
  } else {
    // Just-fired reminders. The 15-minute window is three sweeps' worth, so a
    // single failed run still gets picked up on the next one.
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: due, error } = await sb
      .from('job_reminders')
      .select('id, user_id, job_id, note, sent_at, team_jobs(title)')
      .eq('state', 'sent')
      .is('pushed_at', null)
      .gte('sent_at', since)
      .limit(500);
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    for (const r of due || []) {
      const title = (r as { team_jobs?: { title?: string } }).team_jobs?.title || 'A job';
      const note = (r.note as string) || '';
      const existing = perUser.get(r.user_id as string);
      if (existing) {
        // Several at once reads better as a count than as a stack of buzzes.
        existing.ids.push(r.id as string);
        existing.msg = {
          title: 'Job reminders',
          body: `${existing.ids.length} jobs need you`,
          url: '/team-jobs-management',
        };
      } else {
        perUser.set(r.user_id as string, {
          msg: {
            title: 'Reminder',
            body: note ? `${title} — ${note}` : title,
            url: `/team-jobs-management?job=${r.job_id}`,
          },
          ids: [r.id as string],
        });
      }
    }
  }

  const appServer = await webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys: await webpush.importVapidKeys(vapidJwks(), { extractable: false }),
  });

  let sent = 0;
  let pruned = 0;
  const marked: string[] = [];

  for (const [userId, { msg, ids }] of perUser) {
    // Every device this person has enrolled, whatever topic enrolled it — the
    // phone that took laundry alerts is the same phone.
    const { data: subs } = await sb
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId);

    for (const s of subs || []) {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        const subscriber = appServer.subscribe(subscription as unknown as PushSubscriptionJSON);
        await subscriber.pushTextMessage(JSON.stringify(msg), {});
        sent += 1;
      } catch (err) {
        // 404/410 → the subscription is dead; drop it so the list stays clean
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          pruned += 1;
        } else {
          console.error('[job-reminder-push] send failed', err);
        }
      }
    }

    // Marked whether or not a device answered: the bell row is already
    // written, and re-pushing the same reminder every five minutes forever
    // because nobody has a device enrolled would be worse than silence.
    marked.push(...ids);
  }

  if (marked.length) {
    await sb.from('job_reminders').update({ pushed_at: new Date().toISOString() }).in('id', marked);
  }

  return new Response(JSON.stringify({ ok: true, sent, pruned, recipients: perUser.size, marked: marked.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
