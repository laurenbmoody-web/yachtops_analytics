// Router-aware glue for the iOS / Android app. Renders nothing; mounted once
// inside <BrowserRouter> and inert on the web.
//
//  • Universal / app links (https://cargotechnology.netlify.app/…) and
//    cargo://… open the matching screen — including Supabase auth links
//    (password reset, invite, email change), whose tokens arrive in the URL.
//  • A tap on a push notification opens the screen it points at.
//  • Every sign-in (re)enrols the phone for push.
//  • Android back button: close the viewer sheet → go back → leave the app.
//  • The marketing site isn't part of the app: '/' goes to sign-in.

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import { supabase } from '../supabaseClient';
import { showToast } from '../../utils/toast';
import { isNative, nativePlatform } from './platform';
import { setNativeNavigate } from './windows';
import { ensureNativePush, listenForNativePush } from './push';

// https://host/path?q#h or cargo://path?q#h → '/path?q#h'
function appPath(raw) {
  try {
    const u = new URL(raw);
    const path = u.protocol === 'cargo:' ? `/${u.host}${u.pathname}`.replace(/\/+$/, '') || '/' : u.pathname;
    return { path: `${path}${u.search}`, search: u.searchParams, hash: u.hash.replace(/^#/, '') };
  } catch { return null; }
}

// Supabase puts the session in the link (#access_token… implicit flow, or
// ?code= PKCE). The client only reads window.location at start-up, so a link
// that arrives while the app is running has to be applied by hand.
async function applyAuthFromLink(search, hash) {
  const h = new URLSearchParams(hash);
  if (h.get('access_token') && h.get('refresh_token')) {
    await supabase.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
    return h.get('type');
  }
  const code = search.get('code');
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
    return search.get('type');
  }
  return null;
}

const AUTH_LANDING = { invite: '/set-password', recovery: '/reset-password' };

const NativeBridge = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isNative()) return undefined;
    setNativeNavigate((path) => navigate(path));

    const openLink = async (raw) => {
      const link = appPath(raw);
      if (!link) return;
      let type = null;
      try { type = await applyAuthFromLink(link.search, link.hash); } catch (e) { console.error('[native] auth link failed', e); }
      navigate(AUTH_LANDING[type] || link.path);
    };

    const handles = [
      App.addListener('appUrlOpen', ({ url }) => { openLink(url); }),
      App.addListener('backButton', ({ canGoBack }) => {
        const sheet = document.querySelector('.nv-sheet');
        if (sheet) sheet.remove();
        else if (canGoBack) window.history.back();
        else App.exitApp();
      }),
    ];
    const stopPush = listenForNativePush({
      onOpen: (url) => (url.startsWith('/') ? navigate(url) : openLink(url)),
      // iOS presents foreground notifications itself (presentationOptions);
      // Android shows nothing while the app is open, so surface it in-app.
      onForeground: (n) => {
        if (nativePlatform() === 'android' && (n?.title || n?.body)) showToast([n.title, n.body].filter(Boolean).join(' — '), 'info');
      },
    });

    // Push enrolment follows the session — once per signed-in user per launch
    // (supabase re-emits SIGNED_IN on resume).
    let enrolledFor = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id || null;
      if (event === 'SIGNED_OUT') enrolledFor = null;
      if (uid && uid !== enrolledFor && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        enrolledFor = uid;
        // Out of the auth callback: supabase calls made inside it deadlock.
        setTimeout(() => { ensureNativePush(); }, 0);
      }
    });

    return () => {
      setNativeNavigate(null);
      handles.forEach((h) => h.then((x) => x.remove()));
      stopPush();
      sub?.subscription?.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    if (isNative() && location.pathname === '/') navigate('/login', { replace: true });
  }, [location.pathname, navigate]);

  return null;
};

export default NativeBridge;
