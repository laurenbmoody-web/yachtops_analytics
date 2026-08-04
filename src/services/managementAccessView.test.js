import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessState, accessLabel, accessPeople, sortAccess,
  cleanScopes, describeScopes, scopeLabel,
  tierLabel, canRunTeam, canSignOffAs,
  TEAM_TIERS, TIER_POWERS, tierCan, engagementNote,
} from './managementView.js';

const eng = (over = {}) => ({
  active: true, company_name: 'Blue Water', people: [{ email: 'a@b.com', has_login: true }], ...over,
});

test('a firm whose people have all yet to sign up is not live access', () => {
  assert.equal(accessState(eng()), 'active');
  assert.equal(accessState(eng({ people: [{ email: 'a@b.com', has_login: false }] })), 'awaiting sign-up');
  assert.equal(accessState(eng({ people: [] })), 'awaiting sign-up');
  assert.equal(accessState(eng({ active: false })), 'ended');
  assert.equal(accessState(null), 'none');
});

test('the row is named for the firm, not a person', () => {
  assert.equal(accessLabel(eng()), 'Blue Water');
  assert.equal(accessLabel({}), 'A management company');
});

test('a captain can see who the firm actually is', () => {
  assert.equal(accessPeople(eng({ people: [] })), 'Nobody added yet');
  assert.equal(
    accessPeople(eng({ people: [{ name: 'Ana Reyes' }, { email: 'tom@bw.com' }] })),
    'Ana Reyes, tom@bw.com',
  );
  assert.equal(
    accessPeople(eng({ people: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }] })),
    'A, B, C +2 more',
  );
});

test('ended engagements stay on file but sort below live ones', () => {
  const rows = [
    { active: false, company_name: 'Aaron Marine' },
    { active: true, company_name: 'Zephyr Management' },
    { active: true, company_name: 'Ana Yachting' },
  ];
  assert.deepEqual(sortAccess(rows).map((r) => r.company_name),
    ['Ana Yachting', 'Zephyr Management', 'Aaron Marine']);
});

test('an engagement names which parts of the vessel it covers', () => {
  assert.deepEqual(cleanScopes(['month_end', 'accounts']), ['accounts', 'month_end']);
  assert.deepEqual(cleanScopes(['accounts', 'accounts', 'nonsense']), ['accounts']);
  assert.deepEqual(cleanScopes([]), []);
  assert.deepEqual(cleanScopes(null), []);
});

test('scopes read as prose, not as keys', () => {
  assert.equal(describeScopes(['accounts']), 'Month-end spending');
  assert.equal(describeScopes(['hor', 'accounts']), 'Month-end spending and Hours of Rest');
  assert.equal(
    describeScopes(['month_end', 'hor', 'accounts']),
    'Month-end spending, Hours of Rest and Monthly checks',
  );
  assert.equal(describeScopes([]), 'nothing');
});

test('an unknown scope key still renders as something', () => {
  assert.equal(scopeLabel('accounts'), 'Month-end spending');
  assert.equal(scopeLabel('mystery'), 'mystery');
});

test('a viewer at the firm reads but does not sign', () => {
  assert.equal(canSignOffAs('VIEWER'), false);
  assert.equal(canSignOffAs('MEMBER'), true);
  assert.equal(canSignOffAs('ADMIN'), true);
  assert.equal(canSignOffAs('OWNER'), true);
});

test('only an owner or admin runs the team', () => {
  assert.equal(canRunTeam('OWNER'), true);
  assert.equal(canRunTeam('ADMIN'), true);
  assert.equal(canRunTeam('MEMBER'), false);
  assert.equal(canRunTeam('VIEWER'), false);
  assert.equal(canRunTeam(undefined), false);
});

test('tiers have a human label', () => {
  assert.equal(tierLabel('MEMBER'), 'Member');
  assert.equal(tierLabel('WHAT'), 'WHAT');
});

test('the permission table matches what the tier helpers allow', () => {
  // The matrix on the settings screen and the buttons on the vessel page must
  // never disagree — a screen that claims a power the database refuses is worse
  // than no screen at all.
  TEAM_TIERS.forEach((t) => {
    assert.equal(tierCan(t.key, 'sign'), canSignOffAs(t.key), `sign: ${t.key}`);
    assert.equal(tierCan(t.key, 'team'), canRunTeam(t.key), `team: ${t.key}`);
  });
});

test('nobody can change what the crew entered', () => {
  const edit = TIER_POWERS.find((p) => p.key === 'edit');
  assert.deepEqual(edit.tiers, []);
  TEAM_TIERS.forEach((t) => assert.equal(tierCan(t.key, 'edit'), false, t.key));
});

test('every power lists only real tiers', () => {
  const known = TEAM_TIERS.map((t) => t.key);
  TIER_POWERS.forEach((p) => {
    p.tiers.forEach((k) => assert.ok(known.includes(k), `${p.key} lists unknown tier ${k}`));
  });
});

test('the engagement note says who is in charge of it', () => {
  assert.equal(engagementNote([]), 'No vessel has engaged you yet.');
  assert.match(engagementNote([{ active: true }]), /^1 vessel has engaged you\./);
  assert.match(engagementNote([{ active: true }, { active: true }, { active: false }]),
    /^2 vessels have engaged you\./);
});
