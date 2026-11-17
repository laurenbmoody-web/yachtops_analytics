-- Guest party role — the missing third level of "who is this person".
--
-- The product already answers two of the three questions a chief stew asks
-- about a guest:
--
--   1. owner or charter?   trips.trip_type
--   2. which charter?      trips.name  ("Milton charter")
--   3. who are they TO the principal?   -- nowhere
--
-- (3) is what this adds. "Family" and "Friend" were the examples asked for;
-- Principal matters at least as much, because the galley and the interior need
-- to know who the trip is actually for, and Staff matters because a nanny or a
-- close protection officer is aboard on different terms from a guest.
--
-- WHY ON `guests` AND NOT ON `trip_guests`
-- The obvious instinct is per-trip: "friend" means friend of whoever the
-- principal of that trip is. But on this vessel a person belongs to one camp
-- and stays in it — the owner's family and friends do not charter, and a
-- charter guest does not turn up on an owner trip. Their relationship
-- therefore does not vary by trip, and putting it on the link row would mean
-- re-entering the same answer on every trip they ever join.
--
-- This is NOT the mistake `guest_type` made. That stored the TRIP's type on
-- the person, so one person needed two rows to be on an owner trip and a
-- charter (which is exactly how Rafael Edry and Shiran Ezra each came to exist
-- twice — see 20261030140000). A relationship is a fact about the person, so
-- one row holds it.
--
-- If the vessel ever does need per-trip roles, this column becomes the default
-- and an override goes on `trip_guests`; nothing here has to be undone.

alter table public.guests
  add column if not exists party_role text;

comment on column public.guests.party_role is
  'Who this guest is to the principal of their party: Principal, Spouse, Family, '
  'Child, Friend, Staff, Other. Null means not recorded. Owner-vs-charter is NOT '
  'here — that is guests.guest_type for the person''s camp, and trips.trip_type '
  'for a given trip.';

-- Null is always allowed: most of the roster predates this column and an
-- unanswered question must not be forced into a wrong answer.
alter table public.guests
  drop constraint if exists guests_party_role_check;

alter table public.guests
  add constraint guests_party_role_check
  check (
    party_role is null
    or party_role in ('Principal', 'Spouse', 'Family', 'Child', 'Friend', 'Staff', 'Other')
  );

-- Deliberately NO backfill. The tempting one is "married + spouse_guest_id =>
-- Spouse", but a marriage makes BOTH people each other's spouse, so it would
-- label the owner "Spouse" of his own party and bury the fact that he is its
-- Principal. The roster is seven people; a guess that has to be unpicked costs
-- more than typing seven answers. Null reads as "Not recorded" and prompts.
