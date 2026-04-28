// useTripsMigration — auto-runs the localStorage→Supabase trips migration
// once per page session, after auth + tenant bootstrap completes.
//
// The runner itself is idempotent (RPC's legacy_local_id UNIQUE + ledger
// in localStorage), so re-mounting on route changes is safe. The
// module-level `hasRunThisSession` guard makes the common case truly
// one-shot — second mount sees the flag and short-circuits without
// re-reading localStorage or calling Supabase.
//
// Errors are logged to console; the UI is never gated on this. A failure
// here means localStorage stays the source of truth for the affected
// trips and the next session retries them automatically.

import { useEffect, useState, useRef } from 'react';
import { migrateTripsToSupabase } from '../utils/migrateTripsToSupabase';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// Module-scoped — survives route re-mounts but resets on full page reload.
// Without this, navigating between protected pages would re-fire the
// runner even though it already finished.
let hasRunThisSession = false;

export function useTripsMigration() {
  const { user, session, activeTenantId, bootstrapComplete } = useAuth();
  const [status, setStatus] = useState({
    running:  false,
    complete: false,
    results:  null,
  });
  const startedRef = useRef(false);

  useEffect(() => {
    // Wait for auth + tenant resolution. No tenant = no point running
    // (the RPC will reject for "no active tenant membership" anyway).
    if (!bootstrapComplete) return;
    if (!session || !user || !activeTenantId) return;

    if (hasRunThisSession || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      setStatus({ running: true, complete: false, results: null });
      try {
        const results = await migrateTripsToSupabase(supabase);
        if (cancelled) return;

        hasRunThisSession = true;
        setStatus({ running: false, complete: true, results });

        if (results.migrated > 0 || results.errors.length > 0) {
          // eslint-disable-next-line no-console
          console.info(
            `[trips migration] migrated ${results.migrated}, ` +
            `skipped ${results.skipped}, errors ${results.errors.length}`,
          );
        }
        if (results.errors.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[trips migration] errors:', results.errors);
        }
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[trips migration] runner threw:', err);
        setStatus({ running: false, complete: false, results: null });
      }
    })();

    return () => { cancelled = true; };
  }, [bootstrapComplete, session, user, activeTenantId]);

  return status;
}
