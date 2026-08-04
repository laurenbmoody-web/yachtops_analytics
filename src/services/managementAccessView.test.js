import test from 'node:test';
import assert from 'node:assert/strict';
import { accessState, accessLabel, accessSub, sortAccess } from './managementView.js';

test('a grant made before the office had a login reads as awaiting sign-up', () => {
  assert.equal(accessState({ active: true, has_login: false }), 'awaiting sign-up');
  assert.equal(accessState({ active: true, has_login: true }), 'active');
  assert.equal(accessState({ active: false, has_login: true }), 'withdrawn');
  assert.equal(accessState(null), 'none');
});

test('the label falls back down to the address, never to a placeholder', () => {
  assert.equal(accessLabel({ person_name: 'Ana Reyes', company_name: 'Blue Water', email: 'a@b.com' }), 'Ana Reyes');
  assert.equal(accessLabel({ company_name: 'Blue Water', email: 'a@b.com' }), 'Blue Water');
  assert.equal(accessLabel({ email: 'a@b.com' }), 'a@b.com');
  assert.equal(accessLabel({}), 'Someone');
});

test('the sub line never repeats the label', () => {
  assert.equal(
    accessSub({ person_name: 'Ana Reyes', company_name: 'Blue Water', email: 'a@b.com' }),
    'Blue Water · a@b.com',
  );
  assert.equal(accessSub({ company_name: 'Blue Water', email: 'a@b.com' }), 'a@b.com');
  assert.equal(accessSub({ email: 'a@b.com' }), '');
});

test('withdrawn access stays on file but sorts below current access', () => {
  const rows = [
    { active: false, person_name: 'Aaron Old' },
    { active: true, person_name: 'Zoe Now' },
    { active: true, person_name: 'Ana Now' },
  ];
  assert.deepEqual(sortAccess(rows).map((r) => r.person_name), ['Ana Now', 'Zoe Now', 'Aaron Old']);
});
