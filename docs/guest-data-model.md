# Guest data model — what is where, and the two things still wrong

Written while rebuilding Guest Management (PRs #3372–#3374). Three problems were
fixed in that run; two were deliberately left, because both turned out to be
wider than they look and both touch surfaces that cannot be exercised from a
cloud session. This is the note that stops the next person re-deriving all of it.

## Where a guest lives now

| table | holds | who can read it |
|---|---|---|
| `guests` | name, cabin, allergies, health, preferences summary, contact, emergency contact, privacy preferences, trip state | any active member of the vessel |
| `guest_confidential` | passport and visa, NDA, APA, billing and payment | **Command and Chief only** |
| `guest_preferences` | the preference tree | any active member |
| `trip_guests` → `trips` | which trips a guest is on, and `trips.trip_type` | any active member |

`guests.guest_type` is **legacy**. Owner-vs-charter belongs to the trip —
`trips.trip_type` carries it and `trip_guests` joins the two. It is read only as
a fallback for a guest with no trips. Storing it on the person is what caused
people to be cloned (see below).

Reads go through `loadGuests()` in
`src/pages/guest-management-dashboard/utils/guestStorage.js`, which embeds both
`guest_confidential` and the trip links. **Twenty-plus pages import that module**
— changing its return shape is not a local change.

## Fixed in #3372–#3374

- The page was rebuilt in the editorial system; the "Status" column was a
  hardcoded literal `"Guest"` on every row and is gone.
- `const DEV_MODE = true` was forcing every permission check true in production.
- All four `guests` policies were plain `is_tenant_member`, so any crew member
  could read and hard-delete passports. Those columns now live in
  `guest_confidential`; hard delete is Command's alone.
- Rafael Edry and Shiran Ezra each existed twice on Horizon, once Owner and once
  Charter, because there were no trips to carry the distinction. Merged by rule
  (see `20261030140000_guest_dedupe_and_trip_roles.sql`), which only ever retires
  a duplicate whose records are **all** empty.

---

## Still wrong #1 — the cabin is stored five ways

`guests` carries five cabin columns and none of them links to `vessel_locations`:

| column | populated (of 11 guests) |
|---|---|
| `cabin_allocated` (free text) | 10 |
| `cabin_location_path` | 2 |
| `cabin_location_ids` (jsonb) | 2 |
| `cabin_location_label` | 1 |
| `cabin_location_id` | **0** |

This is why the same cabin read "Master Cabin" on one record and "Master" on
another. That particular symptom is gone — it was an artefact of the duplicate
records, and the survivors agree — but the schema that allowed it has not
changed.

**The read order**, which several files re-implement independently, is
`cabin_location_path` → `cabin_location_label` → `cabin_allocated`, then show
the last `>`-separated segment. The one shared implementation is `cabinOf()` in
`src/services/guestRoster.js`; prefer it over writing a fourth copy.

### Why it was not consolidated

Eleven files across six feature areas read these columns:

- `guest-management-dashboard/` — `AddGuestModal`, `GuestDetailPanel`
- `pantry/` — `drawers/GuestDrawer.jsx`, `hooks/useGuests.js`
- `laundry-management-dashboard/` — `AddLaundryModal`, `OwnerWardrobeView`
- `trips-management-dashboard/components/AddTripModal.jsx`
- `trip-preferences-view/`, `master-preferences-view/`,
  `guest-preference-profile/`
- `services/guestRoster.js`

`pantry/hooks/useGuests.js` names `cabin_location_id` in an **explicit select**,
so dropping even the column with zero rows in it throws there rather than
returning null. Every column drop therefore means editing laundry and pantry
code, and a mistake surfaces as a broken guest drawer rather than a failed
build.

### What to do when someone picks this up

1. Add `cabin_vessel_location_id uuid references vessel_locations(id)` — the
   link that should have existed. `vessel_locations` is already a proper tree
   (`id`, `tenant_id`, `level`, `name`, `parent_id`).
2. Backfill it where a stored path or label matches a `vessel_locations.name`
   for that tenant; leave the rest null rather than guessing.
3. Repoint the eleven consumers at `cabinOf()` / the new id.
4. Only then drop `cabin_location_path`, `cabin_location_label`,
   `cabin_location_ids` and `cabin_location_id`. Keep `cabin_allocated` as the
   free-text fallback for a vessel with no deck plan.

Do it where the pantry and laundry can actually be clicked through.

---

## Still wrong #2 — the guest's privacy choice is not enforced

`guests` has three columns that are collected from the guest, stored, and read
by **nothing**:

- `share_guest_info_with_crew` — `Full` / `Limited` / `None` (default `Limited`)
- `privacy_level` — `Standard` / `High` / `Ultra`
- `photo_permission` — `Yes` / `No` / `Ask Each Time`

The form asks a guest how widely their information may be shared and then
ignores the answer. That is worse than not asking, and it is the one remaining
item from the original review that has had no code written against it.

### Why the obvious fix does not scale

`guest_confidential` worked because the per-guest setting becomes a row-level
condition once the columns live on their own table — and only four files touched
those columns.

The same trick on `health_conditions` and `preferences_summary` does not scale:
those are load-bearing for the pantry, the galley's live surface. Among the
readers are `pantry/hooks/useAllergies.js`,
`pantry/widgets/AllergiesWidget.jsx`, `pantry/drawers/DrawerAllergiesBlock.jsx`,
`pantry/utils/emergencyDevices.js` and `pantry/hooks/useGuestDrawerPrefs.js`.
Breaking those has safety consequences, not cosmetic ones.

### The agreed rule, when it is built

- **`None`** — crew below Chief see name, cabin and **allergies** only.
- **`Limited`** (default) — health conditions and preference detail visible;
  contact details not.
- **`Full`** — contact details as well.
- Command and Chief always see everything on `guests`.

**Allergies are a deliberate exception and must stay visible to anyone serving
food, whatever the guest selected.** Hiding a nut allergy from the chef is a
risk no privacy setting should be able to create. Say so in the UI, so the
guest's choice is not misrepresented back to them.

### Two viable routes

1. **Redacting view.** Lock `guests` SELECT to Command/Chief, add a
   `security_invoker` view that nulls fields per the rule, repoint the
   guest-specific consumers at it. Honest and complete; ~15 files.
2. **Narrow split first.** `contact_email` / `contact_phone` have a much smaller
   reader set than health and preferences, so the `Full` gate on contact can be
   done on its own with the `guest_confidential` pattern, leaving the pantry
   alone until it can be tested.

Route 2 is the safer first step and delivers the part that is cleanly
separable. Note it changes today's behaviour: under the `Limited` default, crew
below Chief would stop seeing guest contact details.

---

## Smaller things noticed in passing

- `GuestDetailPanel.jsx` calls `deleteGuest(guest?.id)` **without awaiting it**
  and treats the returned promise as a success flag, so a failed delete reports
  success. Around line 382.
- `AddGuestModal.jsx` is 1,211 lines and `GuestDetailPanel.jsx` is 1,678.
- `preference-images` is a **public** storage bucket. `guest-documents` is
  private, which is the one that matters, but preference photos are readable by
  URL.
