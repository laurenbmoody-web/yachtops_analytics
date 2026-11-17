-- Who keeps clothes on board permanently.
--
-- The laundry wardrobe split ran on `guest_type = 'Owner'`, which treated the
-- camp a person belongs to as if it answered a different question: whether they
-- leave things aboard between trips. Those are not the same axis, and three
-- groups fall out of the difference:
--
--   owner + the family who stow things aboard permanently   -> owner wardrobe
--   owner's other family and friends, who take it all home  -> trip-scoped only
--   charter guests, who take it all home                    -> trip-scoped only
--
-- The middle group is the one `guest_type` got wrong: owner-side, so the old
-- filter put them in the permanent wardrobe, where they accumulate a standing
-- kit list nobody ever stows.
--
-- So permanence gets its own column. `guest_type` goes back to meaning only
-- "whose people are these", which is all it should ever have meant — and is now
-- needed only as the level-1 fallback for a guest with no trips.

alter table public.guests
  add column if not exists keeps_wardrobe_aboard boolean not null default false;

comment on column public.guests.keeps_wardrobe_aboard is
  'True when this person stows clothing on board between trips, so they get a '
  'permanent wardrobe. Independent of guest_type: the owner''s friends are '
  'owner-side but usually take everything home.';

-- Reproduce today's behaviour EXACTLY, so nothing moves between the two
-- wardrobe views on deploy: every owner-camp guest currently appears in the
-- owner wardrobe, so every owner-camp guest starts with the flag set. Narrowing
-- it to the people who really do stow things is a judgement only the interior
-- can make, one person at a time, from the guest record.
update public.guests
set keeps_wardrobe_aboard = true
where guest_type = 'Owner'
  and is_deleted is not true;
