import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLabel, isVesselAccount, isHeldBy, groupAccounts, defaultAccountId,
  matchAccountByLast4,
} from './accountPick.js';

// The real shape of a vessel's account list — the reason this module exists.
const FLEET = [
  { id: 'op', name: 'Operating account', currency: 'EUR', holder_role: 'Vessel', funds_type: 'general' },
  { id: 'apa', name: 'APA holding account', currency: 'EUR', holder_role: 'Vessel', funds_type: 'charter_apa' },
  { id: 'own-cap', name: 'Owner card', currency: 'EUR', holder_role: 'Captain', card_last4: '4471' },
  { id: 'own-stew', name: 'Owner card', currency: 'EUR', holder_role: 'Chief Stewardess', card_last4: '6614' },
  { id: 'own-eng', name: 'Owner card', currency: 'EUR', holder_role: 'Chief Engineer', card_last4: '3390' },
  { id: 'apa-stew', name: 'Charter APA card', currency: 'EUR', holder_role: 'Chief Stewardess', card_last4: '9021' },
  { id: 'cash-stew', name: 'Petty cash', currency: 'EUR', holder_role: 'Chief Stewardess' },
  { id: 'gbp', name: 'Plaid Current Account', currency: 'GBP', card_last4: '0000' },
];

// ── labels ──────────────────────────────────────────────────────────────────
test('the three same-named cards get three different labels', () => {
  const owner = FLEET.filter((a) => a.name === 'Owner card').map((a) => accountLabel(a));
  assert.deepEqual(owner, [
    'Owner card · Captain ••4471 (EUR)',
    'Owner card · Chief Stewardess ••6614 (EUR)',
    'Owner card · Chief Engineer ••3390 (EUR)',
  ]);
  assert.equal(new Set(owner).size, 3);
});

test('no two accounts in the fleet share a label', () => {
  const labels = FLEET.map((a) => accountLabel(a));
  assert.equal(new Set(labels).size, FLEET.length);
});

test('a vessel account is not labelled with a holder', () => {
  assert.equal(accountLabel(FLEET[0]), 'Operating account (EUR)');
});

test('the sandbox placeholder last4 is not printed as if it distinguished anything', () => {
  assert.equal(accountLabel(FLEET[7]), 'Plaid Current Account (GBP)');
});

test('a card with no last4 still names its holder', () => {
  assert.equal(accountLabel(FLEET[6]), 'Petty cash · Chief Stewardess (EUR)');
});

// ── whose is it ─────────────────────────────────────────────────────────────
test('a vessel-level account is held by nobody', () => {
  assert.equal(isVesselAccount(FLEET[0]), true);
  assert.equal(isVesselAccount(FLEET[7]), true);          // no holder at all
  assert.equal(isVesselAccount(FLEET[2]), false);
});

test('holder_user_id wins over the role when it is set', () => {
  const a = { holder_user_id: 'u1', holder_role: 'Captain' };
  assert.equal(isHeldBy(a, { userId: 'u1', roleName: 'Chief Stewardess' }), true);
  assert.equal(isHeldBy(a, { userId: 'u2', roleName: 'Captain' }), false);
});

test('the role is the fallback, case-insensitively', () => {
  assert.equal(isHeldBy(FLEET[3], { roleName: 'chief stewardess' }), true);
  assert.equal(isHeldBy(FLEET[3], { roleName: 'Captain' }), false);
});

test('an unknown role claims nothing', () => {
  // Otherwise a crew member with no role set would be handed every unheld card.
  assert.equal(isHeldBy(FLEET[2], {}), false);
  assert.equal(isHeldBy(FLEET[2], { roleName: '' }), false);
});

// ── grouping ────────────────────────────────────────────────────────────────
test('the chief stew sees her own three first', () => {
  const groups = groupAccounts(FLEET, { roleName: 'Chief Stewardess' });
  assert.deepEqual(groups.map((g) => g.key), ['mine', 'vessel', 'others']);
  assert.deepEqual(groups[0].accounts.map((a) => a.id).sort(),
    ['apa-stew', 'cash-stew', 'own-stew']);
});

test('every account lands in exactly one group', () => {
  const groups = groupAccounts(FLEET, { roleName: 'Chief Stewardess' });
  const ids = groups.flatMap((g) => g.accounts.map((a) => a.id));
  assert.equal(ids.length, FLEET.length);
  assert.equal(new Set(ids).size, FLEET.length);
});

test('closed accounts are not offered', () => {
  const groups = groupAccounts([...FLEET, { id: 'x', name: 'Old card', is_active: false }], {});
  assert.equal(groups.flatMap((g) => g.accounts).find((a) => a.id === 'x'), undefined);
});

test('empty groups do not produce empty headings', () => {
  const groups = groupAccounts(FLEET, { roleName: 'Deckhand' });   // holds nothing
  assert.deepEqual(groups.map((g) => g.key), ['vessel', 'others']);
});

// ── preselection ────────────────────────────────────────────────────────────
test('one card of yours in the line currency is preselected', () => {
  assert.equal(defaultAccountId(FLEET, { roleName: 'Chief Engineer', currency: 'EUR' }), 'own-eng');
});

test('several of yours means ask — a wrong account misstates two balances', () => {
  assert.equal(defaultAccountId(FLEET, { roleName: 'Chief Stewardess', currency: 'EUR' }), '');
});

test('none of yours in that currency means ask', () => {
  assert.equal(defaultAccountId(FLEET, { roleName: 'Chief Engineer', currency: 'GBP' }), '');
  assert.equal(defaultAccountId(FLEET, { roleName: 'Deckhand', currency: 'EUR' }), '');
});

// ── matching a Stripe charge back to the card it came off ───────────────────
test('the digits Stripe reports identify the card', () => {
  assert.equal(matchAccountByLast4(FLEET, '6614')?.id, 'own-stew');
  assert.equal(matchAccountByLast4(FLEET, '8802'), null);        // not in this fleet
});

test('an ambiguous last4 is left for a human', () => {
  // Posting to the wrong card misstates two balances; asking costs one click.
  const twins = [...FLEET, { id: 'dup', name: 'Owner card', card_last4: '6614' }];
  assert.equal(matchAccountByLast4(twins, '6614'), null);
});

test('the sandbox placeholder never matches', () => {
  assert.equal(matchAccountByLast4(FLEET, '0000'), null);
});

test('junk digits match nothing', () => {
  for (const bad of [null, undefined, '', '66', 'abcd', '66140']) {
    assert.equal(matchAccountByLast4(FLEET, bad), null);
  }
});

test('a closed account does not claim the charge', () => {
  const closed = [{ id: 'old', name: 'Owner card', card_last4: '5555', is_active: false }];
  assert.equal(matchAccountByLast4(closed, '5555'), null);
});
