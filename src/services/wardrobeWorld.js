// Which wardrobe world a person belongs to.
//
// The laundry page used to decide this inline with `guestType === 'Owner'`,
// which read the camp a person belongs to as if it answered a different
// question. It does not. Three groups fall into two worlds:
//
//   the owner and the family who stow things aboard  -> permanent wardrobe
//   the owner's other family and friends, who don't  -> trip-scoped only
//   charter guests, who don't                        -> trip-scoped only
//
// The middle group is the one the old test got wrong: owner-side, so it filed
// them in the permanent wardrobe, where a standing kit list builds up for
// someone who never leaves anything behind.
//
// No Supabase import here on purpose — the rules are worth testing, and a
// module that reaches for the database cannot be loaded by `node --test`.

export const WardrobeScope = { OWNER: 'owner', CHARTER: 'charter', CREW: 'crew' };

// Absent means false. Every guest predating the column reads that way, which is
// the safe default: nobody gains a permanent wardrobe they never asked for.
export const keepsWardrobeAboard = (guest) => guest?.keepsWardrobeAboard === true;

// Only the owner world is about permanence; the charter and crew worlds are
// everyone else who passes through.
export const guestBelongsToWardrobeScope = (guest, scope) => {
  if (!guest || guest.isDeleted) return false;
  return scope === WardrobeScope.OWNER
    ? keepsWardrobeAboard(guest)
    : !keepsWardrobeAboard(guest);
};
