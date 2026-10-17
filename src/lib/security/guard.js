// Access & security plumbing shared by <AccessGuard /> and the vessel's
// Access & security page.
//
//  • isBetaBuild() — true inside a TestFlight install of the app (the
//    CargoGuard plugin reads the App Store receipt). False on the web and in
//    App Store installs.
//  • onCaptureEvents() — iOS reports screenshots and screen recording; it
//    can't block them, so the app records them instead.
//  • logSecurityEvent() — best-effort; a failed write (offline) is dropped.

import { registerPlugin } from '@capacitor/core';
import { supabase } from '../supabaseClient';
import { isNative, nativePlatform } from '../native/platform';

// Local plugin: ios/App/App/CargoGuardPlugin.swift (iOS only for now).
const CargoGuard = registerPlugin('CargoGuard');

let infoPromise = null;
export function guardInfo() {
  if (!isNative() || nativePlatform() !== 'ios') return Promise.resolve({ testFlight: false, captured: false });
  if (!infoPromise) {
    infoPromise = CargoGuard.getInfo().catch(() => ({ testFlight: false, captured: false }));
  }
  return infoPromise;
}

export const isBetaBuild = async () => !!(await guardInfo()).testFlight;

// fn({ kind: 'screenshot' } | { kind: 'screen_recording', captured }) → unsubscribe
export function onCaptureEvents(fn) {
  if (!isNative() || nativePlatform() !== 'ios') return () => {};
  const handles = [];
  try {
    handles.push(CargoGuard.addListener('screenshot', () => fn({ kind: 'screenshot' })));
    handles.push(CargoGuard.addListener('capture', (d) => fn({ kind: 'screen_recording', captured: !!d?.captured })));
  } catch { /* plugin missing in an older build */ }
  return () => handles.forEach((h) => Promise.resolve(h).then((x) => x?.remove?.()).catch(() => {}));
}

export function deviceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Browser';
}

export function platformLabel() {
  return isNative() ? `app-${nativePlatform()}` : 'web';
}

export async function logSecurityEvent({ tenantId, userId, kind, screen = null }) {
  if (!tenantId || !userId || !kind) return;
  try {
    await supabase.from('security_events').insert({
      tenant_id: tenantId, user_id: userId, kind, screen,
      platform: platformLabel(), device: deviceLabel(),
    });
  } catch { /* best-effort */ }
}

// The Supabase session id inside an access token (one per signed-in device).
export function sessionIdOf(session) {
  try {
    const payload = session?.access_token?.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json.session_id || null;
  } catch { return null; }
}
