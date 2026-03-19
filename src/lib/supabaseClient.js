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
    // FIX: Bypass navigator.locks to prevent orphaned lock timeouts
    // This resolves "Lock acquisition timed out after 10000ms" errors
    // caused by React Strict Mode's double-mount behavior.
    // Server-side session refresh still uses locks where needed.
    lock: async (_name, _acquireTimeout, fn) => {
      // Execute the function immediately without acquiring a Web Lock
      return await fn();
    }
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