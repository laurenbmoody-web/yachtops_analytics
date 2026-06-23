// Backwards-compatible alias for the one authenticated Supabase client.
//
// This module used to create its OWN createClient() instance with the default
// auth storageKey, while the rest of the app authenticates through
// lib/supabaseClient.js (storageKey 'supabase.auth.token'). That second client
// never saw the logged-in session, so every RLS-protected read made through it
// ran as the anonymous role and came back empty — e.g. the captain's sea-time
// sign-off queue (is_command_user_in_tenant() is false for anon, so 0 rows).
//
// Re-export the single authenticated singleton so there is exactly one
// GoTrueClient app-wide and every caller shares the same session.
export { supabase } from './supabaseClient';
