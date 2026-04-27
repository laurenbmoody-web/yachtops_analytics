#!/usr/bin/env node
// Verification script for src/utils/migrateTripsToSupabase.js.
//
// The codebase has @testing-library/* deps but no test runner installed
// (no vitest/jest in package.json, no `test` script). Bringing one in
// just for these checks is heavyweight, so this script imports the
// pure entry point (migrateTripsArrayToSupabase) and exercises every
// case from the user's spec against in-memory mocks for `localStorage`
// and the Supabase client. tripStorage.loadTrips is bypassed entirely
// so this script doesn't need to resolve React/toast deps in Node.
//
// Run from repo root:   node scripts/verify-trips-migration.mjs
// Exits 0 on all-pass, 1 on any failure.

import assert from 'node:assert/strict';

// ─── In-memory shims ───────────────────────────────────────────────────────

class MemoryStorage {
  constructor(initial = {}) { this.data = { ...initial }; }
  getItem(k)    { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; }
  setItem(k, v) { this.data[k] = String(v); }
  removeItem(k) { delete this.data[k]; }
  clear()       { this.data = {}; }
}

function makeSupabaseStub({ rpcImpl }) {
  return { rpc: async (fn, params) => rpcImpl(fn, params) };
}

async function withMockedEnv(localStorageData, run) {
  globalThis.localStorage = new MemoryStorage(localStorageData);
  // Bust the ESM cache so each test sees a fresh module-scoped state.
  const stamp = `?t=${Date.now()}_${Math.random()}`;
  const mod = await import('../src/utils/migrateTripsToSupabase.js' + stamp);
  return run(mod);
}

// ─── Tiny test runner ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ─── Cases ─────────────────────────────────────────────────────────────────

console.log('\nPure helpers:');

await test('normaliseTripType maps the canonical strings', async () => {
  await withMockedEnv({}, async (mod) => {
    assert.equal(mod.normaliseTripType('Owner'),            'Owner');
    assert.equal(mod.normaliseTripType('Charter'),          'Charter');
    assert.equal(mod.normaliseTripType('Friends/Family'),   'Friends/Family');
    assert.equal(mod.normaliseTripType('Other'),            'Other');
  });
});

await test("normaliseTripType maps 'Friends & Family' → 'Friends/Family'", async () => {
  await withMockedEnv({}, async (mod) => {
    assert.equal(mod.normaliseTripType('Friends & Family'), 'Friends/Family');
  });
});

await test('normaliseTripType falls back to Other on unknown', async () => {
  await withMockedEnv({}, async (mod) => {
    assert.equal(mod.normaliseTripType('Mystery'), 'Other');
    assert.equal(mod.normaliseTripType(undefined), 'Other');
    assert.equal(mod.normaliseTripType(null),      'Other');
  });
});

await test('extractGuestIds filters missing/empty guestIds', async () => {
  await withMockedEnv({}, async (mod) => {
    assert.deepEqual(mod.extractGuestIds([]),   []);
    assert.deepEqual(mod.extractGuestIds(null), []);
    assert.deepEqual(mod.extractGuestIds([
      { guestId: 'a' },
      { guestId: '' },
      { guestId: null },
      { someOther: 'x' },
      null,
      { guestId: 'b' },
    ]), ['a', 'b']);
  });
});

console.log('\nRunner:');

await test('Empty trips → 0 migrated, 0 skipped', async () => {
  await withMockedEnv({}, async (mod) => {
    const supa = makeSupabaseStub({
      rpcImpl: async () => { throw new Error('should not be called'); },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, []);
    assert.deepEqual(res, { migrated: 0, skipped: 0, errors: [] });
  });
});

await test('3 trips, all new → all 3 migrated, ledger updated', async () => {
  const trips = [
    { id: 't1', name: 'Med July',   tripType: 'Charter',          startDate: '2026-07-01', endDate: '2026-07-14', guests: [{ guestId: 'g1' }] },
    { id: 't2', name: 'Owner Aug',  tripType: 'Owner',            startDate: '2026-08-01', endDate: '2026-08-10', guests: [] },
    { id: 't3', name: 'F&F Sep',    tripType: 'Friends & Family', startDate: '2026-09-01', endDate: '2026-09-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    const calls = [];
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => {
        calls.push({ fn, params });
        return { data: 'srv-' + params.p_legacy_id, error: null };
      },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(res.migrated, 3);
    assert.equal(res.skipped, 0);
    assert.deepEqual(res.errors, []);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].fn, 'migrate_localstorage_trip');
    assert.equal(calls[2].params.p_trip_type, 'Friends/Family');
    const status = mod.getMigrationStatus();
    assert.equal(status.migratedTripIds.t1.supabaseId, 'srv-t1');
    assert.equal(status.migratedTripIds.t2.supabaseId, 'srv-t2');
    assert.equal(status.migratedTripIds.t3.supabaseId, 'srv-t3');
  });
});

