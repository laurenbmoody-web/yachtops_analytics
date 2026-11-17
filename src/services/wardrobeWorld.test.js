// Which wardrobe world a person belongs to. Run: `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keepsWardrobeAboard, guestBelongsToWardrobeScope, WardrobeScope,
} from './wardrobeWorld.js';

const owner       = { id: 'o', guestType: 'Owner',   partyRole: 'Principal', keepsWardrobeAboard: true };
const ownersWife  = { id: 'w', guestType: 'Owner',   partyRole: 'Spouse',    keepsWardrobeAboard: true };
const ownersFriend= { id: 'f', guestType: 'Owner',   partyRole: 'Friend',    keepsWardrobeAboard: false };
const charterGuest= { id: 'c', guestType: 'Charter', partyRole: 'Friend',    keepsWardrobeAboard: false };

test('the owner and the family who stow things get the permanent wardrobe', () => {
  assert.equal(guestBelongsToWardrobeScope(owner, WardrobeScope.OWNER), true);
  assert.equal(guestBelongsToWardrobeScope(ownersWife, WardrobeScope.OWNER), true);
});

test("the owner's friend is owner-side but takes it all home", () => {
  // The case the old guestType === 'Owner' test got wrong: owner-side, so it
  // filed them in the permanent wardrobe they never stow anything in.
  assert.equal(ownersFriend.guestType, 'Owner');
  assert.equal(guestBelongsToWardrobeScope(ownersFriend, WardrobeScope.OWNER), false);
  assert.equal(guestBelongsToWardrobeScope(ownersFriend, WardrobeScope.CHARTER), true);
});

test('charter guests are trip-scoped', () => {
  assert.equal(guestBelongsToWardrobeScope(charterGuest, WardrobeScope.OWNER), false);
  assert.equal(guestBelongsToWardrobeScope(charterGuest, WardrobeScope.CHARTER), true);
});

test('the two worlds partition every live guest exactly once', () => {
  for (const g of [owner, ownersWife, ownersFriend, charterGuest]) {
    const inOwner = guestBelongsToWardrobeScope(g, WardrobeScope.OWNER);
    const inGuest = guestBelongsToWardrobeScope(g, WardrobeScope.CHARTER);
    assert.notEqual(inOwner, inGuest, `${g.id} must be in exactly one world`);
  }
});

test('a deleted guest is in neither world', () => {
  const gone = { ...owner, isDeleted: true };
  assert.equal(guestBelongsToWardrobeScope(gone, WardrobeScope.OWNER), false);
  assert.equal(guestBelongsToWardrobeScope(gone, WardrobeScope.CHARTER), false);
});

test('a missing flag means they do not stow anything', () => {
  // Every guest predating the column reads false, which is the safe default:
  // nobody gains a permanent wardrobe they never asked for.
  assert.equal(keepsWardrobeAboard({}), false);
  assert.equal(keepsWardrobeAboard({ keepsWardrobeAboard: 'yes' }), false);
  assert.equal(keepsWardrobeAboard(null), false);
  assert.equal(guestBelongsToWardrobeScope(null, WardrobeScope.OWNER), false);
});
