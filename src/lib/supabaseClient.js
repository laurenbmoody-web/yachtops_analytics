import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

// Custom storage adapter to handle lock timeouts gracefully
const customStorageAdapter = {
  getItem: (key) => {
    try {
      return window.localStorage?.getItem(key);
    } catch (error) {
      console.warn('[SUPABASE] Storage getItem error:', error);
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage?.setItem(key, value);
    } catch (error) {
      console.warn('[SUPABASE] Storage setItem error:', error);
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage?.removeItem(key);
    } catch (error) {
      console.warn('[SUPABASE] Storage removeItem error:', error);
    }
  }
};

// Serialise auth operations (token refresh, getSession, etc.) within this tab.
// We can't use the default navigator.locks implementation — under React Strict
// Mode's double-mount it produced "Lock acquisition timed out after 10000ms" —
// but we MUST NOT run refreshes concurrently either: parallel refreshes reuse
// the same rotating refresh token, which trips Supabase's reuse detection and
// REVOKES the session (token_revoked), logging the user out mid-session.
//
// A promise-chain mutex gives us mutual exclusion without navigator.locks: each
// locked section waits for the previous to settle. The chain swallows rejections
// so it can never get stuck, while callers still receive fn()'s real result.
let authLockChain = Promise.resolve();
const serialAuthLock = async (_name, _acquireTimeout, fn) => {
  const result = authLockChain.then(fn, fn);
  authLockChain = result.then(() => {}, () => {});
  return result;
};

// Singleton Supabase client with enhanced lock handling
// CRITICAL: This client is created ONCE and reused everywhere
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',        // Token-based (implicit) password recovery
    autoRefreshToken: true,      // Auto-refresh tokens before expiry
    persistSession: true,        // Persist session to localStorage
    detectSessionInUrl: true,    // Detect session from URL (for magic links, recovery, etc.)
    storage: customStorageAdapter, // Custom storage with error handling
    storageKey: 'supabase.auth.token', // Default key
    // In-tab mutex (see serialAuthLock) — serialises refreshes so the rotating
    // refresh token is never used concurrently, while avoiding the navigator.locks
    // timeouts that React Strict Mode's double-mount triggered.
    lock: serialAuthLock,
    // Opt in to passkeys (WebAuthn). Required for auth.signInWithPasskey(),
    // auth.registerPasskey() and the auth.passkey.* namespace — these throw
    // without it. Still gated server-side by the project's Passkeys setting.
    experimental: { passkey: true },
  },
  // Add global options for better error handling
  global: {
    headers: {
      'X-Client-Info': 'supabase-js-web'
    }
  }
});

console.log('[SUPABASE] ✅ Singleton client initialized with lock bypass for browser stability');

function supabaseClient(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: supabaseClient is not implemented yet.', args);
  return null;
}

export { supabaseClient };