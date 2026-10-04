import { createClient } from '@supabase/supabase-js';
import { createReadCache } from './offline/readCache';
import { withOfflineAuth } from './offline/authFallback';
import { idbStore } from './offline/idbStore';
import { reportNetwork, isKnownOffline } from './offline/status';
import { storedSession, storedUserId } from './offline/session';
import { outbox, setOutboxExecutor } from './offline/queue';

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

// Bounded fetch — supabase-js has no request timeout, so a hung auth/data call
// (unreachable endpoint, stalled connection) would wait forever, holding the
// serialAuthLock chain and wedging every later auth op until the tab reloads.
// Abort after 20s so a hang fails fast, the lock settles, and a retry can work.
// If the caller already passed a signal, defer to it (don't double-abort).
const FETCH_TIMEOUT_MS = 20000;
const timeoutFetch = (input, init = {}) => {
  if (init?.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

// Offline reads (layer 1): every read is saved on the device and served back
// when the network is down or stalls — see lib/offline/readCache.js.
const offlineReads = createReadCache({
  store: idbStore,
  isOffline: isKnownOffline,
  report: reportNetwork,
  userId: storedUserId,
  // Offline edits waiting to sync (layer 2) are laid over reads of their table.
  pendingFor: (table) => outbox.pendingFor(table),
});

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
    // Offline: saved reads (layer 1) + a signed-in session that survives an
    // expired token (lib/offline/authFallback.js).
    fetch: withOfflineAuth(offlineReads(timeoutFetch), { getStoredSession: storedSession, report: reportNetwork }),
    headers: {
      'X-Client-Info': 'supabase-js-web'
    }
  }
});

// Offline writes (layer 2): the outbox replays queued ops through this client.
// Ops are plain table writes:
//   { type: 'insert', table, row }                    row carries its client id
//   { type: 'upsert', table, row, onConflict }
//   { type: 'update', table, patch, match }
//   { type: 'delete', table, match }
// `returning: true` hands back the saved row (data) when it runs online.
setOutboxExecutor(async (op) => {
  const t = supabase.from(op.table);
  let q;
  if (op.type === 'insert') q = t.insert(op.row);
  else if (op.type === 'upsert') q = t.upsert(op.row, op.onConflict ? { onConflict: op.onConflict } : undefined);
  else if (op.type === 'update') q = t.update(op.patch).match(op.match);
  else if (op.type === 'delete') q = t.delete().match(op.match);
  else return { error: { message: `unknown outbox op ${op.type}`, code: 'OUTBOX' } };
  if (op.returning) q = q.select();
  const res = await q;
  // An insert replayed after its response was lost already exists: done.
  if (op.type === 'insert' && res.error?.code === '23505') return { data: op.row, error: null };
  return { ...res, data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data };
});

// Saved reads are per user, but clear them on sign-out anyway so a shared
// device keeps nothing of the last person's data.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') idbStore.clear();
});

console.log('[SUPABASE] ✅ Singleton client initialized with lock bypass for browser stability');

function supabaseClient(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: supabaseClient is not implemented yet.', args);
  return null;
}

export { supabaseClient };