await test('3 trips, 2 already in ledger → 1 migrated, 2 skipped', async () => {
  const trips = [
    { id: 't1', name: 'A', tripType: 'Owner', startDate: '2026-01-01', endDate: '2026-01-05', guests: [] },
    { id: 't2', name: 'B', tripType: 'Owner', startDate: '2026-02-01', endDate: '2026-02-05', guests: [] },
    { id: 't3', name: 'C', tripType: 'Owner', startDate: '2026-03-01', endDate: '2026-03-05', guests: [] },
  ];
  const ledger = {
    migratedTripIds: {
      t1: { supabaseId: 'srv-t1', migratedAt: '2026-04-26T00:00:00.000Z' },
      t2: { supabaseId: 'srv-t2', migratedAt: '2026-04-26T00:00:00.000Z' },
    },
    lastRunAt: '2026-04-26T00:00:00.000Z',
    version: 1,
  };
  await withMockedEnv({
    'cargo.trips.v1.migration': JSON.stringify(ledger),
  }, async (mod) => {
    const calls = [];
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => {
        calls.push(params.p_legacy_id);
        return { data: 'srv-' + params.p_legacy_id, error: null };
      },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(res.migrated, 1);
    assert.equal(res.skipped, 2);
    assert.deepEqual(res.errors, []);
    assert.deepEqual(calls, ['t3']);
  });
});

await test('3 trips, 1 RPC errors → 2 migrated, 1 in errors', async () => {
  const trips = [
    { id: 't1', name: 'OK',  tripType: 'Owner', startDate: '2026-01-01', endDate: '2026-01-05', guests: [] },
    { id: 't2', name: 'Bad', tripType: 'Owner', startDate: '2026-02-01', endDate: '2026-02-05', guests: [] },
    { id: 't3', name: 'OK2', tripType: 'Owner', startDate: '2026-03-01', endDate: '2026-03-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => {
        if (params.p_legacy_id === 't2') {
          return { data: null, error: { message: 'simulated check violation' } };
        }
        return { data: 'srv-' + params.p_legacy_id, error: null };
      },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(res.migrated, 2);
    assert.equal(res.skipped, 0);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].tripId, 't2');
    assert.equal(res.errors[0].tripName, 'Bad');
    assert.match(res.errors[0].error, /simulated check violation/);
    const status = mod.getMigrationStatus();
    assert.ok(status.migratedTripIds.t1);
    assert.ok(status.migratedTripIds.t3);
    assert.equal(status.migratedTripIds.t2, undefined);
  });
});

await test("trip with 'Friends & Family' type → 'Friends/Family' on the wire", async () => {
  const trips = [
    { id: 't1', name: 'F&F', tripType: 'Friends & Family', startDate: '2026-01-01', endDate: '2026-01-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let received;
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => { received = params; return { data: 'srv-1', error: null }; },
    });
    await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(received.p_trip_type, 'Friends/Family');
  });
});

await test('Missing endDate → null on the wire', async () => {
  const trips = [
    { id: 't1', name: 'No end', tripType: 'Owner', startDate: '2026-01-01', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let received;
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => { received = params; return { data: 'srv-1', error: null }; },
    });
    await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(received.p_end_date, null);
  });
});

await test("endDate: '' → coerced to null, trip migrates successfully", async () => {
  const trips = [
    { id: 't1', name: 'Empty end', tripType: 'Owner', startDate: '2026-02-01', endDate: '', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let received;
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => { received = params; return { data: 'srv-1', error: null }; },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(received.p_end_date, null);
    assert.equal(res.migrated, 1);
    assert.equal(res.errors.length, 0);
  });
});

