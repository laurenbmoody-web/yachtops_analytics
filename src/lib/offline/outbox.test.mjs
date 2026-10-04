// node --test src/lib/offline/outbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from './outbox.js';

function memStore(initial = []) {
  const map = new Map(initial.map((o) => [o.key, o]));
  return { map, all: async () => [...map.values()], put: async (o) => { map.set(o.key, o); }, delete: async (k) => { map.delete(k); } };
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
