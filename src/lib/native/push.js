// Native push enrolment for the iOS / Android app (APNs / FCM via
// @capacitor/push-notifications). The device token is stored in
// push_subscriptions (platform 'ios' | 'android', endpoint = token) and the
// same edge functions as web push deliver to it via _shared/push.ts.
//
// Unlike the browser, the app enrols every signed-in crew member's phone
// (topic 'general' → job reminders and anything addressed to them). The
// per-device "Laundry alerts" switch on the profile flips that same row to
// topic 'laundry', which laundry-push additionally targets —
// pages/laundry-management-dashboard/utils/pushSetup.js delegates here.

import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../supabaseClient';
import { nativePlatform } from './platform';

const TOKEN_KEY = 'cargo.nativePushToken';
const TOPIC_KEY = 'cargo.nativePushTopic';
const ASKED_KEY = 'cargo.nativePushAsked';
const CHANNEL_ID = 'cargo_default'; // matches the FCM default channel in AndroidManifest.xml

const read = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v ? window.localStorage.setItem(k, v) : window.localStorage.removeItem(k); } catch { /* noop */ } };

async function tenantId() {
  try {
    const { data } = await supabase.rpc('get_my_context');
    return data?.[0]?.tenant_id || null;
  } catch { return null; }
}

async function permission(prompt) {
  let { receive } = await PushNotifications.checkPermissions();
  if (prompt && (receive === 'prompt' || receive === 'prompt-with-rationale')) {
    write(ASKED_KEY, '1');
    ({ receive } = await PushNotifications.requestPermissions());
  }
  return receive;
}

// register() answers through events, not its promise — wrap that.
function registerForToken() {
  return new Promise((resolve, reject) => {
    const handles = [];
    const done = (fn, v) => { handles.forEach((h) => h.then((x) => x.remove())); fn(v); };
    handles.push(PushNotifications.addListener('registration', (t) => done(resolve, t.value)));
    handles.push(PushNotifications.addListener('registrationError', (e) => done(reject, new Error(e?.error || 'registration failed'))));
    PushNotifications.register().catch((e) => done(reject, e));
  });
}

async function saveToken(token, topic) {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  const tid = await tenantId();
  if (!userId || !tid) return { ok: false, reason: 'no_session' };
  const { error } = await supabase.from('push_subscriptions').upsert({
    tenant_id: tid,
    user_id: userId,
    endpoint: token,
    p256dh: null,
    auth: null,
    platform: nativePlatform(),
    topic,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) { console.error('[push:native] save token failed', error); return { ok: false, reason: 'save_failed' }; }
  const old = read(TOKEN_KEY);
  if (old && old !== token) await supabase.from('push_subscriptions').delete().eq('endpoint', old);
  write(TOKEN_KEY, token);
  write(TOPIC_KEY, topic);
  return { ok: true };
}

// Enrol (or refresh) this device for the signed-in user. Called on every
// sign-in / launch: tokens rotate (reinstall, OS restore, FCM refresh), so
// the current one is always re-saved. Asks for permission once, ever.
export async function ensureNativePush({ topic } = {}) {
  try {
    const receive = await permission(!read(ASKED_KEY));
    if (receive !== 'granted') return { ok: false, reason: receive === 'denied' ? 'denied' : 'dismissed' };
    if (nativePlatform() === 'android') {
      await PushNotifications.createChannel({ id: CHANNEL_ID, name: 'Cargo', importance: 4, visibility: 1 }).catch(() => {});
    }
    return await saveToken(await registerForToken(), topic || read(TOPIC_KEY) || 'general');
  } catch (e) {
    console.error('[push:native] register failed', e);
    return { ok: false, reason: 'register_failed' };
  }
}

// Sign-out: detach this phone from the account so the next person to sign in
// on it doesn't get the previous user's alerts. Must run while still signed in
// (RLS: a user deletes only their own rows).
export async function detachNativePush() {
  const token = read(TOKEN_KEY);
  if (token) await supabase.from('push_subscriptions').delete().eq('endpoint', token);
  write(TOKEN_KEY, null);
  write(TOPIC_KEY, null);
}

// ── The profile's per-device "Laundry alerts" switch ─────────────────────────

export async function isNativeLaundryPush() {
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return receive === 'granted' && !!read(TOKEN_KEY) && read(TOPIC_KEY) === 'laundry';
  } catch { return false; }
}

export async function setNativeLaundryPush(on) {
  if (on) {
    // An explicit tap: ask again even if the first-launch prompt was skipped.
    const receive = await permission(true).catch(() => 'denied');
    if (receive !== 'granted') return { ok: false, reason: receive === 'denied' ? 'denied' : 'dismissed' };
  }
  return ensureNativePush({ topic: on ? 'laundry' : 'general' });
}

// Tap on a notification → open the screen it points at. Foreground arrivals
// (Android shows nothing on its own while the app is open) → onForeground.
export function listenForNativePush({ onOpen, onForeground }) {
  const handles = [
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action?.notification?.data?.url;
      if (url) onOpen(url);
    }),
    PushNotifications.addListener('pushNotificationReceived', (n) => onForeground?.(n)),
  ];
  return () => handles.forEach((h) => h.then((x) => x.remove()));
}
