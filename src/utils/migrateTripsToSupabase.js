// One-shot migration of localStorage trips → Supabase. Phase A2 of the
// trips-out-of-localStorage sprint.
//
// Idempotent. Runs after each successful auth bootstrap. Per-trip outcome
// is recorded in localStorage under a separate key so wiping
// `cargo.trips.v1` itself doesn't lose the migration ledger, and wiping
// the ledger doesn't touch trip data.
//
// Read path is unchanged after this phase ships — Cargo continues to read
// from localStorage. Phase A3 will swap the read path. Until then, both
// stores hold the same data.
//
// The runner trusts the Edge-side RPC for hard guarantees:
//   - Idempotency: legacy_local_id UNIQUE on the trips table means the
//     RPC returns the existing trip uuid if the legacy id was already
//     migrated, even if the local ledger says otherwise. Two tabs racing
//     is therefore safe at the data layer.
//   - Cross-tenant guest filtering: guest_ids that don't belong to the
//     caller's tenant are silently dropped inside the RPC. The runner
//     surfaces the count of dropped guests so the report shows when this
//     happened.
//   - Constraint validation: bad trip_type or inverted dates surface as
//     RPC errors and land in results.errors with the local trip name for
//     debugging.
//
// Module shape:
//   migrateTripsArrayToSupabase(supabase, trips)  — pure, takes pre-loaded trips
//   migrateTripsToSupabase(supabase)              — wrapper, dynamic-imports
//                                                   tripStorage.loadTrips and delegates
//
// The split lets the verification script exercise the runner without
// pulling tripStorage's React/toast deps into a Node import graph. The
// runtime path goes through the wrapper so it benefits from tripStorage's
// auto-migration of older `guestIds: [...]` entries → `guests: [{guestId, ...}]`.

const MIGRATION_STORAGE_KEY = 'cargo.trips.v1.migration';

// ─── Pure helpers (exported for verification + reuse) ──────────────────────

// Map the existing TripType strings to the SQL CHECK constraint values.
// "Friends & Family" appears in older localStorage rows from before the
// frontend enum was tightened; map to the canonical "Friends/Family" so
// the RPC accepts it. Anything unknown falls through to "Other" rather
// than erroring — preserving the user's data is more important than
// preserving an unrecognised label.
export function normaliseTripType(localType) {
  const map = {
    'Owner':            'Owner',
    'Charter':          'Charter',
    'Friends/Family':   'Friends/Family',
    'Friends & Family': 'Friends/Family',
    'Other':            'Other',
  };
  return map[localType] || 'Other';
}

// Pull guestId values from the trip.guests array shape established in
// tripStorage.migrateTripGuestsStructure. Defends against null entries
// and missing guestId fields. Returns a fresh array.
export function extractGuestIds(guestArray) {
  if (!Array.isArray(guestArray)) return [];
  return guestArray
    .filter(g => g && typeof g.guestId === 'string' && g.guestId.length > 0)
    .map(g => g.guestId);
}

export function loadMigrationStatus() {
  try {
    const raw = (typeof localStorage !== 'undefined')
      ? localStorage.getItem(MIGRATION_STORAGE_KEY)
      : null;
    if (!raw) return emptyStatus();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.migratedTripIds) {
      return emptyStatus();
    }
    return parsed;
  } catch {
    return emptyStatus();
  }
}

export function saveMigrationStatus(status) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MIGRATION_STORAGE_KEY, JSON.stringify(status));
  } catch (err) {
    // QuotaExceeded or storage disabled — log and continue. The runner is
    // resilient to a missing ledger; it will just re-attempt next run and
    // the RPC's idempotency guard will return the existing uuid.
    console.error('[trips migration] failed to persist ledger:', err);
  }
}

function emptyStatus() {
  return { migratedTripIds: {}, lastRunAt: null, version: 1 };
}

// ─── Public entry points ───────────────────────────────────────────────────

export function getMigrationStatus() {
  return loadMigrationStatus();
}