await test("endDate: '   ' (whitespace) → coerced to null", async () => {
  const trips = [
    { id: 't1', name: 'Whitespace end', tripType: 'Owner', startDate: '2026-02-01', endDate: '   ', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let received;
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => { received = params; return { data: 'srv-1', error: null }; },
    });
    await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(received.p_end_date, null);
  });
});

await test("startDate: '' → recorded as error with clear message, no RPC call", async () => {
  const trips = [
    { id: 't1', name: 'No start', tripType: 'Owner', startDate: '', endDate: '2026-01-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let rpcCalled = false;
    const supa = makeSupabaseStub({
      rpcImpl: async () => { rpcCalled = true; return { data: 'srv-1', error: null }; },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(rpcCalled, false, 'RPC should not be called when startDate is empty');
    assert.equal(res.migrated, 0);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].tripId, 't1');
    assert.equal(res.errors[0].tripName, 'No start');
    assert.match(res.errors[0].error, /Missing required start date/);
  });
});

await test('Missing startDate key → recorded as error, no RPC call', async () => {
  const trips = [
    { id: 't1', name: 'Missing start', tripType: 'Owner', endDate: '2026-01-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let rpcCalled = false;
    const supa = makeSupabaseStub({
      rpcImpl: async () => { rpcCalled = true; return { data: 'srv-1', error: null }; },
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(rpcCalled, false);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0].error, /Missing required start date/);
  });
});

await test('Empty guests array → empty array on the wire', async () => {
  const trips = [
    { id: 't1', name: 'No guests', tripType: 'Owner', startDate: '2026-01-01', endDate: '2026-01-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    let received;
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => { received = params; return { data: 'srv-1', error: null }; },
    });
    await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.deepEqual(received.p_guest_ids, []);
  });
});

await test('Guests with no guestId field → filtered out before RPC', async () => {
  const trips = [
    { id: 't1', name: 'Mixed', tripType: 'Owner', startDate: '2026-01-01', endDate: '2026-01-05',
      guests: [
        { guestId: 'g-real-1' },
        { isActive: true },
        { guestId: '' },
        { guestId: null },
        { guestId: 'g-real-2', isActive: false },
      ],
    },
  ];
  await withMockedEnv({}, async (mod) => {
    let received;
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => { received = params; return { data: 'srv-1', error: null }; },
    });
    await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.deepEqual(received.p_guest_ids, ['g-real-1', 'g-real-2']);
  });
});

await test('Trip with no id → recorded as error, others succeed', async () => {
  const trips = [
    { id: 't1', name: 'OK', tripType: 'Owner', startDate: '2026-01-01', endDate: '2026-01-05', guests: [] },
    { name: 'No id',         tripType: 'Owner', startDate: '2026-02-01', endDate: '2026-02-05', guests: [] },
  ];
  await withMockedEnv({}, async (mod) => {
    const supa = makeSupabaseStub({
      rpcImpl: async (fn, params) => ({ data: 'srv-' + params.p_legacy_id, error: null }),
    });
    const res = await mod.migrateTripsArrayToSupabase(supa, trips);
    assert.equal(res.migrated, 1);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].tripName, 'No id');
    assert.match(res.errors[0].error, /no local id/i);
  });
});

await test('Whole-runner failure when no supabase client is provided', async () => {
  await withMockedEnv({}, async (mod) => {
    const res = await mod.migrateTripsArrayToSupabase(null, [{ id: 't1', name: 'X' }]);
    assert.equal(res.migrated, 0);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0].error, /No Supabase client/);
  });
});

await test('resetMigrationStatus clears the ledger but not trip data', async () => {
  const trips = [{ id: 't1', name: 'A', tripType: 'Owner', startDate: '2026-01-01', endDate: '2026-01-05', guests: [] }];
  const ledger = { migratedTripIds: { t1: { supabaseId: 'srv-t1', migratedAt: 'x' } }, lastRunAt: 'x', version: 1 };
  await withMockedEnv({
    'cargo.trips.v1':           JSON.stringify(trips),
    'cargo.trips.v1.migration': JSON.stringify(ledger),
  }, async (mod) => {
    mod.resetMigrationStatus();
    assert.equal(globalThis.localStorage.getItem('cargo.trips.v1.migration'), null);
    assert.notEqual(globalThis.localStorage.getItem('cargo.trips.v1'),       null);
  });
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.name}`);
    console.log(`    ${f.err.stack ?? f.err.message}`);
  }
  process.exit(1);
}
process.exit(0);
