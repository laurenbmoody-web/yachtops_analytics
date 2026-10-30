-- One record per person, and owner-vs-charter where it actually belongs.
--
-- THE SHAPE OF THE BUG
-- guests.guest_type holds 'Owner' or 'Charter', so the distinction is stored on
-- the PERSON. But owner-vs-charter is a property of the TRIP, and the schema
-- already says so: trips.trip_type carries it and trip_guests joins people to
-- trips. On a vessel with no trips there was nowhere to put it, so the person
-- was cloned instead — Rafael Edry and Shiran Ezra each exist twice on Horizon,
-- once as Owner in "Master Cabin" and once as Charter in "Master".
--
-- That is not cosmetic. Preferences, day notes and trip links all hang off a
-- guest id, so a split person has their allergies filed under one record and
-- their cabin under the other, and whichever the galley opens is half the
-- story.
--
-- WHY A RULE RATHER THAN A LIST OF IDS
-- Hardcoding the four ids would fix today and nothing else. This retires
-- duplicates by rule, and the rule is deliberately timid: it only ever touches
-- a person whose records are ALL empty — no preferences, no trip links, no day
-- notes anywhere in the group. The moment a duplicate has anything attached,
-- the whole group is left alone for a human to merge, because choosing which
-- preferences survive is not a decision a migration should make.
--
-- Today that matches exactly the two pairs above and nothing else fleet-wide.
--
-- SOFT, NOT HARD
-- The loser is soft-deleted (is_deleted), which the list already hides and
-- which Command can undo from "Show deleted". Nothing is destroyed.
--
-- WHICH ONE SURVIVES
-- Most attached data first, then the Owner record, then whichever was created
-- first. Horizon is Rafael and Shiran's vessel, so Owner is the real person and
-- the Charter clone is the artefact.
--
-- AFTER THIS
-- guests.guest_type stays, but it is legacy: the app now reads the role for a
-- given trip from trips.trip_type through trip_guests, and falls back to
-- guest_type only for a guest with no trips. No column is needed on
-- trip_guests — the trip already knows what kind of trip it is.

-- ── tidy the legacy values ──────────────────────────────────────────────────
-- An older seed wrote lowercase 'principal' and 'guest' alongside the current
-- 'Owner' and 'Charter'. Only the casing is corrected; the words are left as
-- they are, because remapping 'principal' onto 'Owner' would be a guess about
-- what someone meant.
update public.guests
   set guest_type = upper(left(btrim(guest_type), 1)) || lower(substr(btrim(guest_type), 2))
 where guest_type is not null
   and btrim(guest_type) <> ''
   and guest_type <> upper(left(btrim(guest_type), 1)) || lower(substr(btrim(guest_type), 2));

-- ── retire the empty duplicates ─────────────────────────────────────────────
with scored as (
  select
    g.id,
    g.tenant_id,
    g.created_at,
    g.guest_type,
    lower(btrim(g.first_name) || ' ' || btrim(g.last_name)) as person_key,
    (select count(*) from public.guest_preferences p where p.guest_id = g.id)
      + (select count(*) from public.trip_guests tg where tg.guest_id = g.id)
      + (select count(*) from public.guest_day_notes n where n.guest_id = g.id) as attachments
  from public.guests g
  where g.is_deleted = false
    -- A blank name is not a person; grouping on it would merge strangers.
    and btrim(coalesce(g.first_name, '') || coalesce(g.last_name, '')) <> ''
), ranked as (
  select
    s.*,
    row_number() over (
      partition by s.tenant_id, s.person_key
      order by s.attachments desc,
               (upper(coalesce(s.guest_type, '')) = 'OWNER') desc,
               s.created_at asc
    ) as rn,
    count(*) over (partition by s.tenant_id, s.person_key) as records_for_person,
    sum(s.attachments) over (partition by s.tenant_id, s.person_key) as attachments_for_person
  from scored s
)
update public.guests g
   set is_deleted = true,
       deleted_at = coalesce(g.deleted_at, now()),
       updated_at = now()
  from ranked r
 where g.id = r.id
   and r.records_for_person > 1       -- there is a duplicate at all
   and r.rn > 1                       -- and this is not the record we keep
   and r.attachments_for_person = 0;  -- and NOTHING in the group is attached

comment on column public.guests.guest_type is
  'LEGACY. Owner-vs-charter belongs to the trip: read trips.trip_type through trip_guests. This is only a fallback for a guest with no trips, and duplicating a person to carry two values here is what it was being misused for.';
