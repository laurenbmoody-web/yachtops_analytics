// node --test src/lib/offline/readCache.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadCache, classify } from './readCache.js';

const BASE = 'https://proj.supabase.co';
const jwt = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.y`;
const auth = (sub = 'user-a') => ({ Authorization: `Bearer ${jwt(sub)}`, Accept: 'application/json' });

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => map.get(k),
    put: async (e) => { map.set(e.k, e); },
    markTableStale: async (t) => { for (const e of map.values()) if (e.t === t) e.stale = true; },
    clear: async () => map.clear(),
  };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const offline = () => Promise.reject(new TypeError('Failed to fetch'));
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts = {}) {
  const store = memoryStore();
  const events = [];
  const wrap = createReadCache({ store, now: () => 1000, stallMs: 30, report: (e) => events.push(e), ...opts });
  return { store, events, wrap };
}

test('classify: table reads, read RPCs, writes', () => {
  assert.deepEqual(classify(`${BASE}/rest/v1/laundry_items?select=*`, 'GET'), { read: true, table: 'laundry_items' });
  assert.deepEqual(classify(`${BASE}/rest/v1/laundry_items`, 'POST'), { read: false, table: 'laundry_items' });
  assert.deepEqual(classify(`${BASE}/rest/v1/laundry_items?id=eq.1`, 'PATCH'), { read: false, table: 'laundry_items' });
  assert.equal(classify(`${BASE}/rest/v1/rpc/get_my_context`, 'POST').read, true);
  assert.equal(classify(`${BASE}/rest/v1/rpc/fetch_my_threads_people`, 'POST').read, true);
  assert.equal(classify(`${BASE}/rest/v1/rpc/get_or_create_dm_thread`, 'POST').read, false);
  assert.equal(classify(`${BASE}/rest/v1/rpc/hor_submit_month`, 'POST').read, false);
  assert.equal(classify(`${BASE}/auth/v1/token?grant_type=refresh_token`, 'POST').read, false);
  assert.equal(classify(`${BASE}/functions/v1/laundry-push`, 'POST').read, false);
  assert.equal(classify(`${BASE}/storage/v1/object/sign/docs/a.pdf`, 'POST').read, true);
});

test('online: passes through and saves; offline: serves the saved copy', async () => {
  const { store, events, wrap } = setup();
  const url = `${BASE}/rest/v1/team_jobs?select=*`;
  const online = wrap(async () => json([{ id: 1 }], 200, { 'content-range': '0-0/1' }));
  const res = await online(url, { method: 'GET', headers: auth() });
  assert.deepEqual(await res.json(), [{ id: 1 }]);
  await flush();
  assert.equal(store.map.size, 1);

  const off = wrap(offline);
  const cached = await off(url, { method: 'GET', headers: auth() });
  assert.equal(cached.status, 200);
  assert.deepEqual(await cached.json(), [{ id: 1 }]);
  assert.equal(cached.headers.get('content-range'), '0-0/1');
  assert.equal(cached.headers.get('x-cargo-cached-at'), '1000');
  assert.deepEqual(events.at(-1), { type: 'offline', at: 1000 });
});

test('offline with nothing saved: the network error still surfaces', async () => {
  const { events, wrap } = setup();
  await assert.rejects(wrap(offline)(`${BASE}/rest/v1/defects?select=*`, { headers: auth() }), /Failed to fetch/);
  assert.deepEqual(events.at(-1), { type: 'offline' });
});

test('saved reads are per user', async () => {
  const { wrap } = setup();
  const url = `${BASE}/rest/v1/crew_profiles?select=*`;
  await wrap(async () => json([{ who: 'a' }]))(url, { headers: auth('user-a') });
  await flush();
  await assert.rejects(wrap(offline)(url, { headers: auth('user-b') }));
});

test('offline with an expired token (anon key sent): still finds the user’s saved reads', async () => {
  let signedIn = 'user-a';
  const { wrap } = setup({ userId: () => signedIn });
  const url = `${BASE}/rest/v1/team_jobs?select=*`;
  await wrap(async () => json([{ id: 7 }]))(url, { headers: auth('user-a') });
  await flush();
  const anonHeaders = { Authorization: 'Bearer anon-key-without-sub', Accept: 'application/json' };
  const res = await wrap(offline)(url, { headers: anonHeaders });
  assert.deepEqual(await res.json(), [{ id: 7 }]);
  signedIn = 'user-b';
  await assert.rejects(wrap(offline)(url, { headers: anonHeaders }));
});

test('gateway 5xx falls back to the saved copy', async () => {
  const { wrap } = setup();
  const url = `${BASE}/rest/v1/inventory_items?select=*`;
  await wrap(async () => json([{ n: 1 }]))(url, { headers: auth() });
  await flush();
  const res = await wrap(async () => new Response('bad gateway', { status: 502 }))(url, { headers: auth() });
  assert.deepEqual(await res.json(), [{ n: 1 }]);
});

test('stalled link: serves the saved copy after stallMs, refreshes in the background', async () => {
  const { store, events, wrap } = setup();
  const url = `${BASE}/rest/v1/laundry_items?select=*`;
  await wrap(async () => json([{ v: 'old' }]))(url, { headers: auth() });
  await flush();
  let release;
  const slow = wrap(() => new Promise((r) => { release = () => r(json([{ v: 'new' }])); }));
  const res = await slow(url, { headers: auth() });
  assert.deepEqual(await res.json(), [{ v: 'old' }]);
  assert.equal(events.at(-1).type, 'slow');
  release();
  await flush(); await flush();
  assert.match([...store.map.values()][0].body, /new/);
});

test('a write marks the table’s saved reads stale: still served offline, not on a slow link', async () => {
  const { store, events, wrap } = setup();
  const url = `${BASE}/rest/v1/defects?select=*`;
  await wrap(async () => json([{ id: 1 }]))(url, { headers: auth() });
  await wrap(async () => json([{ id: 9 }]))(`${BASE}/rest/v1/team_jobs?select=*`, { headers: auth() });
  await flush();
  await wrap(async () => json({}, 201))(`${BASE}/rest/v1/defects`, { method: 'POST', headers: auth(), body: '{}' });
  await flush();
  const byTable = Object.fromEntries([...store.map.values()].map((e) => [e.t, !!e.stale]));
  assert.deepEqual(byTable, { defects: true, team_jobs: false });

  // offline → stale copy is better than nothing
  const off = await wrap(offline)(url, { headers: auth() });
  assert.deepEqual(await off.json(), [{ id: 1 }]);

  // slow link → wait for the network instead of showing pre-edit data
  const slow = wrap(() => new Promise((r) => setTimeout(() => r(json([{ id: 1 }, { id: 2 }])), 80)));
  const res = await slow(url, { headers: auth() });
  assert.deepEqual(await res.json(), [{ id: 1 }, { id: 2 }]);
  await flush();
  assert.equal([...store.map.values()].find((e) => e.t === 'defects').stale, undefined);

  await assert.rejects(wrap(offline)(`${BASE}/rest/v1/defects`, { method: 'POST', headers: auth(), body: '{}' }));
  assert.deepEqual(events.at(-1), { type: 'write-failed' });
  await assert.rejects(wrap(offline)(`${BASE}/auth/v1/user`, { headers: auth() }));
  assert.deepEqual(events.at(-1), { type: 'offline' });
});

test('known offline: answers from the device without waiting on the network', async () => {
  const { store, wrap } = setup();
  const url = `${BASE}/rest/v1/rpc/get_my_context`;
  await wrap(async () => json([{ tenant_id: 't1' }]))(url, { method: 'POST', headers: auth(), body: '{}' });
  await flush();
  const offlineWrap = createReadCache({ store, isOffline: () => true, report() {} });
  let called = false;
  const res = await offlineWrap(() => { called = true; return new Promise(() => {}); })(url, { method: 'POST', headers: auth(), body: '{}' });
  assert.deepEqual(await res.json(), [{ tenant_id: 't1' }]);
  assert.equal(called, false);
});

test('caller abort is not masked by the cache', async () => {
  const { wrap } = setup();
  const url = `${BASE}/rest/v1/team_jobs?select=*`;
  await wrap(async () => json([1]))(url, { headers: auth() });
  await flush();
  const ac = new AbortController(); ac.abort();
  const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(wrap(() => Promise.reject(err))(url, { headers: auth(), signal: ac.signal }), /aborted/);
});

test('pending offline edits are laid over reads — network and saved copy alike', async () => {
  const pending = [{ type: 'upsert', match: { entry_date: '2026-10-03' }, row: { tenant_id: 't1', entry_date: '2026-10-03', work_segments: [9] } }];
  const { wrap } = setup({ pendingFor: (t) => (t === 'hor_work_entries' ? pending : []) });
  const url = `${BASE}/rest/v1/hor_work_entries?select=entry_date,work_segments&tenant_id=eq.t1`;
  const online = await wrap(async () => json([{ entry_date: '2026-10-03', work_segments: [1] }]))(url, { headers: auth() });
  assert.deepEqual(await online.json(), [{ entry_date: '2026-10-03', work_segments: [9] }]);
  await flush();
  const off = await wrap(offline)(url, { headers: auth() });
  assert.deepEqual(await off.json(), [{ entry_date: '2026-10-03', work_segments: [9] }]);
  // other tables untouched
  const other = await wrap(async () => json([{ id: 1 }]))(`${BASE}/rest/v1/team_jobs?select=*`, { headers: auth() });
  assert.deepEqual(await other.json(), [{ id: 1 }]);
});
