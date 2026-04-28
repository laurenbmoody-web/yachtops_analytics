# Trips Migration — Embedded Arrays Tracker (Phases A3.7+)

Forward-looking catalog of the embedded array fields on the localStorage trip object that have **no Supabase home today**. Phases A3.1–A3.6 (the read/write swap for trip headers + `trip_guests`) leave each of these arrays in localStorage. Each phase below moves one array to its own Supabase table.

**Scope of this doc:** scope per phase, rough schema, expected hook surface, dependencies. **Not** ordering. **Not** dates. A future session picks up an A3.7+ phase and uses this catalog as the starting point.

**Related docs:**
- `docs/trips-migration-a3-audit.md` — the in-place A3 audit. Section 3 lists which fields are deferred; Section 9 is the post-A3 cleanup queue.
- This doc complements that one — it expands the "deferred" rows into per-phase scopes.

---

## Conventions

- All tables use `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- All tables FK to `trips(id) ON DELETE CASCADE`.
- All tables get the standard tenant-scoped RLS via parent trip (mirroring `trip_guests`'s pattern from A1: `EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND public.is_tenant_member(t.tenant_id))`).
- Audit columns (`created_at`, `updated_at` with trigger) follow the codebase convention from stew_notes.
- Hook surface convention: `useTrip<Thing>(tripId)` returning `{ <thing>, loading, error, addThing, updateThing, deleteThing, refetch }` — same shape as Phase D's `useStewNotes` etc.

---

## A3.7 — `itineraryDays`

| Aspect | Value |
|---|---|
| **User-visible** | Yes — itinerary tab on the trip detail page; `/trips/:tripId/itinerary` route |
| **Current shape** | `trip.itineraryDays: [{ id, date, port, activities, notes, ... }]` embedded array on trip |
| **Helpers today** | `addItineraryDay(tripId, dayData)`, `updateItineraryDay(tripId, dayId, updates)`, `deleteItineraryDay(tripId, dayId)` |
| **Frontend touchpoints** | `trip-itinerary-timeline/index.jsx`, `AddItineraryDayModal.jsx`, `AddEditDayModal.jsx`, `trip-detail-view-with-guest-allocation/index.jsx` |

### Schema sketch

```sql
CREATE TABLE public.trip_itinerary_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_date    date NOT NULL,
  port        text,
  notes       text,
  ordering    int  NOT NULL DEFAULT 0,    -- explicit order; allows reordering without changing dates
  activities  jsonb DEFAULT '[]'::jsonb,  -- [{ time, title, notes }] — nested but small, jsonb is enough
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_itinerary_days_trip_id ON public.trip_itinerary_days(trip_id);
```

### Hook surface

```js
useTripItinerary(tripId) → {
  days,            // array of day rows, sorted by ordering then day_date
  loading, error,
  addDay(dayData),
  updateDay(dayId, updates),
  deleteDay(dayId),
  reorderDays(idsInOrder),  // batch update of ordering field
  refetch,
}
```

### Decisions to make at phase-spec time

- `activities` as jsonb on the day row vs separate `trip_itinerary_activities` table. **Recommend jsonb** — activities are small, always read with their parent day, never queried independently.
- Whether `ordering` is needed at all (dates might suffice). Current localStorage shape has no explicit ordering, so reordering is implicit by date. **Recommend keeping `ordering`** for future "sort manually within a date" support.

### Dependencies

- A3.1 + A3.5 must be live (`trips` reads + writes on Supabase) before this phase can FK cleanly.
- No external services.

---

## A3.8 — `specialDates`

| Aspect | Value |
|---|---|
| **User-visible** | Yes — special dates tab on the trip detail page (also tab=special) |
| **Current shape** | `trip.specialDates: [{ id, type, date, guestId?, description, ... }]` embedded |
| **Helpers today** | `addSpecialDate(tripId, dateData)`, `updateSpecialDate(tripId, dateId, updates)`, `deleteSpecialDate(tripId, dateId)` |
| **Frontend touchpoints** | `AddSpecialDateModal.jsx`, `trip-detail-view-with-guest-allocation/index.jsx` |

### Schema sketch

```sql
CREATE TABLE public.trip_special_dates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  date_type    text NOT NULL CHECK (date_type IN ('Birthday','Anniversary','Celebration','Other')),
  event_date   date NOT NULL,
  guest_id     uuid REFERENCES public.guests(id) ON DELETE SET NULL,  -- null for trip-wide events
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_special_dates_trip_id ON public.trip_special_dates(trip_id);
CREATE INDEX idx_trip_special_dates_guest_id ON public.trip_special_dates(guest_id);
```

CHECK values come straight from the existing `SpecialDateType` enum in `tripStorage.js:23`.

### Hook surface

```js
useSpecialDates(tripId) → {
  dates, loading, error,
  addDate, updateDate, deleteDate,
  refetch,
}
```

### Dependencies

- `guests` table on Supabase (already exists).
- Trip table on Supabase (A1 ✓).

---

## A3.9 — `specialRequests`

| Aspect | Value |
|---|---|
| **User-visible** | Yes — special requests tab |
| **Current shape** | `trip.specialRequests: [{ id, description, status, requestedBy, ... }]` embedded |
| **Helpers today** | `addSpecialRequest(tripId, requestData)`, `updateSpecialRequest(tripId, requestId, updates)`, `deleteSpecialRequest(tripId, requestId)` |
| **Frontend touchpoints** | `AddSpecialRequestModal.jsx`, `CompleteTripModal.jsx`, `trip-detail-view-with-guest-allocation/index.jsx` |

### Schema sketch

```sql
CREATE TABLE public.trip_special_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  description   text NOT NULL,
  status        text NOT NULL DEFAULT 'Planned'
                CHECK (status IN ('Planned','In progress','Done')),
  requested_by  uuid REFERENCES auth.users(id),
  guest_id      uuid REFERENCES public.guests(id) ON DELETE SET NULL,  -- if request is guest-scoped
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_special_requests_trip_id ON public.trip_special_requests(trip_id);
CREATE INDEX idx_trip_special_requests_status  ON public.trip_special_requests(status);
```

CHECK values from `SpecialRequestStatus` (`tripStorage.js:31`).

### Hook surface

```js
useSpecialRequests(tripId) → {
  requests, loading, error,
  addRequest, updateRequest, deleteRequest,
  refetch,
}
```

### Decisions to make at phase-spec time

- `guest_id` field is implied by current code (some requests are guest-scoped) but not formal in the localStorage shape. Worth a quick UX read to confirm before coding.
- `CompleteTripModal` updates request status in bulk on trip completion — that flow's permission gate needs auditing alongside this phase.

### Dependencies

- A3.5 (trip writes on Supabase) must be live so `CompleteTripModal`'s coordinated update has a coherent transaction surface.

---

## A3.10 — `photos` + `heroImage`

| Aspect | Value |
|---|---|
| **User-visible** | Yes — gallery + hero image on trip detail (also tab=photos query string) |
| **Current shape** | `trip.photos: [{ id, url, caption, ... }]` array AND `trip.heroImageUrl`, `trip.heroImageUpdatedAt`, `trip.heroImageUpdatedBy` flat fields |
| **Helpers today** | None directly — writes happen via direct localStorage mutation in upload handlers |
| **Frontend touchpoints** | `trip-detail-view-with-guest-allocation/index.jsx` (hero upload + photos rendering at multiple sites) |

### Schema sketch

Two pieces:

**Hero stays on `trips`** — single 1:1 fields, no benefit to splitting:

```sql
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS hero_image_url        text,
  ADD COLUMN IF NOT EXISTS hero_image_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS hero_image_updated_by uuid REFERENCES auth.users(id);
