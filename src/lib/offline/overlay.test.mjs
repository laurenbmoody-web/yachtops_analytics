// node --test src/lib/offline/overlay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlay } from './overlay.js';

const URL_MONTH = 'https://p.supabase.co/rest/v1/hor_work_entries?select=entry_date,work_segments,segment_types,source,updated_at&tenant_id=eq.t1&subject_user_id=eq.u1&entry_date=gte.2026-10-01&entry_date=lte.2026-10-31';
const key = (date, user = 'u1') => ({ tenant_id: 't1', subject_user_id: user, entry_date: date });
const upsert = (date, segs, user = 'u1') => ({ type: 'upsert', match: key(date, user), row: { ...key(date, user), work_segments: segs, segment_types: {}, source: 'edited', updated_at: 'x' } });

test('replaces the saved row for an edited day (key cols not selected)', () => {
  const rows = [{ entry_date: '2026-10-03', work_segments: [1, 2], segment_types: {}, source: 'edited', updated_at: 'old' }];
  const out = applyOverlay(URL_MONTH, rows, [upsert('2026-10-03', [10, 11])]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].work_segments, [10, 11]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['entry_date', 'segment_types', 'source', 'updated_at', 'work_segments']);
});

test('adds a new day inside the queried month; ignores days outside it and other crew', () => {
  const out = applyOverlay(URL_MONTH, [], [upsert('2026-10-05', [1]), upsert('2026-11-01', [1]), upsert('2026-10-06', [1], 'u2')]);
  assert.deepEqual(out.map((r) => r.entry_date), ['2026-10-05']);
});

test('delete removes the day; latest op wins', () => {
  const rows = [{ entry_date: '2026-10-03', work_segments: [1] }, { entry_date: '2026-10-04', work_segments: [2] }];
  const out = applyOverlay(URL_MONTH, rows, [upsert('2026-10-03', [9]), { type: 'delete', match: key('2026-10-03') }]);
  assert.deepEqual(out.map((r) => r.entry_date), ['2026-10-04']);
});

test('multi-crew list keyed by selected columns, ordered', () => {
  const url = 'https://p.supabase.co/rest/v1/hor_work_entries?select=subject_user_id,entry_date,work_segments&tenant_id=eq.t1&subject_user_id=in.(u1,u2)&order=entry_date.asc';
  const rows = [{ subject_user_id: 'u2', entry_date: '2026-10-03', work_segments: [5] }, { subject_user_id: 'u1', entry_date: '2026-10-04', work_segments: [1] }];
  const out = applyOverlay(url, rows, [upsert('2026-10-03', [7])]);
  assert.deepEqual(out.map((r) => `${r.subject_user_id}:${r.entry_date}:${r.work_segments}`), ['u2:2026-10-03:5', 'u1:2026-10-03:7', 'u1:2026-10-04:1']);
});

test('another vessel’s query is untouched', () => {
  const url = URL_MONTH.replace('tenant_id=eq.t1', 'tenant_id=eq.t9');
  const rows = [{ entry_date: '2026-10-03', work_segments: [1] }];
  assert.deepEqual(applyOverlay(url, rows, [upsert('2026-10-03', [9])]), rows);
});

const JOBS = 'https://p.supabase.co/rest/v1/team_jobs?select=id,title,status&tenant_id=eq.t1&status=in.(pending,in_progress)';

test('update patches the matching row (only selected columns)', () => {
  const rows = [{ id: 'j1', title: 'Wash tender', status: 'pending' }, { id: 'j2', title: 'Polish', status: 'pending' }];
  const out = applyOverlay(JOBS, rows, [{ type: 'update', match: { id: 'j2', tenant_id: 't1' }, patch: { status: 'in_progress', updated_at: 'x' } }]);
  assert.deepEqual(out, [{ id: 'j1', title: 'Wash tender', status: 'pending' }, { id: 'j2', title: 'Polish', status: 'in_progress' }]);
});

test('update that moves a row out of the filtered list removes it (job completed offline)', () => {
  const rows = [{ id: 'j1', title: 'Wash tender', status: 'pending' }];
  const out = applyOverlay(JOBS, rows, [{ type: 'update', match: { id: 'j1' }, patch: { status: 'completed' } }]);
  assert.deepEqual(out, []);
});

test('insert adds a job created offline', () => {
  const out = applyOverlay(JOBS, [], [{ type: 'insert', match: { id: 'j9' }, row: { id: 'j9', tenant_id: 't1', title: 'New', status: 'pending', created_by: 'u1' } }]);
  assert.deepEqual(out, [{ id: 'j9', title: 'New', status: 'pending' }]);
});
