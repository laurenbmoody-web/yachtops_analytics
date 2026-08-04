import test from 'node:test';
import assert from 'node:assert/strict';
import {
  landingAfterSwitch, sortVessels, vesselName, vesselSub, canSwitchVessel,
} from './vesselSwitch.js';

test('a section page survives the switch', () => {
  assert.equal(landingAfterSwitch('/accounts/ledger'), '/accounts/ledger');
  assert.equal(landingAfterSwitch('/dashboard'), '/dashboard');
});

test('a record page drops back to its section', () => {
  assert.equal(landingAfterSwitch('/crew/8f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8'), '/crew');
  assert.equal(landingAfterSwitch('/provisioning/orders/412'), '/provisioning/orders');
});

test('query strings and hashes are not mistaken for path', () => {
  assert.equal(landingAfterSwitch('/accounts/ledger?month=2026-07'), '/accounts/ledger');
  assert.equal(landingAfterSwitch('/accounts/ledger#top'), '/accounts/ledger');
});

test('a path that is only a record has no section to fall back to', () => {
  assert.equal(landingAfterSwitch('/412'), '/dashboard');
  assert.equal(landingAfterSwitch('/'), '/dashboard');
  assert.equal(landingAfterSwitch(''), '/dashboard');
  assert.equal(landingAfterSwitch(null), '/dashboard');
});

test('the caller can name its own fallback', () => {
  assert.equal(landingAfterSwitch('/', '/accounts/ledger'), '/accounts/ledger');
});

const m = (id, name, extra = {}) => ({ tenant_id: id, tenants: { name }, ...extra });

test('vessels sort by name with the active one pinned first', () => {
  const rows = [m('c', 'Zephyr'), m('a', 'Aurora'), m('b', 'Meridian')];
  assert.deepEqual(sortVessels(rows).map(vesselName), ['Aurora', 'Meridian', 'Zephyr']);
  assert.deepEqual(sortVessels(rows, 'c').map(vesselName), ['Zephyr', 'Aurora', 'Meridian']);
});

test('rows without a tenant are dropped rather than drawn', () => {
  assert.equal(sortVessels([m('a', 'Aurora'), null, { tenants: { name: 'x' } }]).length, 1);
});

test('an unnamed vessel is still clickable', () => {
  assert.equal(vesselName({ tenant_id: 'a' }), 'Unnamed vessel');
  assert.equal(vesselName({ tenant_id: 'a', name: 'Direct' }), 'Direct');
});

test('the sub line separates two boats of the same name', () => {
  assert.equal(vesselSub(m('a', 'Serenity', { permission_tier: 'MANAGER' })), 'manager');
  assert.equal(
    vesselSub({ tenants: { name: 'Serenity', type: 'motor_yacht' }, permission_tier: 'CREW' }),
    'motor yacht · crew',
  );
  assert.equal(vesselSub({}), '');
});

test('one vessel is not a choice', () => {
  assert.equal(canSwitchVessel([m('a', 'Aurora')]), false);
  assert.equal(canSwitchVessel([]), false);
  assert.equal(canSwitchVessel([m('a', 'Aurora'), m('b', 'Meridian')]), true);
});