```

**Gallery photos** — separate table:

```sql
CREATE TABLE public.trip_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  url         text NOT NULL,
  caption     text,
  ordering    int  NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_photos_trip_id ON public.trip_photos(trip_id);
```

### Hook surface

```js
useTripHeroImage(tripId)  → { url, updatedAt, updatedBy, setHero(file), clearHero }
useTripPhotos(tripId)     → { photos, loading, addPhoto(file, caption), updateCaption, deletePhoto, reorder }
```

Two hooks because the surfaces are quite different (single image vs gallery).

### Decisions to make at phase-spec time

- **Storage bucket.** URLs in the localStorage shape look like Supabase Storage URLs already — confirm the bucket exists and has appropriate RLS. If yes, schema migration is straightforward. If not, this phase needs a Storage bucket creation step first.
- **Existing photos:** does production have any localStorage photos that need migrating? Likely zero today — Cargo's photo upload UX may not be live yet. If there are some, A3.10 needs a backfill step.

### Dependencies

- **Supabase Storage bucket for trip images.** Investigate before scoping this phase. If absent, that's an additional pre-phase.
- A3.5 for trip writes (the hero image fields on `trips` need the regular write path).

---

## A3.11 — `charterDocs`

| Aspect | Value |
|---|---|
| **User-visible** | Yes — docs tab on trip detail (charter trips primarily) |
| **Current shape** | `trip.charterDocs: [{ id, name, url, type, uploadedAt, ... }]` embedded |
| **Helpers today** | None — direct localStorage writes via `EditCharterDetailsModal` and similar |
| **Frontend touchpoints** | `EditCharterDetailsModal.jsx`, `trip-detail-view-with-guest-allocation/index.jsx` |

### Schema sketch

```sql
CREATE TABLE public.trip_charter_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name        text NOT NULL,
  url         text NOT NULL,
  doc_type    text,                       -- 'contract', 'agreement', 'mou', 'other' — open enum
  uploaded_by uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_charter_docs_trip_id ON public.trip_charter_docs(trip_id);
