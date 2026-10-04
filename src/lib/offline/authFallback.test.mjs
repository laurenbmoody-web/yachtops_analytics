// node --test src/lib/offline/authFallback.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withOfflineAuth } from './authFallback.js';

const REFRESH = 'https://proj.supabase.co/auth/v1/token?grant_type=refresh_token';
const stored = { access_token: 'old-at', refresh_token: 'rt-1', token_type: 'bearer', expires_at: 1, user: { id: 'u1' } };
const offline = () => Promise.reject(new TypeError('Failed to fetch'));
const opts = (s = stored) => ({ getStoredSession: () => s, now: () => 1_000_000 });

test('online refresh passes through untouched', async () => {
  const res = await withOfflineAuth(async () => new Response('{"access_token":"new"}'), opts())(REFRESH, { method: 'POST', body: '{"refresh_token":"rt-1"}' });
  assert.equal((await res.json()).access_token, 'new');
});

test('offline refresh is answered with the stored session and a short validity', async () => {
  const res = await withOfflineAuth(offline, opts())(REFRESH, { method: 'POST', body: '{"refresh_token":"rt-1"}' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.access_token, 'old-at');
  assert.equal(body.refresh_token, 'rt-1');
  assert.equal(body.expires_at, 1000 + 300);
  assert.equal(body.user.id, 'u1');
});

test('a refresh for a different token is never faked', async () => {
  await assert.rejects(withOfflineAuth(offline, opts())(REFRESH, { method: 'POST', body: '{"refresh_token":"someone-else"}' }), /Failed to fetch/);
});

test('real auth errors (e.g. revoked token) are not masked', async () => {
  const res = await withOfflineAuth(async () => new Response('{"error":"invalid_grant"}', { status: 400 }), opts())(REFRESH, { method: 'POST', body: '{"refresh_token":"rt-1"}' });
  assert.equal(res.status, 400);
});

test('other auth calls are left alone', async () => {
  await assert.rejects(withOfflineAuth(offline, opts())('https://proj.supabase.co/auth/v1/user', {}), /Failed to fetch/);
});
