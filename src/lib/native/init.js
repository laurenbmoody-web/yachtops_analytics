// Start-up for the iOS / Android app shell; a no-op in the browser. Runs
// before React renders (src/index.jsx).

import { isNative, nativePlatform } from './platform';
import { installFileShims } from './files';
import { installWindowShims } from './windows';
import { installFetchShim } from './net';
import { detachNativePush } from './push';
import { supabase } from '../supabaseClient';

export function initNative() {
  if (!isNative()) return;
  const root = document.documentElement;
  root.classList.add('cap-native', `cap-${nativePlatform()}`);

  installFileShims();
  installWindowShims();
  installFetchShim();

  // Every sign-out path (there are many) detaches this phone from push first,
  // while the session still allows deleting the user's own row.
  const signOut = supabase.auth.signOut.bind(supabase.auth);
  supabase.auth.signOut = async (...args) => {
    try { await detachNativePush(); } catch (e) { console.warn('[native] push detach failed', e); }
    return signOut(...args);
  };
}