```

### Hook surface

```js
useCharterDocs(tripId) → {
  docs, loading, error,
  addDoc(file, type, name), deleteDoc(docId),
  refetch,
}
```

### Dependencies

- **Supabase Storage bucket for charter PDFs.** Same investigation as A3.10's image bucket — could be the same bucket with a `charter-docs/` prefix, or a separate one.
- A3.5 ideally — charter docs co-update with the trip's `brokerDetails` (A3.12) when both edit in the same modal.

---

## A3.12 — `brokerDetails`

| Aspect | Value |
|---|---|
| **User-visible** | Yes (charter trips) — broker contact info displayed on trip detail |
| **Current shape** | `trip.brokerDetails: { name, email, phone, agency, ... }` — single nested object, not an array |
| **Helpers today** | None — set via `EditCharterDetailsModal` |
| **Frontend touchpoints** | `EditCharterDetailsModal.jsx`, `trip-detail-view-with-guest-allocation/index.jsx` |

### Schema options

Single object, 1:1 with trip. Two viable shapes:

**Option A — inline columns on `trips`** (recommended)

```sql
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS broker_name    text,
  ADD COLUMN IF NOT EXISTS broker_email   text,
  ADD COLUMN IF NOT EXISTS broker_email_normalized text GENERATED ALWAYS AS (lower(broker_email)) STORED,
  ADD COLUMN IF NOT EXISTS broker_phone   text,
  ADD COLUMN IF NOT EXISTS broker_agency  text;
