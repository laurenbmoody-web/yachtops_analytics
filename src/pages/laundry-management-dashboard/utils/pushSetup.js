// Web-push enrolment for this device. Registers the notifications-only service
// worker, asks permission, subscribes with the app's VAPID public key, and
// stores the subscription so the server can reach this device.
//
// The VAPID PUBLIC key is safe to ship in the client; the matching PRIVATE key
// lives only as a server secret (never in the repo).

import { supabase } from '../../../lib/supabaseClient';

const VAPID_PUBLIC_KEY = 'BHlm_g_nx6ciCFdicN33Z0wTdjsNgvtzA-wOMCLLSyZGebS8Jvt1bpbj7UBqsZIhIn2AzF--b2Ft3adBL3WPRNs';
const SW_URL = '/push-sw.js';

export const pushSupported = () => typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function tenantId() {
  try {
    const { data } = await supabase.rpc('get_my_context');
    return data?.[0]?.tenant_id || null;
  } catch { return null; }
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  return existing || navigator.serviceWorker.register(SW_URL);
}

// Is this device currently subscribed (permission granted + a live push sub)?
export async function isPushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

// Turn alerts on for this device. Returns { ok, reason }.
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };

  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = sub.toJSON();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  const tid = await tenantId();
  if (!userId || !tid) { try { await sub.unsubscribe(); } catch { /* noop */ } return { ok: false, reason: 'no_session' }; }

  const { error } = await supabase.from('push_subscriptions').upsert({
    tenant_id: tid,
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    topic: 'laundry',
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) { console.error('[push] save subscription failed', error); return { ok: false, reason: 'save_failed' }; }
  return { ok: true };
}

// Turn alerts off for this device.
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
    return { ok: true };
  } catch (e) {
    console.error('[push] disable failed', e);
    return { ok: false };
  }
}
