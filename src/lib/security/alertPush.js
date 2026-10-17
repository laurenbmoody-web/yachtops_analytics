// "Get alerts on this device" (Cargo console → Security alerts).
//
// Security alerts are pushed to every device of the Cargo console admins and
// of the alert-only accounts (security-alert-push), whatever topic the device
// is on — so this only has to make sure this device is enrolled, freshly:
//   • app: (re)register the phone, asking for permission if needed;
//   • browser: drop any old subscription (one made with an earlier key fails
//     silently) and subscribe again, keeping the device's existing topic.

import { supabase } from '../supabaseClient';
import { isNative } from '../native/platform';
import { ensureNativePush } from '../native/push';

const VAPID_PUBLIC_KEY = 'BHlm_g_nx6ciCFdicN33Z0wTdjsNgvtzA-wOMCLLSyZGebS8Jvt1bpbj7UBqsZIhIn2AzF--b2Ft3adBL3WPRNs';
const SW_URL = '/push-sw.js';

const b64ToBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const alertPushSupported = () => isNative() || (typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);

export async function enableAlertsOnThisDevice() {
  if (isNative()) return ensureNativePush({ prompt: true });
  if (!alertPushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return { ok: false, reason: 'no_session' };

  const reg = (await navigator.serviceWorker.getRegistration(SW_URL)) || (await navigator.serviceWorker.register(SW_URL));
  await navigator.serviceWorker.ready;

  // Replace any existing subscription; keep its topic and vessel if it had a row.
  let topic = 'security';
  let tenantId = null;
  const old = await reg.pushManager.getSubscription();
  if (old) {
    const { data: row } = await supabase.from('push_subscriptions').select('topic, tenant_id')
      .eq('endpoint', old.endpoint).maybeSingle();
    if (row?.topic) topic = row.topic;
    if (row?.tenant_id) tenantId = row.tenant_id;
    await supabase.from('push_subscriptions').delete().eq('endpoint', old.endpoint);
    try { await old.unsubscribe(); } catch { /* already gone */ }
  }

  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    tenant_id: tenantId,
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    platform: 'web',
    topic,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) { console.error('[alerts] save subscription failed', error); return { ok: false, reason: 'save_failed' }; }
  return { ok: true };
}
