import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessState, accessLabel, accessPeople, sortAccess,
  cleanScopes, describeScopes, scopeLabel,
  tierLabel, canRunTeam, canSignOffAs,
  TEAM_TIERS, TIER_POWERS, tierCan, engagementNote,
  VESSEL_AREAS, areaState, SCOPES, monthReadiness, monthActivity,
  FLEET_FILTERS, vesselBucket, fleetCounts, filterFleet,
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

test('a vessel area says which of the three things it is', () => {
  const accounts = VESSEL_AREAS.find((a) => a.key === 'accounts');
  const hor = VESSEL_AREAS.find((a) => a.key === 'hor');

  // Shared and served.
  assert.equal(areaState(accounts, ['accounts']), 'live');
  // Shared, but Cargo doesn't serve it to management yet.
  assert.equal(areaState(hor, ['hor']), 'planned');
  // The vessel left it out of the engagement — not a gap in Cargo.
  assert.equal(areaState(accounts, ['hor']), 'not shared');
  assert.equal(areaState(accounts, []), 'not shared');
});

test('only areas Cargo actually serves are marked live', () => {
  // A widget that looks live and isn't is worse than an honest gap, so the
  // live flag has to stay in step with what a reader function exists for.
  const live = VESSEL_AREAS.filter((a) => a.live).map((a) => a.key);
  assert.deepEqual(live, ['accounts']);
});

test('every area is gated on a real scope', () => {
  const known = SCOPES.map((s) => s.key);
  VESSEL_AREAS.forEach((a) => {
    if (a.scope) assert.ok(known.includes(a.scope), `${a.key} gated on unknown scope ${a.scope}`);
  });
});

test('readiness tells "nothing to do" apart from "nothing ready"', () => {
  assert.equal(monthReadiness({ count: 0 }).pct, null);
  assert.equal(monthReadiness({ count: 4, uncoded: 0, unevidenced: 0 }).pct, 100);
  assert.equal(monthReadiness({ count: 4, uncoded: 4, unevidenced: 4 }).pct, 0);
});

test('a line that is both uncoded and unevidenced is only blocked once', () => {
  // Adding the two counts would claim 4 of 4 lines blocked when it may be 2.
  const r = monthReadiness({ count: 4, uncoded: 2, unevidenced: 2 });
  assert.equal(r.blocked, 2);
  assert.equal(r.ready, 2);
  assert.equal(r.pct, 50);
});

test('activity is built from the stamps, newest first', () => {
  const acts = monthActivity([
    { id: '1', account_id: 'a', submitted_at: '2026-07-28T09:00:00Z', approved_at: '2026-07-30T09:00:00Z' },
    { id: '2', account_id: 'b', queried_at: '2026-07-29T09:00:00Z', query_note: 'Fuel receipt' },
  ], { a: { name: 'Deck card' }, b: { name: 'Galley card' } });

  assert.deepEqual(acts.map((x) => x.kind), ['signed', 'queried', 'closed']);
  assert.equal(acts[0].name, 'Deck card');
  assert.equal(acts[1].note, 'Fuel receipt');
});

test('a vessel falls in exactly one bucket, worst first', () => {
  // A boat with both a month to sign and one sent back is a boat that needs a
  // signature — that is the more urgent of the two, so it must not be filed
  // under "sent back" and quietly missed.
  assert.equal(vesselBucket({ awaiting_signoff: 1, queried: 2 }), 'waiting');
  assert.equal(vesselBucket({ awaiting_signoff: 0, queried: 2 }), 'back');
  assert.equal(vesselBucket({ awaiting_signoff: 0, queried: 0 }), 'clear');
  assert.equal(vesselBucket({}), 'clear');
});

test('the counts add up to the fleet', () => {
  const fleet = [
    { awaiting_signoff: 2 }, { queried: 1 }, {}, {}, { awaiting_signoff: 1, queried: 1 },
  ];
  const c = fleetCounts(fleet);
  assert.equal(c.all, 5);
  assert.equal(c.waiting + c.back + c.clear, c.all);
  assert.deepEqual([c.waiting, c.back, c.clear], [2, 1, 2]);
});

test('filtering combines the bucket and the search', () => {
  const fleet = [
    { vessel_name: 'Serenity', awaiting_signoff: 2 },
    { vessel_name: 'Meridian', awaiting_signoff: 1 },
    { vessel_name: 'Halcyon' },
  ];
  assert.deepEqual(filterFleet(fleet, 'waiting').map((v) => v.vessel_name), ['Serenity', 'Meridian']);
  assert.deepEqual(filterFleet(fleet, 'waiting', 'mer').map((v) => v.vessel_name), ['Meridian']);
  assert.deepEqual(filterFleet(fleet, 'all', 'HAL').map((v) => v.vessel_name), ['Halcyon']);
  assert.equal(filterFleet(fleet, 'back').length, 0);
});