export function resetMigrationStatus() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(MIGRATION_STORAGE_KEY);
    }
  } catch (err) {
    console.error('[trips migration] failed to clear ledger:', err);
  }
}

// Pure runner. Takes the trip array directly so callers can use
// tripStorage.loadTrips, a synthetic fixture, or a custom loader.
// Never throws — per-trip errors land in results.errors. Whole-runner
// guard surfaces a single error entry with tripId: null when the
// supabase client is missing.
export async function migrateTripsArrayToSupabase(supabase, trips) {
  const results = { migrated: 0, skipped: 0, errors: [] };

  if (!supabase || typeof supabase.rpc !== 'function') {
    results.errors.push({
      tripId: null,
      tripName: null,
      error: 'No Supabase client provided to migrator',
    });
    return results;
  }

  if (!Array.isArray(trips) || trips.length === 0) return results;

  const status = loadMigrationStatus();

  for (const trip of trips) {
    if (!trip || !trip.id) {
      results.errors.push({
        tripId:   null,
        tripName: trip?.name ?? null,
        error:    'Trip has no local id',
      });
      continue;
    }

    if (status.migratedTripIds[trip.id]) {
      results.skipped++;
      continue;
    }

    // Pre-flight: start_date is NOT NULL on the schema. Older
    // localStorage rows occasionally have startDate: '' rather than a
    // missing key — without this guard the RPC surfaces an opaque
    // "invalid date input syntax" with no user recovery path. Surface
    // a clear message here instead and skip the RPC entirely.
    if (!trip.startDate || !String(trip.startDate).trim()) {
      results.errors.push({
        tripId:   trip.id,
        tripName: trip.name ?? null,
        error:    'Missing required start date — edit trip in app to add one before migration',
      });
      continue;
    }

    // end_date is NOT NULL on the schema too, but the RPC's caller
    // contract accepts null and the backfill / pre-A2 frontend allowed
    // empty strings interchangeably with nulls for open-ended trips.
    // Coerce '' → null on the wire so those rows surface as a clean
    // schema-level NOT NULL violation rather than a date-parse error.
    const endDateForWire = (trip.endDate && String(trip.endDate).trim())
      ? trip.endDate
      : null;

    try {
      const { data: supabaseId, error } = await supabase.rpc(
        'migrate_localstorage_trip',
        {
          p_legacy_id:         String(trip.id),
          p_name:              trip.name ?? '(untitled)',
          p_trip_type:         normaliseTripType(trip.tripType),
          p_start_date:        trip.startDate,
          p_end_date:          endDateForWire,
          p_itinerary_summary: trip.itinerarySummary ?? null,
          p_guest_ids:         extractGuestIds(trip.guests),
        },
      );

      if (error) throw error;
      if (!supabaseId || typeof supabaseId !== 'string') {
        throw new Error('RPC returned no trip uuid');
      }

      status.migratedTripIds[trip.id] = {
        supabaseId,
        migratedAt: new Date().toISOString(),
      };
      saveMigrationStatus(status);
      results.migrated++;
    } catch (err) {
      results.errors.push({
        tripId:   trip.id,
        tripName: trip.name ?? null,
        error:    err?.message ?? String(err),
      });
    }
  }

  status.lastRunAt = new Date().toISOString();
  saveMigrationStatus(status);

  return results;
}

// Runtime entry point. Dynamically imports tripStorage.loadTrips so the
// pure runner above stays Node-importable for the verification script
// without dragging in tripStorage's React/toast deps.
export async function migrateTripsToSupabase(supabase) {
  let trips;
  try {
    const mod = await import('../pages/trips-management-dashboard/utils/tripStorage');
    trips = mod.loadTrips();
  } catch (err) {
    return {
      migrated: 0,
      skipped:  0,
      errors:   [{
        tripId:   null,
        tripName: null,
        error:    `Failed to load localStorage trips: ${err?.message ?? String(err)}`,
      }],
    };
  }
  return migrateTripsArrayToSupabase(supabase, trips);
}
