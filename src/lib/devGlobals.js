// Dev-only window globals for poking at one-off operations from the
// browser console. Production builds (`import.meta.env.PROD === true`)
// skip this module's side-effects entirely.
//
// Keep this file the single home for `window.__cargo*` hooks so they're
// easy to grep and audit. Each entry below is a short, self-contained
// async lambda — no shared state, no mutual deps.

if (typeof import.meta !== 'undefined' && !import.meta.env.PROD && typeof window !== 'undefined') {
  // ── Trips localStorage→Supabase migration (Phase A2) ─────────────────
  //
  // Manually trigger the migration:        await window.__cargoMigrateTrips()
  // Inspect the migration ledger:          window.__cargoTripsMigrationStatus()
  // Wipe ledger to force re-migration on  window.__cargoResetTripsMigration()
  // next page load (does NOT touch trip data; idempotent re-run is safe).

  window.__cargoMigrateTrips = async () => {
    const [{ migrateTripsToSupabase }, { supabase }] = await Promise.all([
      import('../utils/migrateTripsToSupabase'),
      import('./supabaseClient'),
    ]);
    return migrateTripsToSupabase(supabase);
  };

  window.__cargoTripsMigrationStatus = async () => {
    const { getMigrationStatus } = await import('../utils/migrateTripsToSupabase');
    return getMigrationStatus();
  };

  window.__cargoResetTripsMigration = async () => {
    const { resetMigrationStatus } = await import('../utils/migrateTripsToSupabase');
    resetMigrationStatus();
    // eslint-disable-next-line no-console
    console.info('[trips migration] ledger cleared. Reload to re-run.');
  };
}
