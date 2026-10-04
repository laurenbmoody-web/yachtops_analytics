// One sender for every push channel a device can enrol through
// (public.push_subscriptions.platform):
//
//   web      Web Push (VAPID)           — browsers / installed PWA
//   ios      APNs (token auth, HTTP/2)  — the Cargo iOS app
//   android  FCM HTTP v1                — the Cargo Android app
//
// Each channel is optional: a channel whose secrets are missing is skipped,
// so web push keeps working before the app's credentials are set.
//
// Secrets (Supabase → Edge Functions):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT       web
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 text)    ios
//   APNS_BUNDLE_ID (default uk.co.cargotechnology.app)        ios
//   FCM_SERVICE_ACCOUNT (the Firebase service-account JSON)  android
import * as webpush from 'jsr:@negrel/webpush';

declare const Deno: { env: { get: (key: string) => string | undefined } };

export type PushMsg = { title: string; body: string; url: string; tag?: string };
export type PushSub = { endpoint: string; p256dh?: string | null; auth?: string | null; platform?: string | null };
// sent: delivered to the push service · gone: the device is no longer
// registered (delete the row) · failed: transient / config error · skipped:
// that channel isn't configured.
export type PushResult = 'sent' | 'gone' | 'failed' | 'skipped';

const env = (k: string) => Deno.env.get(k) || '';

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
const strToB64url = (s: string) => bytesToB64url(new TextEncoder().encode(s));

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: CryptoKey, alg: AlgorithmIdentifier | EcdsaParams) {
  const input = `${strToB64url(JSON.stringify(header))}.${strToB64url(JSON.stringify(claims))}`;
  const sig = new Uint8Array(await crypto.subtle.sign(alg, key, new TextEncoder().encode(input)));
  return `${input}.${bytesToB64url(sig)}`;
}

// ── Web Push ────────────────────────────────────────────────────────────────

async function webSender() {
  const pub = env('VAPID_PUBLIC_KEY');
  const priv = env('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return null;
  const raw = b64urlToBytes(pub); // 0x04 || x(32) || y(32)
  const x = bytesToB64url(raw.slice(1, 33));
  const y = bytesToB64url(raw.slice(33, 65));
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: env('VAPID_SUBJECT') || 'mailto:ops@cargo.app',
    vapidKeys: await webpush.importVapidKeys({
      publicKey: { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] } as JsonWebKey,
      privateKey: { kty: 'EC', crv: 'P-256', x, y, d: priv, ext: true, key_ops: ['sign'] } as JsonWebKey,
    }, { extractable: false }),
  });
  return async (sub: PushSub, msg: PushMsg): Promise<PushResult> => {
    try {
      const subscriber = appServer.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } } as unknown as Parameters<typeof appServer.subscribe>[0]);
      await subscriber.pushTextMessage(JSON.stringify(msg), {});
      return 'sent';
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) return 'gone';
      console.error('[push:web] send failed', err);
      return 'failed';
    }
  };
}

// ── APNs ────────────────────────────────────────────────────────────────────

async function apnsSender() {
  const keyId = env('APNS_KEY_ID');
  const teamId = env('APNS_TEAM_ID');
  const pem = env('APNS_PRIVATE_KEY');
  if (!keyId || !teamId || !pem) return null;
  const topic = env('APNS_BUNDLE_ID') || 'uk.co.cargotechnology.app';
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // One provider token per invocation (Apple allows reuse for up to an hour).
  const jwt = await signJwt({ alg: 'ES256', kid: keyId }, { iss: teamId, iat: Math.floor(Date.now() / 1000) }, key, { name: 'ECDSA', hash: 'SHA-256' });

  // Debug builds get sandbox tokens; TestFlight / App Store builds get
  // production ones. Try production first and fall back on BadDeviceToken.
  const post = (host: string, sub: PushSub, msg: PushMsg) => fetch(`https://${host}/3/device/${sub.endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(msg.tag ? { 'apns-collapse-id': msg.tag.slice(0, 64) } : {}),
    },
    body: JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, url: msg.url }),
  });

  return async (sub: PushSub, msg: PushMsg): Promise<PushResult> => {
    try {
      let res = await post('api.push.apple.com', sub, msg);
      let reason = res.ok ? '' : ((await res.json().catch(() => ({}))) as { reason?: string }).reason || '';
      if (!res.ok && reason === 'BadDeviceToken') {
        res = await post('api.sandbox.push.apple.com', sub, msg);
        reason = res.ok ? '' : ((await res.json().catch(() => ({}))) as { reason?: string }).reason || '';
      }
      if (res.ok) return 'sent';
      if (res.status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken') return 'gone';
      console.error('[push:apns] send failed', res.status, reason);
      return 'failed';
    } catch (err) {
      console.error('[push:apns] send failed', err);
      return 'failed';
    }
  };
}

// ── FCM ─────────────────────────────────────────────────────────────────────

async function fcmSender() {
  const raw = env('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  let sa: { client_email: string; private_key: string; project_id: string };
  try { sa = JSON.parse(raw); } catch { console.error('[push:fcm] FCM_SERVICE_ACCOUNT is not valid JSON'); return null; }

  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }, key, { name: 'RSASSA-PKCS1-v1_5' });
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const { access_token } = await tokRes.json().catch(() => ({})) as { access_token?: string };
  if (!access_token) { console.error('[push:fcm] could not get an access token', tokRes.status); return null; }

  return async (sub: PushSub, msg: PushMsg): Promise<PushResult> => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: sub.endpoint,
            notification: { title: msg.title, body: msg.body },
            data: { url: msg.url },
            android: {
              priority: 'high',
              notification: { channel_id: 'cargo_default', color: '#C65A1A', ...(msg.tag ? { tag: msg.tag } : {}) },
            },
          },
        }),
      });
      if (res.ok) return 'sent';
      const err = await res.json().catch(() => ({})) as { error?: { status?: string; details?: { errorCode?: string }[] } };
      const code = err.error?.details?.find((d) => d.errorCode)?.errorCode || err.error?.status || '';
      if (res.status === 404 || code === 'UNREGISTERED') return 'gone';
      console.error('[push:fcm] send failed', res.status, code);
      return 'failed';
    } catch (err) {
      console.error('[push:fcm] send failed', err);
      return 'failed';
    }
  };
}

// Build the sender once per invocation (credentials, provider tokens), then
// call send() per subscription.
export async function createPusher() {
  const [web, ios, android] = await Promise.all([
    webSender().catch((e) => { console.error('[push:web] setup failed', e); return null; }),
    apnsSender().catch((e) => { console.error('[push:apns] setup failed', e); return null; }),
    fcmSender().catch((e) => { console.error('[push:fcm] setup failed', e); return null; }),
  ]);
  const senders: Record<string, typeof web> = { web, ios, android };
  return {
    configured: !!(web || ios || android),
    send: (sub: PushSub, msg: PushMsg): Promise<PushResult> => {
      const fn = senders[sub.platform || 'web'];
      return fn ? fn(sub, msg) : Promise.resolve('skipped');
    },
  };
}