```

**Option B — separate `trip_broker_details` table** (1:1)

```sql
CREATE TABLE public.trip_broker_details (
  trip_id  uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  name     text,
  email    text,
  phone    text,
  agency   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### Hook surface

If Option A: surfaced via `useTrip(tripId)` directly — no separate hook.
If Option B: `useBrokerDetails(tripId) → { details, setDetails }`.

### Recommendation

**Option A.** The fields are always read with the trip, never independently queried, never multi-row. Inline columns mean one fewer table, one fewer FK to maintain, one transactional write when the user saves charter details.

### Dependencies

- A3.5 — the trip write path needs to handle these new columns alongside the existing trip fields.

---

## A3.13 — `tripActivityLog`

| Aspect | Value |
|---|---|
| **User-visible** | Maybe — currently surfaced on trip detail (tab=activity) but not heavily used |
| **Current shape** | `trip.tripActivityLog: [{ id, type, message, actorUserId, at, ... }]` embedded |
| **Helpers today** | `logTripActivity(tripId, activityType, message)`, `getTripActivityLog(tripId)` |
| **Frontend touchpoints** | Implicit — every trip writer calls `logTripActivity` and the activity tab reads via `getTripActivityLog` |
| **Existing partial overlap** | `activity_feed` Supabase table covers SOME activity types (created/updated/deleted), but trip-internal activity (guest activated, itinerary day added, etc.) currently goes only to localStorage |

### Schema options

**Option A — extend `activity_feed`** with trip-scoped columns

The existing `activity_feed` table presumably has `entity_type` + `entity_id` already. Adding trip-internal activity types requires no schema change — just write more entries with `entity_type='trip'`.

**Option B — dedicated `trip_activity_log` table**

```sql
CREATE TABLE public.trip_activity_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  activity_type  text NOT NULL,    -- TripActivityType enum (tripStorage.js:38)
  message        text,
  actor_user_id  uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_activity_log_trip_id ON public.trip_activity_log(trip_id);
CREATE INDEX idx_trip_activity_log_created ON public.trip_activity_log(created_at);
```

### Recommendation

**Decide at phase-spec time** based on what `activity_feed` actually contains. If `activity_feed` already supports a generic entity_type/entity_id pattern with a payload column, **Option A** (extend it) is cleaner. If `activity_feed` is opinionated about its row shape, **Option B** is the right call.

Checking `activity_feed` schema is the first action of A3.13.

### Hook surface

```js
useTripActivityLog(tripId) → {
  entries, loading, error,
  addEntry({ type, message }),
  refetch,
}
```

`addEntry` is mostly internal — most call sites are inside other helpers (`updateTrip` calls `logTripActivity` automatically). Only direct UI surface is the activity feed display.

### Dependencies

- Read of `activity_feed` schema first.
- A3.5 — most activity entries are written *as a side effect* of a trip mutation, so the trip write path needs to be on Supabase before activity entries can land in the right table transactionally.

---

## Cross-phase dependencies summary

```
A1 (schema) ────┬─ A3.1 (read) ─── A3.2 (direct localStorage) ─┬─ A3.5 (writes) ─── A3.6 (tripDays)
                │                                              │
                └─ A3.3+A3.4 (nav, shipped) ──────────────────┤
                                                              │
                              ┌───────────────────────────────┘
                              ▼
                       A3.7 itineraryDays
                       A3.8 specialDates
                       A3.9 specialRequests
                       A3.10 photos+hero      (also depends on Storage bucket investigation)
                       A3.11 charterDocs      (also depends on Storage bucket investigation)
                       A3.12 brokerDetails    (inline columns; also dep on A3.5)
                       A3.13 tripActivityLog  (also depends on activity_feed schema read)
```

**Pre-phase work that's not numbered yet:**
- Supabase Storage bucket audit for trip images and PDFs (blocks A3.10 + A3.11 if buckets absent).
- `activity_feed` schema read (blocks A3.13 design decision).
- A3.5's GuestDetailPanel:163 fix (Option A from the audit-doc addendum).

---

## What this doc is NOT

- Not a commitment to ship in this order. Each phase's user-visible priority can be re-ranked when its session opens.
- Not a final schema spec. The "Schema sketch" sections are starting points; the per-phase prep should re-grep the codebase for any field name drift before locking the migration.
- Not the cleanup queue. Section 9 of the audit doc owns post-A3 cleanup items (orphan files, useGuests divergence, etc.). Those don't belong here.

## Status

**Catalog complete.** No code, no schema applied. Future sessions reference this when scoping any A3.7+ phase.
