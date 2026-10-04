// node --test src/lib/offline/outbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, combine } from './outbox.js';

// Keyed by op id, like the IndexedDB store.
function memStore(initial = []) {
  const map = new Map(initial.map((o) => [o.id || o.key, o]));
  return { map, all: async () => [...map.values()], put: async (o) => { map.set(o.id, o); }, delete: async (id) => { map.delete(id); } };
}

const OFFLINE = { error: { message: 'TypeError: Failed to fetch', details: '', code: '' }, status: 0 };
const RLS = { error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 };
const day = (date, segs) => ({ key: `hor_work_entries|t1|u1|${date}`, table: 'hor_work_entries', type: 'upsert', match: { entry_date: date }, row: { entry_date: date, work_segments: segs } });

function setup({ net = 'online', initial, user = 'u1' } = {}) {
  const state = { net, user, calls: [], rejected: [] };
  const store = memStore(initial);
  const box = createOutbox({
    store,
    userId: () => state.user,
    now: () => 1000 + state.calls.length,
    execute: async (op) => {
      state.calls.push(op.row?.work_segments ?? op.type);
      if (state.net === 'offline') return OFFLINE;
      if (state.net === 'throw') throw new TypeError('Failed to fetch');
      if (state.net === 'rls') return RLS;
      return { data: op.row, error: null };
    },
    onRejected: (op, err) => state.rejected.push([op.key, err.code]),
  });
  return { state, store, box };
}

test('online: writes straight through, nothing queued', async () => {
  const { box, store } = setup();
  const r = await box.submit(day('2026-10-03', [1]));
  assert.equal(r.queued, false);
  assert.equal(store.map.size, 0);
});

test('online real rejection still throws (caller shows its error)', async () => {
  const { box, store } = setup({ net: 'rls' });
  await assert.rejects(box.submit(day('2026-10-03', [1])), (e) => e.code === '42501');
  assert.equal(store.map.size, 0);
});

test('offline: queued (both postgrest error shape and thrown fetch), survives restart, syncs later', async () => {
  const { box, store, state } = setup({ net: 'offline' });
  assert.equal((await box.submit(day('2026-10-03', [1]))).queued, true);
  state.net = 'throw';
  assert.equal((await box.submit(day('2026-10-04', [2]))).queued, true);
  assert.equal(store.map.size, 2);
  assert.equal(box.pendingFor('hor_work_entries').length, 2);

  // App restarts offline → ops reload from the device.
  const again = setup({ net: 'online', initial: [...store.map.values()] });
  await again.box.ready;
  assert.equal(again.box.pendingCount(), 2);
  await again.box.flush();
  assert.equal(again.box.pendingCount(), 0);
  assert.equal(again.store.map.size, 0);
  assert.deepEqual(again.state.calls, [[1], [2]]);
});

test('latest edit of a day wins; only it is sent', async () => {
  const { box, state } = setup({ net: 'offline' });
  await box.submit(day('2026-10-03', [1]));
  await box.submit(day('2026-10-03', [1, 2]));
  await box.submit(day('2026-10-03', [1, 2, 3]));
  assert.equal(box.pendingCount(), 1);
  state.net = 'online'; state.calls.length = 0;
  await box.flush();
  assert.deepEqual(state.calls, [[1, 2, 3]]);
});

test('flush stops at the first network failure and keeps everything', async () => {
  const { box, state } = setup({ net: 'offline' });
  await box.submit(day('2026-10-03', [1]));
  await box.submit(day('2026-10-04', [2]));
  await box.flush();
  assert.equal(box.pendingCount(), 2);
  assert.equal(state.calls.length, 3); // 2 submits + 1 flush attempt, then stopped
});

test('server rejects a queued op on sync → dropped and reported, the rest still sync', async () => {
  const { box, state } = setup({ net: 'offline' });
  await box.submit(day('2026-10-03', [1]));
  await box.submit(day('2026-10-04', [2]));
  state.net = 'rls'; // e.g. the month was locked while this phone was at sea
  await box.flush();
  assert.equal(box.pendingCount(), 0);
  assert.deepEqual(state.rejected, [['hor_work_entries|t1|u1|2026-10-03', '42501'], ['hor_work_entries|t1|u1|2026-10-04', '42501']]);
});

test('only the signed-in user’s ops are replayed or shown', async () => {
  const { box, state } = setup({ net: 'offline' });
  await box.submit(day('2026-10-03', [1]));
  state.user = 'u2';
  assert.equal(box.pendingCount(), 0);
  state.net = 'online'; state.calls.length = 0;
  await box.flush();
  assert.deepEqual(state.calls, []);
  state.user = 'u1';
  await box.flush();
  assert.deepEqual(state.calls, [[1]]);
});

