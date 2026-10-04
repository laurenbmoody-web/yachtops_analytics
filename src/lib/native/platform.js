// Where is Cargo running — a browser, or the iOS / Android app shell
// (Capacitor)? Everything native-only checks isNative() first, so the web build
// behaves exactly as before.

import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

// The public web address of Cargo. Inside the app, window.location.origin is
// capacitor://localhost (iOS) or https://localhost (Android) — useless in a
// link someone else opens, a QR code, or an auth email. Anything that leaves
// the device must be built from publicOrigin(), never location.origin.
const PUBLIC_APP_URL = (import.meta.env?.VITE_PUBLIC_APP_URL || 'https://cargotechnology.netlify.app').replace(/\/+$/, '');

export function publicOrigin() {
  if (typeof window === 'undefined' || !window.location) return PUBLIC_APP_URL;
  return isNative() ? PUBLIC_APP_URL : window.location.origin;
}

export const publicUrl = (path = '/') => `${publicOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