test('an edit made while that day is syncing is not lost', async () => {
  const store = memStore();
  let release;
  const sent = [];
  let online = false;
  const box = createOutbox({
    store,
    userId: () => 'u1',
    execute: async (op) => {
      if (!online) return OFFLINE;
      sent.push(op.row.work_segments);
      if (sent.length === 1) await new Promise((r) => { release = r; });
      return { data: op.row };
    },
  });
  await box.submit(day('2026-10-03', [1]));
  online = true;
  const flushing = box.flush();
  await new Promise((r) => setTimeout(r, 0));
  await box.submit(day('2026-10-03', [9])); // edited again mid-sync
  release();
  await flushing;
  await new Promise((r) => setTimeout(r, 0));
  await box.flush();
  assert.deepEqual(sent, [[1], [9]]);
  assert.equal(box.pendingCount(), 0);
});

test('combine: offline edits of one row fold into one op', () => {
  const ins = { key: 'k', type: 'insert', row: { id: 'j1', title: 'A', status: 'pending' }, createdAt: 1, seq: 1, label: 'New job' };
  const up1 = { key: 'k', type: 'update', patch: { status: 'in_progress' }, match: { id: 'j1' }, createdAt: 2, seq: 2 };
  const up2 = { key: 'k', type: 'update', patch: { status: 'completed', completed_by: 'u1' }, match: { id: 'j1' }, createdAt: 3, seq: 3 };
  const del = { key: 'k', type: 'delete', match: { id: 'j1' }, createdAt: 4, seq: 4 };
  const a = combine(ins, up1);
  assert.equal(a.type, 'insert');
  assert.deepEqual(a.row, { id: 'j1', title: 'A', status: 'in_progress' });
  assert.equal(a.createdAt, 1);
  assert.deepEqual(combine(up1, up2).patch, { status: 'completed', completed_by: 'u1' });
  assert.equal(combine(ins, del), null);                 // never reached the server
  assert.equal(combine(up1, del).type, 'delete');
  assert.equal(combine(del, up1).type, 'delete');        // gone stays gone
});

test('created then deleted offline: nothing is ever sent', async () => {
  const { box, state } = setup({ net: 'offline' });
  await box.submit({ key: 'team_jobs|j1', table: 'team_jobs', type: 'insert', row: { id: 'j1' }, match: { id: 'j1' } });
  await box.submit({ key: 'team_jobs|j1', table: 'team_jobs', type: 'update', patch: { status: 'completed' }, match: { id: 'j1' } });
  await box.submit({ key: 'team_jobs|j1', table: 'team_jobs', type: 'delete', match: { id: 'j1' } });
  assert.equal(box.pendingCount(), 0);
  state.net = 'online'; state.calls.length = 0;
  await box.flush();
  assert.deepEqual(state.calls, []);
});

test('an edit that depends on a later record is not folded ahead of it (FK order kept)', async () => {
  const { box, state } = setup({ net: 'offline' });
  const sent = [];
  const box2 = createOutbox({
    store: memStore(),
    userId: () => 'u1',
    execute: async (op) => { if (state.net === 'offline') return OFFLINE; sent.push(`${op.type} ${op.table} ${JSON.stringify(op.row || op.patch)}`); return { data: null }; },
  });
  void box;
  await box2.submit({ key: 'laundry_items|i1', table: 'laundry_items', type: 'insert', row: { id: 'i1' }, match: { id: 'i1' } });
  await box2.submit({ key: 'laundry_cases|c1', table: 'laundry_cases', type: 'insert', row: { id: 'c1' }, match: { id: 'c1' } });
  await box2.submit({ key: 'laundry_items|i1', table: 'laundry_items', type: 'update', patch: { case_id: 'c1' }, match: { id: 'i1' } });
  await box2.submit({ key: 'laundry_items|i1', table: 'laundry_items', type: 'update', patch: { status: 'Stored' }, match: { id: 'i1' } });
  assert.equal(box2.pendingCount(), 3); // the two trailing updates folded together
  state.net = 'online';
  await box2.flush();
  assert.deepEqual(sent, [
    'insert laundry_items {"id":"i1"}',
    'insert laundry_cases {"id":"c1"}',
    'update laundry_items {"case_id":"c1","status":"Stored"}',
  ]);
});

test('a non-network exception is a rejection, not "offline" — it never blocks the queue', async () => {
  const sent = [];
  let mode = 'offline';
  const rejected = [];
  const box = createOutbox({
    store: memStore(),
    userId: () => 'u1',
    onRejected: (op, err) => rejected.push([op.key, err.message]),
    execute: async (op) => {
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      if (op.key === 'bad') throw new Error('InvalidCharacterError: atob');
      sent.push(op.key);
      return { data: null };
    },
  });
  await box.submit({ key: 'bad', table: 't', type: 'insert', row: {} });
  await box.submit({ key: 'good', table: 't', type: 'insert', row: {} });
  assert.equal(box.pendingCount(), 2);
  mode = 'online';
  await box.flush();
  assert.deepEqual(sent, ['good']);
  assert.equal(box.pendingCount(), 0);
  assert.equal(rejected[0][0], 'bad');
});
