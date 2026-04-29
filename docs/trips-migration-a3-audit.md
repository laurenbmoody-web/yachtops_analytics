# Trips Migration — Phase A3 Audit

Read-only audit doc for the localStorage → Supabase trips read-path swap (Phase A3). Production state is unchanged by writing this doc; nothing in here implies a code change has shipped.

**Branch state at audit time:** `claude/audit-standby-page-GQrB3` HEAD = `8b7e2a2` (normalizeTier snake_case fix). A1 schema applied to production; A2 migration runner shipped to repo; A3 not started.

**What this audit covers:** every trips surface, every call site of trip-storage helpers, every shape contract that A3's read-path swap will touch, the post-create-routing situation Lauren hit, and a recommended swap order with risk register.

**What this audit does NOT do:** propose specific code edits, change `tripStorage.js`, change any caller, modify production state. Just maps the territory so A3 lands cleanly.

---

## Section 1 — Pages & routes inventory

### 1.1 Routes registered for trip surfaces

From `src/Routes.jsx` lines 1077–1081:

| Route path | File path | Wired? | Permission gate | Reads | Writes |
|---|---|---|---|---|---|
| `/trips-management-dashboard` | `src/pages/trips-management-dashboard/index.jsx` | ✅ | `<ProtectedRoute>` (default tenant gate) + `canAccessTrips` checked from Header link | trips (localStorage), guests (Supabase via `loadGuests`) | trip create/update/delete via `<AddTripModal>` → `createTrip`/`updateTrip` |
| `/trip/:tripId` | `src/pages/trip-detail-view-with-guest-allocation/index.jsx` | ✅ | `<ProtectedRoute>` | trip (`getTripById`), guests (`loadGuests`), preferences (`getPreferencesByTrip`), provisioning lists (Supabase) | trip update, guest allocation, itinerary day add/update/delete, special date add/update/delete, special request add/update/delete, photo uploads |
| `/trip/:tripId/itinerary` | `src/pages/trip-itinerary-timeline/index.jsx` | ✅ | `<ProtectedRoute>` | trip (`getTripById`), embedded `itineraryDays` array | itinerary day add/update/delete via `<AddEditDayModal>` |
| `/trip/:tripId/preferences` | `src/pages/trip-preferences-view/index.jsx` | ✅ | `<ProtectedRoute>` | trip (`getTripById`), guests (`loadGuests`), preferences (`getPreferencesByTripAndGuest`) | preferences create/update/delete via `<AddPreferenceModal>` |
| `/trip/:tripId/preferences-overview` | `src/pages/trip-preferences-overview/index.jsx` | ✅ | `<ProtectedRoute>` | trip (`getTripById`), preferences (`getPreferencesByTripAndGuest`) | none (read-only) |

No orphan trip pages on disk. All five page directories under `src/pages/trip*` and `src/pages/trips-*` are imported and wired.

### 1.2 Post-create routing — the situation Lauren flagged

**Observed code path** (read by inspection — sandbox can't run the live app):

`AddTripModal` save handler in `trips-management-dashboard/index.jsx:832-841`:

```jsx
onSuccess={() => {
  loadTripsData();
  setShowAddModal(false);
  setEditingTrip(null);
}}
onSave={() => {
  loadTripsData();
  setShowAddModal(false);
  setEditingTrip(null);
}}
```

After `createTrip` succeeds: list refreshes, modal closes, `editingTrip` cleared. **No `navigate(...)` call.** Lauren stays on the dashboard. The new trip should appear in the list (because `loadTripsData` re-reads localStorage) — that's the entire post-create UX.

The expected behaviour Lauren described ("land on a trip detail page") is not implemented. To get to detail, the user has to click the new trip card after the modal closes.

### 1.3 Click-into-trip is broken — singular/plural bug

**Routes are registered as `/trip/:tripId` (singular).** Five navigation calls in `trips-management-dashboard/index.jsx` use `/trips/${id}` (plural):

| Line | Call | Path used | Routes register |
|---|---|---|---|
| 254 | `handleOpenTrip` | `/trips/${tripId}` | `/trip/:tripId` |
| 268 | tab=guests | `/trips/${trip?.id}?tab=guests` | `/trip/:tripId` |
| 271 | tab=preferences | `/trips/${trip?.id}?tab=preferences` | `/trip/:tripId` |
| 789 | mode=readonly | `/trips/${trip?.id}?mode=readonly` | `/trip/:tripId` |
| 1036 | tab=photos | `/trips/${photosTrip?.id}?tab=photos` | `/trip/:tripId` |

Every dashboard click that should open the detail page navigates to a path that doesn't match any route. Likely renders the catch-all NotFound. The detail page is technically reachable only via direct URL or external link.

The detail page itself (`useParams: { tripId }`, `getTripById(tripId)`) is correctly implemented for the singular path — the bug is in the dashboard's nav callers.

**Categorisation:** this is a wiring bug, not a missing page. The page exists, is wired, and works when reached via the right URL. Section 9 files this as a pre-existing issue surfaced during the audit.

### 1.4 Cross-page back-nav

Detail page back-nav uses `/trips-management-dashboard` correctly (the dashboard route). No reverse mismatch.

### 1.5 Guest-allocation child modal

`<AddOrSelectGuestModal>` lives inside the detail page (not its own route). Already audited in the previous bug fix — was missing `await` on `loadGuests`, fixed in `320c59a`.

### 1.6 Provisioning surfaces that take a trip context

Not "trip pages" but they consume `trip_id` and need flagging:

| Path | Reads trips from |
|---|---|
| `/provisioning-management-dashboard` | `localStorage` direct |
| `/provisioning/new?trip_id=...` (via dashboard link line 887) | `localStorage` direct |
| `/laundry-management-dashboard?tripId=...` (via dashboard line 1158) | `localStorage` via `loadTrips` |

A3's swap needs to handle these too — they're not trip pages but they read trip state.

---

## Section 2 — Call site inventory for trip-storage helpers

`tripStorage.js` exports 30+ helpers. The high-value ones for A3 are split into READ helpers (every call site is a swap candidate) and WRITE helpers (each is a permission-gated mutation that needs the same swap-time coherence).

**Total importer count of `tripStorage`:** 27 files across the codebase (raw count from `grep -rn "from.*tripStorage"`).

### 2.1 Read helpers — `loadTrips`, `getTripById`, `getActiveTrip*`, `getPreferencesByTrip*`

Grouped by importer file. Line numbers reference call sites, not import lines.

| File | Calls | Used in | What's done with the return |
|---|---|---|---|
| `pages/trips-management-dashboard/index.jsx` | `loadTrips()` (l.132, 167) | dashboard list page | sets state, drives card grid |
| `pages/trip-detail-view-with-guest-allocation/index.jsx` | `getTripById(tripId)` (l.126), `getPreferencesByTrip(tripId)` (l.142) | detail page top-level + section | populates trip + preference panels |
| `pages/trip-itinerary-timeline/index.jsx` | `getTripById(tripId)` (top-level effect) | timeline page | reads `trip.itineraryDays` |
| `pages/trip-preferences-view/index.jsx` | `getTripById(tripId)` (l.74), `getPreferencesByTripAndGuest(...)` | preferences page | filters by guestIds |
| `pages/trip-preferences-overview/index.jsx` | `getTripById(tripId)`, `getPreferencesByTripAndGuest(...)` | overview page | aggregates per guest |
| `pages/master-preferences-view/index.jsx` | `loadTrips()` (l.47) | inside `loadGuestsData` async fn | filters guests by trip status |
| `pages/preferences-directory/index.jsx` | `loadTrips()` | directory page | TripStatus + TripType filter pills |
| `pages/laundry-management-dashboard/index.jsx` | `loadTrips()` (l.102) | laundry dashboard | resolves trip name from tripId param |
| `pages/laundry-management-dashboard/components/AddLaundryModal.jsx` | `getActiveGuestsFromCurrentTrip()` | modal mount | guest dropdown |
| `pages/dashboard/components/ProvisioningWidget.jsx` | `loadTrips()` (l.51) | dashboard widget | finds active trip for provisioning summary |
| `pages/provisioning/index.jsx` | `loadTrips()` (l.497) | provisioning list page | trip filter dropdown — **comment in file: "loadTrips is synchronous (localStorage) — wrap safely"** (will become async post-A3) |
| `pages/provisioning/ProvisioningForm.jsx` | `loadTrips()` (l.155 direct localStorage read, also imports) | form | trip selector |
| `pages/provisioning/ProvisioningDetail.jsx` | `loadTrips()` | detail | resolves trip name |
| `pages/provisioning/ProvisioningBoardDetail.jsx` | `loadTrips()` | board | resolves trip name |
| `pages/provisioning/components/CopyBoardPicker.jsx` | `loadTrips()` | picker | trip picker dropdown |
| `pages/provisioning/utils/provisioningStorage.js` | `loadTrips()` | util | trip → list reverse lookup |
| `pages/guest-preference-profile/index.jsx` | `loadTrips()` | profile page | trip count + filtering |
| `pages/guest-preference-profile/components/ExportPreferencesModal.jsx` | `loadTrips()` | modal | trip filter |

### 2.2 Write helpers — `createTrip`, `updateTrip`, `deleteTrip`, itinerary, special-date, special-request

| File | Calls | Used in | Notes |
|---|---|---|---|
| `pages/trips-management-dashboard/components/AddTripModal.jsx` | `createTrip(...)`, `updateTrip(tripId, updates)` | modal save | gates on `normalizeTier` (now correct post-`8b7e2a2`) |
| `pages/trip-detail-view-with-guest-allocation/index.jsx` | `updateTrip(...)`, `deleteTrip(...)` (l.13 imports) | detail page actions | edit / delete buttons |
| `pages/trip-detail-view-with-guest-allocation/components/EditCharterDetailsModal.jsx` | `updateTrip(...)` | charter-details modal | partial trip patch |
| `pages/trip-detail-view-with-guest-allocation/components/CompleteTripModal.jsx` | `updateTrip(...)`, `updateSpecialRequest(...)`, `logTripActivity(...)` | end-of-trip flow | bulk patch + activity log |
| `pages/trip-detail-view-with-guest-allocation/components/AddSpecialDateModal.jsx` | `addSpecialDate(...)`, `updateSpecialDate(...)` | special date CRUD | embedded array writer |
| `pages/trip-detail-view-with-guest-allocation/components/AddSpecialRequestModal.jsx` | `addSpecialRequest(...)`, `updateSpecialRequest(...)` | special request CRUD | embedded array writer |
| `pages/trip-detail-view-with-guest-allocation/components/AddItineraryDayModal.jsx` | `addItineraryDay(...)`, `updateItineraryDay(...)` | itinerary CRUD | embedded array writer |
| `pages/trip-itinerary-timeline/index.jsx` | `deleteItineraryDay(...)` | timeline page | embedded array writer |
| `pages/trip-itinerary-timeline/components/AddEditDayModal.jsx` | `addItineraryDay(...)`, `updateItineraryDay(...)` | timeline modal | embedded array writer |
| `pages/trip-preferences-view/components/AddPreferenceModal.jsx` | `createPreference(...)`, `updatePreference(...)` | preferences modal | preferences are already Supabase via `preferencesStorage` — these are wrappers |

### 2.3 Direct `localStorage` reads of `cargo.trips.v1` (bypasses `tripStorage`)

These won't be caught by grepping `tripStorage` imports. Each is a separate swap-time concern:

| File | Line | Operation |
|---|---|---|
| `components/navigation/Header.jsx` | 220 | global search — reads + filters trips by title |
| `utils/provisioningSuggestions.js` | 22, 225 | reads trip → guest_ids → suggestion source |
| `pages/guest-management-dashboard/components/GuestDetailPanel.jsx` | 152, **163 (write)** | reads + **writes** trips when toggling guest membership — bypasses `updateTrip` permission gate |
| `pages/provisioning-management-dashboard/index.jsx` | 50 | local helper `loadLocalTrips()`, file comment "trips are not yet in Supabase" |
| `pages/provisioning-management-dashboard/components/CreateProvisioningListModal.jsx` | 47 | same local helper |
| `pages/provisioning/ProvisioningForm.jsx` | 155 | direct read alongside `loadTrips` import |
| `pages/pantry/utils/tripDaysRemaining.js` | 22 | helper for inventory edge function payload |

`GuestDetailPanel.jsx:163` is the most critical — it's a **direct localStorage write** that bypasses `updateTrip`'s permission check. Means a CREW-tier user could mutate trip data via the guest detail page even though the trips dashboard would reject the same operation. **Pre-existing latent bug; not in scope for A3 itself but worth flagging.** See Section 9.

### 2.4 Helpers that reference `trip` arg without going through storage

`getActiveGuestCount(trip)`, `getOpenRequestsCount(trip)`, `getUpcomingSpecialDatesCount(trip)`, `getProvisioningStatus(trip)`, `getLaundryStatus(trip)` — pure functions over a trip object. They don't touch localStorage. A3 only changes the SHAPE of the object passed to them; the helpers themselves keep working iff Section 3's shape contract is honoured by the read path.

---

## Section 3 — Shape contract assumptions

The localStorage trip object and the Supabase row diverge in field naming AND structure. A3 either translates at the read boundary (recommended) or every call site changes — there are 27.

### 3.1 Field-by-field comparison

Captured from `tripStorage.createTrip()` (lines 237–264) and the A1 migration `20260427120000_trips_full_schema.sql`:

| Concept | localStorage (camelCase) | Supabase (snake_case) | Notes |
|---|---|---|---|
| ID | `id: "trip-{ts}-{rand}"` (NOT a UUID) | `id: uuid` | localStorage IDs are `trip-1729876543210-abc123def` style; Supabase column is `uuid` — incompatible without translation. `legacy_local_id text UNIQUE` is the bridge column from A1. |
| Tenant | `vesselId: 'default'` (always literal string) | `tenant_id: uuid REFERENCES tenants(id)` | localStorage doesn't track tenant; Supabase does. |
| Name | `name` | `name` | ✅ matches |
| Type | `tripType: 'Owner' \| 'Charter' \| 'Friends/Family' \| 'Other'` | `trip_type` (same enum, CHECK-constrained) | values match per A2 normaliser |
| Start | `startDate: string` (ISO date or "") | `start_date: date NOT NULL` | empty-string coerced by A2's runner |
| End | `endDate: string` (ISO date, "", or undefined) | `end_date: date NOT NULL` | empty-string → null in A2's coercion; **schema NOT NULL means open-ended trips can't be migrated** as-is |
| Status | `status: 'upcoming' \| 'active' \| 'completed'` (computed at create-time, stored) | NO COLUMN | Status is derived at runtime in A1 schema (CURRENT_DATE BETWEEN start AND end) |
| Notes | `notes: string` | `notes: text` | ✅ |
| Itinerary summary | `itinerarySummary: string` | `itinerary_summary: text` | ✅ |
| Guests | `guests: [{ guestId, isActive, activatedAt, activatedByUserId }]` | `trip_guests` join table with `(trip_id, guest_id, is_active_on_trip, added_at)` | **structural change** — embedded array → join table |
| Guest IDs (legacy) | `guestIds: [uuid, ...]` (kept for back-compat) | (covered by `trip_guests`) | A2's runner reads `guests[].guestId` |
| Itinerary | `itineraryDays: [{ id, date, port, ... }]` | NO COLUMN, NO TABLE | **deferred to a later phase** — itinerary stays in localStorage past A3 |
| Special dates | `specialDates: [{ id, type, date, ... }]` | NO COLUMN, NO TABLE | same — deferred |
| Special requests | `specialRequests: [{ id, description, status, ... }]` | NO COLUMN, NO TABLE | same — deferred |
| Photos | `photos: [{ id, url, caption, ... }]` | NO COLUMN, NO TABLE | same — deferred |
| Charter docs | `charterDocs: [...]` | NO COLUMN, NO TABLE | same — deferred |
| Broker details | `brokerDetails` | NO COLUMN | deferred |
| Hero image | `heroImageUrl`, `heroImageUpdatedAt`, `heroImageUpdatedBy` | NO COLUMNS | deferred |
| Activity log | `tripActivityLog: [...]` | NO COLUMN — separate `activity_feed` Supabase table covers some but not all | partial overlap |
| Audit | `createdAt`, `createdByUserId`, `updatedAt`, `updatedByUserId` | `created_at`, `created_by`, `updated_at`, soft-delete trio | naming + `created_by` is uuid FK |

### 3.2 What this means for A3's read path

A3 swaps the read path for **trip header fields and guest membership only** (the columns A1 created). Every embedded array field — `itineraryDays`, `specialDates`, `specialRequests`, `photos`, `charterDocs`, `brokerDetails`, hero image fields, `tripActivityLog` — has no Supabase home yet.

**Two viable strategies for the embedded arrays during A3:**
1. **Hybrid** — A3 reads header + guests from Supabase, keeps reading embedded arrays from localStorage. Single helper `loadTrip(id)` merges. Each post-A3 phase peels off one array (itinerary → A4, special dates → A5, etc.) until localStorage is empty.
2. **Bulk hold** — Move the embedded arrays into a `metadata jsonb` column on `trips` (one-shot migration), then peel them out into proper tables later. Faster path to "kill the localStorage write path" but creates a jsonb blob that's harder to query.

Recommendation: **Hybrid.** Section 6 details the swap order assuming hybrid.

### 3.3 Date assumptions

`startDate` and `endDate` are used as both display strings (passed to `new Date(...)`) and comparison values. localStorage shape is ISO date strings (sometimes empty). Supabase returns ISO date strings too — same shape. **No date format change at the read boundary.** Trip status computed via `calculateTripStatus(startDate, endDate)` is unchanged.

### 3.4 Guest array reads

Twelve files iterate `trip.guests[]` or `trip.guestIds[]` for membership / active-guest filters. Post-A3, the read path needs to either:
- Hydrate `trip.guests` from `trip_guests` join table on read, OR
- Add a parallel `useTripGuests(tripId)` query and migrate readers one at a time

Section 7 picks the strategy.

### 3.5 Critical mismatches to watch during the swap

- **Trip ID format:** localStorage `"trip-{ts}-{rand}"` vs Supabase UUID. The `legacy_local_id` column is the bridge for migration; the read path either uses the new UUID everywhere (preferred) or keeps the legacy ID alive in a derived field. Anything that compares `trip.id === someStoredId` needs auditing.
- **Permissioned WRITES that bypass storage:** `GuestDetailPanel.jsx:163` directly mutates `cargo.trips.v1`. Once read path is Supabase-backed, this write path silently goes stale.
- **Embedded-array WRITES** (`addItineraryDay`, etc.) still go to localStorage. If we're hybrid, that's fine; if A3 is supposed to also flip writes, those break.

---

## Section 4 — Edge function / external read paths

### 4.1 Edge functions touching trip data

Surveyed `supabase/functions/*/index.ts` (10 functions). Only one references trip state:

| Function | How it uses trip data | Source |
|---|---|---|
| `generate-preference-links` | Receives `trip_days_remaining` as a **payload field**, doesn't read trips itself | Caller computes the number client-side |

The Edge Function is stateless re trips. The number arrives via the request body and feeds into the prompt + cache key. A3's swap doesn't change the Edge Function — it changes how the **caller** computes that number.

### 4.2 The caller: `tripDaysRemainingForGuest`

`src/pages/pantry/utils/tripDaysRemaining.js` reads `cargo.trips.v1` directly (line 22), iterates trips, finds the earliest-ending active trip that includes a given guest, and returns days-remaining.

Used by:
- `pages/pantry/hooks/useInventoryConsumables.js:43` — passes the value into the Edge Function payload + into client-side `assessItem` projected-need math.

Post-A3 swap behaviour: this helper needs the same Supabase read path as the rest. Two options:
- **Inline rewrite** — `tripDaysRemainingForGuest` queries Supabase via `supabase.from('trips')...` directly. Becomes async; `useInventoryConsumables` needs a `useEffect` adjustment.
- **Hook-ify** — replace with `useTripDaysRemainingForGuest(guestId)` hook that fits the existing async pattern in `useInventoryConsumables`.

Inline rewrite is the smaller delta. Hook-ify is more reusable but A3-shaped.

### 4.3 Other server-side or external reads of trip data

None found. No SQL views, no triggers, no other Edge Functions, no Supabase scheduled jobs touch trip data today (because the table only just got populated by A1 + A2).

The migration RPC `migrate_localstorage_trip` (A1) is the only server-side path that writes trips today. After A3 + A4 land, native trip CRUD will go through standard Supabase REST + RPC channels.

---

## Section 5 — `provisioning_lists.trip_id` FK state

### 5.1 Current column type

Confirmed in A1's audit (Section 1, Discovery): `provisioning_lists.trip_id` is `uuid` (no FK), set by migration `20260325110000_fix_provisioning_use_tenant_id.sql:35`. Type already matches A1's new `trips.id` column.

### 5.2 Are rows actively populated with `trip_id` today?

**Probably not — and they couldn't be valid even if they tried.** The current write path (e.g. `pages/provisioning-management-dashboard/components/CreateProvisioningListModal.jsx:506`) does:

```js
trip_id: form.trip_id || null
```

`form.trip_id` is selected from a dropdown populated by `loadLocalTrips()` (line 47 of the dashboard, direct localStorage read). The dropdown's option values are localStorage trip IDs of the form `"trip-{ts}-{rand}"` — **not valid UUIDs**.

Postgres rejects non-UUID strings on insert into a `uuid` column. So either:
- Users never select a trip in this modal (lists are tenant-scoped, not trip-scoped) → `trip_id` is always null → no failures observed
- Users do try → insert fails with a parse error → the modal silently swallows it

Worth a one-line query in production to confirm:

```sql
SELECT count(*) FROM provisioning_lists WHERE trip_id IS NOT NULL;
-- if >0, those rows are mysteries — likely pre-A1 stub-era inserts that somehow used a UUID
```

### 5.3 Does A3 need to handle the FK?

**No — defer to A4.** A3 swaps the read path for trips. The `provisioning_lists.trip_id` column stays uuid + no FK during A3. After A3 lands, future provisioning-list creates will pass real Supabase trip UUIDs from the new read path, which the column accepts.

A4 then adds `FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL` once we're confident no orphan localStorage IDs are sitting in the column. That's a single migration, ~3 lines.

### 5.4 Risk during the A3 → A4 window

If A3 ships and immediately a user creates a provisioning list with the new Supabase trip UUID, it inserts cleanly. Good.

If a provisioning list was created pre-A3 with a stale localStorage trip ID that happened to be valid-UUID-looking (vanishingly unlikely given the format), A4's FK migration would fail on that row. Worth one defensive `UPDATE provisioning_lists SET trip_id = NULL WHERE trip_id NOT IN (SELECT id FROM trips)` before adding the FK in A4.

---

## Section 6 — Recommended swap order

Anchored on the hybrid strategy from §3.2. Each phase is ship-pause-screenshot.

### Phase A3.1 — Read-only swap of `loadTrips()` and `getTripById()`

Lowest blast radius. Both are pure read functions; every caller just receives a slightly different object shape (header fields from Supabase, embedded arrays from localStorage, merged in the helper).

**Implementation sketch (NOT to be applied as part of this audit):**
- `loadTrips()` becomes async. Internally queries Supabase trips + trip_guests, then merges with `cargo.trips.v1` for embedded arrays via `legacy_local_id` lookup.
- `getTripById(tripId)` same shape.
- Every caller adds `await` (similar fix pattern to the recent `loadGuests` fix).

**~25 call sites need `await` added.** Mechanical, mirrors the loadGuests fix.

### Phase A3.2 — Direct localStorage reads → helper

Replace the 7 direct localStorage reads (Section 2.3) with calls to the now-async helpers. Same `await` pattern.

### Phase A3.3 — Fix the singular/plural nav bug

Five `navigate('/trips/${id}')` → `navigate('/trip/${id}')` corrections in the dashboard. One-line fixes each. **Bundle with A3.1 if scope tolerates** — otherwise it's an immediate UX paper-cut after A3.1 ships, because the new Supabase trip IDs won't make the broken nav suddenly work.

### Phase A3.4 — Post-create routing

When `createTrip` returns, navigate to `/trip/${newTrip.id}`. This is the Lauren-flagged piece. One-line addition to `AddTripModal`'s save handler in the dashboard.

### Phase A3.5 — Write path for trip CRUD (header only)

`createTrip`, `updateTrip`, `deleteTrip` swap to Supabase. Embedded-array writers (`addItineraryDay`, etc.) keep writing to localStorage until their respective phases.

This is where A2's migration runner is retired. Existing trips already have `legacy_local_id` mapped; new writes go directly to Supabase.

### Phase A3.6 — `tripDaysRemainingForGuest` async swap

Single-file change. Verify inventory edge function still gets the right payload.

### Atomic groups (must ship together)

- **A3.1 + A3.2** — once readers are async, every direct localStorage read becomes inconsistent with the merged shape. Ship together.
- **A3.3 + A3.4** — both are nav fixes. Bundle for one screenshot pass.

### Suggested merge order

```
A3.1 + A3.2   → screenshot pause (read path coherent)
A3.3 + A3.4   → screenshot pause (nav works end-to-end)
A3.5          → screenshot pause (writes coherent)
A3.6          → screenshot pause (inventory edge function regression check)
```

---

## Section 7 — Compatibility shim design

Two viable approaches. Each has a tradeoff.

### Option A — `loadTrips()` keeps its signature, reads Supabase under the hood

`loadTrips()` becomes `async`, internally queries Supabase + merges localStorage embedded arrays, returns the same camelCase shape consumers expect. Every consumer adds `await`.

**Pros:**
- Minimal call-site churn — callers change one keyword, not a hook contract
- Mirrors the `loadGuests` precedent (already-async Supabase reader masquerading as a sync helper, now untangled)
- Consumers don't need to learn React-Query patterns mid-migration
- Works in non-React contexts (e.g. `provisioningSuggestions.js` is a util, not a component)

**Cons:**
- No automatic refetch when Supabase data changes (manual `loadTrips()` recall needed)
- Stateless — can't cache across multiple consumers in a render tree
- Doesn't lay groundwork for realtime subscriptions (Phase B5 territory)

### Option B — New `useTrips()` hook in parallel, migrate call sites one-at-a-time

`useTrips()` returns `{ trips, loading, error, refetch }`. `loadTrips()` stays as a deprecated localStorage shim during the migration window, then deletes.

**Pros:**
- Idiomatic React data layer
- Easy to add caching, invalidation, realtime
- Clear migration boundary — each call site is either "old" or "new"
- Sets up Phase B5 (realtime) for free

**Cons:**
- 27 call sites need restructuring, not just keyword addition
- Util files (e.g. `provisioningSuggestions.js`) can't use hooks; need a non-React fallback anyway
- Bigger change → bigger risk window

### Recommendation: **Option A**, with a future Option-B layer on top

The `loadGuests` precedent already proved Option A works for this codebase — same async-helper pattern, recently fixed in 6 sites with the same kind of `await`-addition. Trips has 27 sites, but the work is mechanical and matches what the team already understands.

Once A3 ships and stabilises, a follow-up (call it B5-prep) introduces `useTrips()` as a React-Query / SWR-style hook over the same async helpers. Components migrate at leisure. The util files stay on the helper directly.

### Shape contract during the window

`loadTrips()` returns:
- Header fields from Supabase, mapped snake_case → camelCase (mirror the `mapRowToGuest` precedent)
- `guests: [{ guestId, isActive }]` reconstructed from `trip_guests` join
- Embedded arrays (`itineraryDays`, `specialDates`, etc.) merged from localStorage by `legacy_local_id` lookup
- `id` is the Supabase UUID; `legacy_local_id` exposed as a back-compat field for any caller that compares ID strings

A single `mapTripRow(row, localStorageMatch)` function inside `tripStorage.js` handles the merge. ~30 lines.

---

## Section 8 — Risk register

Ordered by likelihood × impact.

### 8.1 Race: localStorage write + Supabase read

If a user creates a trip locally (writes to `cargo.trips.v1`) but the A2 migration hasn't run yet (or is mid-flight), a subsequent `loadTrips()` call from Supabase will miss it. Result: the trip "disappears" from the dashboard until the next session.

**Mitigation:** A3.5's write swap closes this. During A3.1–A3.4 (read-only swap), keep the migration runner from A2 firing on every page load — it'll catch the new trip on next reload. UX impact: a momentary "where did my trip go" if the user creates and immediately reloads. Acceptable for a few-day window.

### 8.2 Cache invalidation across tabs

Two open tabs: tab A creates a trip in Supabase, tab B has stale `trips` state. Without realtime subscriptions, tab B doesn't know.

**Mitigation:** None for A3 — Cargo doesn't have realtime today. Document as known limitation; B5 fixes it. Workaround: tab B reloads.

### 8.3 User mid-creating a trip when A3.5 deploys

User has the AddTripModal open, hits Save, network call lands but the deploy switches the writer mid-flight.

**Mitigation:** Both writers are idempotent at the data layer (legacy_local_id UNIQUE on Supabase, save-first-wins on localStorage). Worst case: trip appears in both stores, A2's migration runner notices on next load and de-dups via `migrate_localstorage_trip` returning the existing row. **No data loss, no duplicate rows.**

### 8.4 Auth edge: tenant_id changes between A2 migration and A3 read

If a user switches tenants while trips are mid-migration, the A2 ledger could record a trip under tenant A's `legacy_local_id` while the user is now in tenant B. Subsequent `loadTrips()` for tenant B won't return it.

**Mitigation:** A2's RPC scopes by `auth.uid()` → `tenant_members` → tenant_id at write time, so the trip lands in the right tenant. The user just doesn't see it from the wrong tenant context — same as any other tenant-scoped data. Not a true bug.

### 8.5 Post-create routing — already a separate bug, A3 makes it visible

With A3.4 wired, post-create navigation will work for the first time. If A3.4 ships before A3.3 (singular/plural fix), the new `navigate('/trip/${id}')` works but every existing trip card click still 404s. Confusing UX where "newly created trips work, existing ones don't."

**Mitigation:** Ship A3.3 + A3.4 together (already in the recommended order).

### 8.6 `provisioning_lists.trip_id` rejection

A user creates a provisioning list with a Supabase trip ID after A3 lands. The column accepts uuid, no FK yet, insert succeeds. **Low risk.** A4 adds the FK; pre-A4 cleanup run defensively nulls any non-matching rows.

### 8.7 Embedded-array writes silently strand

Hybrid strategy keeps `addItineraryDay` etc. writing to `cargo.trips.v1`. If a user loses access to that browser/device pre-A4, those writes are gone. Same as today — no regression — but worth flagging that the current localStorage data risk doesn't go away with A3.

### 8.8 `GuestDetailPanel.jsx:163` direct localStorage write

Bypasses `updateTrip`. After A3.1, the read path no longer reflects this write (Supabase doesn't see it). Data on the guest detail page diverges from the dashboard.

**Mitigation:** Fix during A3.1 — replace the direct write with a call to the proper `updateTrip` helper. Small additional scope in that phase.

### 8.9 The post-A3 cleanup queue grows

Every phase deferred (itinerary, special dates, photos, charter docs, hero images, broker, activity log) means a future migration phase. None are user-facing breaking changes; just tech-debt accounting.

---

## Section 9 — Pre-existing issues surfaced during this audit

Things that aren't "A3 work" but discovered while writing this doc. Listed for the post-A3 cleanup queue (already tracked from prior sessions, plus new entries from this audit).

### Already known (carry forward)

1. **Orphan `src/utils/guestStorage.js`** — zero importers, dead localStorage shim. Delete in post-A3 cleanup.
2. **`useGuests` shape divergence** — pantry returns raw snake_case, trips expect camelCase via `mapRowToGuest`. Two parallel shapes. Refactor target post-A3.
3. **`normalizeTier` field-name mismatch** — fixed in `8b7e2a2`. Comment in the code points at the cleanup queue.
4. **`loadGuests` await/shape audit** — completed and fixed in `320c59a`. Closed.

### Newly surfaced in this audit

5. **Singular/plural nav bug** — `/trips/${id}` calls vs `/trip/:tripId` route. Five sites in the trips dashboard. Recommended bundle with A3.3 + A3.4.

6. **Post-create modal doesn't navigate.** After `createTrip` succeeds, the user stays on the dashboard with no signal beyond the new card appearing. Lauren expected detail-page redirect. Not a missing page — wiring gap. A3.4.

7. **`GuestDetailPanel.jsx:152, 163` directly read AND write `cargo.trips.v1`.** The write bypasses `updateTrip`'s permission gate. Pre-existing latent bug; surfaces sharply after A3.1 because the write goes to a store nobody reads anymore. Fix during A3.1.

8. **`provisioning-management-dashboard/index.jsx:50` and `CreateProvisioningListModal.jsx:47`** define a local `loadLocalTrips()` helper instead of importing `loadTrips`. Five other direct localStorage reads exist in provisioning code. They all need migration in A3.2.

9. **`trip.id` format incompatibility with `provisioning_lists.trip_id` (uuid).** The provisioning create modal currently writes localStorage trip IDs into a uuid column. Either failing silently or never exercised. A3 fixes the upstream by switching the read path to Supabase UUIDs.

10. **`tripStorage.js` permission gate** uses the now-correct `normalizeTier` post-`8b7e2a2`, but the same gate is applied to ten different write methods (createTrip, updateTrip, deleteTrip, toggleGuestActiveStatus, addItineraryDay, updateItineraryDay, deleteItineraryDay, addSpecialDate, updateSpecialDate, deleteSpecialDate). All ten share the upstream — already verified during the `8b7e2a2` fix. No additional action.

11. **`trips-management-dashboard/index.jsx:163-175`** has a stale `loadGuestsData()` definition AFTER the now-correct `fetchTrips` was fixed. Triple-check that nothing else still calls the legacy localStorage shim. Already grepped during the prior fix — clean — but A3 should re-verify since it's the same file getting touched.

### Future filing (not blocking A3)

12. **`AddTripModal` accepts `guests` as a prop instead of fetching independently.** Once `useTrips()` lands (post-A3 B5-prep), the modal could subscribe directly. Currently coupled to the dashboard for guest data — fine for now.

13. **`getActiveGuestsFromCurrentTrip()`** returns guests of the "current" trip — definition of "current" lives entirely in the helper. Once A3 ships and trip status is computed server-side from dates, this helper might want to move to a Supabase view. Future polish, not A3.

14. **Preferences are already on Supabase** (`preferencesStorage`); `tripStorage.js` re-exports `createPreference`/`updatePreference`/`deletePreference` shims. Once trips are Supabase too, the trip-side wrappers around preference helpers can be deleted in favour of direct calls.

---

## Appendix — `tripStorage.js` exports inventory (for swap-order completeness)

Every export. Phase column = which A3 sub-phase the helper's swap belongs to.

| Export | Type | Phase |
|---|---|---|
| `TripStatus` | const | (no swap — frontend enum) |
| `TripType` | const | (no swap) |
| `SpecialDateType` | const | (no swap, deferred phase) |
| `SpecialRequestStatus` | const | (no swap, deferred phase) |
| `TripActivityType` | const | (deferred phase) |
| `TripActions` | const | (no swap) |
| `PreferenceCategory`, `PreferencePriority` | const | (preferences already Supabase) |
| `loadTrips` | reader | A3.1 |
| `createTrip` | writer | A3.5 |
| `updateTrip` | writer | A3.5 |
| `deleteTrip` | writer | A3.5 |
| `getTripById` | reader | A3.1 |
| `getActiveTrip` | reader | A3.1 |
| `getActiveGuestsFromCurrentTrip` | reader | A3.1 |
| `toggleGuestActiveStatus` | writer (trip_guests) | A3.5 |
| `getActiveGuestCount` | pure | (no swap) |
| `getPreferencesCoveragePct` | pure (over preferences) | (no swap) |
| `getOpenRequestsCount` | pure | (deferred — operates on `specialRequests` array) |
| `getUpcomingSpecialDatesCount` | pure | (deferred) |
| `getProvisioningStatus` | pure | (deferred — relies on `provisioningStatus` field) |
| `getLaundryStatus` | pure | (deferred) |
| `addItineraryDay` / `updateItineraryDay` / `deleteItineraryDay` | writer | deferred phase (A4 or later) |
| `addSpecialDate` / `updateSpecialDate` / `deleteSpecialDate` | writer | deferred |
| `addSpecialRequest` / `updateSpecialRequest` / `deleteSpecialRequest` | writer | deferred |
| `logTripActivity` / `getTripActivityLog` | writer / reader | deferred |
| `loadPreferences` / `createPreference` / `updatePreference` / `deletePreference` | preferences | (already Supabase, shim only) |
| `getPreferencesByTrip` / `getPreferencesByGuest` / `getPreferencesByTripAndGuest` | reader | (already Supabase) |

---

## Status

**Audit complete.** No code changes proposed in this doc. Production state unchanged.

Next step: pause for Lauren to review. After approval, Phase A3.1 proper begins as a separate session.

---

## Addendum — `GuestDetailPanel.jsx:163` bypass investigation

Read-only follow-up commissioned in the PR1 review. Findings written here so PR3 (A3.5) can act on them. No fix applied.

### What field is being written

Two fields on the localStorage trip object, looped across **every trip** that includes the guest:

```js
// GuestDetailPanel.jsx:152-164
const allTrips = JSON.parse(localStorage.getItem('cargo.trips.v1') || '[]');
let tripsUpdated = false;
allTrips?.forEach(trip => {
  const guestIndex = trip?.guests?.findIndex(tg => tg?.guestId === guest?.id);
  if (guestIndex !== -1) {
    trip.guests[guestIndex].isActive = newActiveState;
    trip.guests[guestIndex][newActiveState ? 'activatedAt' : 'deactivatedAt'] = new Date()?.toISOString();
    tripsUpdated = true;
  }
});
if (tripsUpdated) {
  localStorage.setItem('cargo.trips.v1', JSON.stringify(allTrips));
}
```

Specifically:
- `trip.guests[].isActive` (boolean, toggled)
- `trip.guests[].activatedAt` OR `trip.guests[].deactivatedAt` (ISO timestamp, branched on the new state)

The `setItem` writes the entire trips collection back, not just the affected trips.

### User flow

1. User opens `/guest-management-dashboard`
2. Clicks a guest card → opens `GuestDetailPanel`
3. Sees the "Active on current trip" toggle
4. Clicks it
5. `handleActiveToggle()` runs:
   - Optimistic `setFormData` flip
   - **Supabase write:** `updateGuest(guest.id, { isActiveOnTrip: newActiveState })` — RLS-enforced on the guest row
   - **localStorage write (the bypass):** the `forEach` loop above
   - Toast: "Guest activated on current trip" / "Guest removed from current trip"

The Supabase write updates `guests.is_active_on_trip` (the **global** "currently on board" flag). The localStorage write updates **per-trip** membership. These are conceptually distinct but the UI conflates them under a single toggle.

### Permission tier reaching the flow

Toggle rendered inside `{canEdit && !isDeleted && (...)}` (line 751). `canEdit` resolves in `guest-management-dashboard/index.jsx:51`:

```js
const userTier = String(currentTenantMember?.permission_tier || '').toUpperCase().trim();
const isCommandOrChief = userTier === 'COMMAND' || userTier === 'CHIEF';
const canEdit = DEV_MODE ? true : isCommandOrChief;
```

So **COMMAND** and **CHIEF** can reach the toggle. **CREW** cannot (toggle isn't rendered).

This is the same numeric tier check as `tripStorage.toggleGuestActiveStatus` (which calls `normalizeTier(currentUser)` against the same allow-list at tripStorage.js:425). **Both code paths arrive at the same allow-list.** The bypass is not a permission escalation — just a different code path that produces the same allow/deny outcome via a different gate object.

### What's actually broken (correcting the audit's earlier wording)

Section 9 #7 said "bypasses `updateTrip`'s permission gate." That phrasing is imprecise. The UI **does** gate at `canEdit`. Three real problems remain:

1. **No activity log entry.** `tripStorage.updateTrip` and `tripStorage.toggleGuestActiveStatus` both append to `tripActivityLog` and call `logActivity()` for the global activity feed. The direct localStorage write skips both — toggles are invisible to anyone reviewing trip history.

2. **No tenant scoping.** The `forEach` mutates **every localStorage trip** that includes the guest. Today this is benign because localStorage is per-device per-user, but the moment A3 ships and trips move to Supabase, "loop all trips" becomes a multi-tenant bug if the same code path persists unchanged.

3. **Field-name divergence.** GuestDetailPanel writes `isActive`, `activatedAt`, `deactivatedAt`. `tripStorage.toggleGuestActiveStatus` writes `isActive`, `activatedAt`, `activatedByUserId` (no `deactivatedAt`). Two writers producing structurally different rows in the same array — last writer sets the per-guest schema.

### What the permission **should** be

Toggling per-trip guest membership is a partial trip update. `toggleGuestActiveStatus` already encodes the right rule: COMMAND/CHIEF only. **No tier change needed.** The bug is the duplicate code path, not the gate.

Post-A3 the relevant table is `trip_guests` (A1's join table). The toggle becomes:
- `UPDATE guests SET is_active_on_trip = X WHERE id = guest_id` (global, already RLS-scoped)
- `UPDATE trip_guests SET is_active_on_trip = X WHERE guest_id = guest_id` (per-trip, RLS resolves tenant via parent `trips` per the A1 policy)

Both writes in one transaction, RLS enforces tenant isolation, no localStorage involvement.

### Recommended fix shape — three options for PR3 to choose from

#### Option A — Route through `toggleGuestActiveStatus` per-trip

Replace the `forEach` localStorage write with:

```js
const allTrips = loadTrips();
allTrips
  .filter(t => t.guests?.some(tg => tg.guestId === guest.id))
  .forEach(t => toggleGuestActiveStatus(t.id, guest.id));
```

**Pros:** Activity log fires. Permission check fires per call. Smallest change.
**Cons:** Still loops in JS. After A3.5 makes `toggleGuestActiveStatus` async, this becomes `Promise.all(...)`.

#### Option B — New RPC `set_guest_active_state(guest_id, is_active)`

Single Supabase call updating `guests.is_active_on_trip` + every matching `trip_guests.is_active_on_trip` in one transaction, RLS-scoped. JS handler becomes one `supabase.rpc(...)`.

**Pros:** Atomic, no JS loop, RLS enforces tenant, single audit-log surface via trigger on the RPC.
**Cons:** Requires a migration. Schema-side decision needed: does turning a guest off globally also turn off membership on every trip, or only on the active trip? Current code does "every trip"; not necessarily what users want.

#### Option C — Move the field out of the trip object entirely

Once A3 ships, the per-trip `isActive` flag has a Supabase home (`trip_guests.is_active_on_trip`). Instead of mirroring it into localStorage at all, the GuestDetailPanel toggles `trip_guests.is_active_on_trip` for the relevant trip(s).

**Pros:** One source of truth.
**Cons:** Forces the UX question — which trips to touch? Probably needs `for_active_trip_only` semantics or a UX redesign.

### Recommendation for PR3

**Option A as the immediate fix in PR3.** Smallest change, preserves activity logging, fits the existing helper surface, and survives A3's read-path swap because `toggleGuestActiveStatus` is already in the wave-of-helpers slated for A3.5 migration.

Option B / C are post-A3 cleanup territory, possibly bundled with a small UX conversation about what the toggle is supposed to do across multiple trips.

---

## Addendum — `migrate_localstorage_trip` v1 → v2 RPC fix

Found while debugging the missing `trip_guests` rows on existing migrated trips. Filed for the audit trail; the fix has shipped as `supabase/migrations/20260427120300_migrate_trip_rpc_v2.sql`.

### The bug

The v1 RPC (`20260427120200_migrate_trip_from_localstorage.sql`) returned early when a trip with the given `legacy_local_id` already existed, **skipping the guest-linking block entirely**:

```sql
-- v1 (buggy)
SELECT id INTO v_trip_id FROM trips
 WHERE legacy_local_id = p_legacy_id AND tenant_id = v_tenant_id LIMIT 1;

IF v_trip_id IS NOT NULL THEN
  RETURN v_trip_id;  -- ← bails here, never reaches guest linking
END IF;
```

Any trip whose first migration call landed the trip row but failed to link guests (e.g. `p_guest_ids = []` on the first call, or partial-failure mid-loop) stayed broken forever — subsequent runs hit the early-return and never re-attempted guest linking. Production manifestation: trips migrated with empty `trip_guests` arrays. Two existing trips were patched manually with raw SQL.

### The fix (v2)

```sql
-- v2 (correct)
SELECT id INTO v_trip_id FROM trips
 WHERE legacy_local_id = p_legacy_id AND tenant_id = v_tenant_id LIMIT 1;

IF v_trip_id IS NULL THEN
  INSERT INTO trips (...) VALUES (...) RETURNING id INTO v_trip_id;
END IF;

-- Always runs — both fresh-insert and found-existing paths reach here.
-- ON CONFLICT (trip_id, guest_id) DO NOTHING already in the loop keeps
-- re-runs idempotent at the trip_guests level.
IF p_guest_ids IS NOT NULL AND array_length(p_guest_ids, 1) > 0 THEN
  FOREACH v_guest_id IN ARRAY p_guest_ids LOOP
    INSERT INTO trip_guests (trip_id, guest_id, is_active_on_trip)
    SELECT v_trip_id, g.id, true
      FROM guests g
     WHERE g.id = v_guest_id AND g.tenant_id = v_tenant_id
    ON CONFLICT (trip_id, guest_id) DO NOTHING;
  END LOOP;
END IF;

RETURN v_trip_id;
```

### Manual data patch (already applied)

The two affected trips were repaired in production with direct SQL inserts into `trip_guests`. The third trip (still pending migration at the time of the fix) will pick up correct linking via the v2 RPC on its next migration runner pass.

### Why this slipped through A1's local Postgres verification

A1's local-Postgres test matrix exercised the happy path (trip + 2 guests inserted in one call) and the idempotency check (re-call with same `legacy_id` returns the same uuid). Both passed. **Neither test exercised the partial-failure recovery path** — first call with empty `p_guest_ids`, then second call with populated `p_guest_ids`. That gap is what allowed the early-return to ship.

Future A* RPC tests should include a "partial-failure recovery" case: simulate the writer landing the parent row but failing on dependent inserts, then verify a re-run reconciles correctly.

### Filed for the post-A3 cleanup queue

- **Once the localStorage→Supabase migration is fully complete** (Phase A2 retired, no users left on localStorage), the `migrate_localstorage_trip` RPC + the `legacy_local_id` column can both be dropped. Tracker entry already exists in Section 9 of this doc.

---

## Addendum — PR2 verification findings + `findTripByAnyId` pattern

PR2 (read-path swap, A3.1 + A3.2) shipped on `claude/trips-a3-read-path-swap`. Verification surfaced three bugs; two were fixed in the PR, one was confirmed pre-existing and filed separately.

### Bug 1 — `loadTripData not defined` inside `GuestsSection`

**Pre-existing, surfaced by PR2 verification.**

`GuestsSection` (top-level component at line 2033 of `trip-detail-view-with-guest-allocation/index.jsx`) is a sibling of `TripDetailView`, not a nested closure. Its `handleSelectExistingGuest` referenced the parent's `loadTripData` / `loadGuestsData` directly, which threw `Uncaught ReferenceError` on every "+ existing guest" click. The toast appeared (write succeeded) but the re-render never fired because the refresh path threw.

`handleCreateNewGuest` in the same component used the `onUpdate` prop correctly. The select-existing path was inconsistent.

**Fix**: parent's `onUpdate` prop wraps both `loadTripData()` and `loadGuestsData()`; the existing-guest handler uses `onUpdate()` matching the create path. One coherent refresh boundary at the prop layer.

**Lesson**: when a top-level component in a multi-component file references functions, grep the file for stray references against outer-scope locals — they don't exist in closure. Pattern: prop drilling, not implicit closure.

### Bug 2 — legacy id sent to `provisioning_lists.trip_id` (uuid column)

**Introduced by the merge shape.** PR2's hybrid trip object exposes the legacy `trip-{ts}-{rand}` string as `trip.id` (URL/comparison compat) and the canonical Supabase uuid as `trip.supabaseId`. The provisioning trip-link write path was sending `trip.id`, which Postgres rejected with `invalid input syntax for type uuid: "trip-1777406393909-iqd788rbk"`.

**Fix — five layers** (committed in `c9e308b`):

1. **New helper `findTripByAnyId(trips, value)`** in `tripStorage.js` — pure, matches by either `supabaseId` or `id`. Solves the dual-format lookup problem during the migration window.
2. **`getTripById` widened** to use `findTripByAnyId` so URL-based nav (legacy id) and FK reads (uuid) both resolve.
3. **Three trip dropdowns** (`CreateProvisioningListModal`, `BoardDrawer`, `ProvisioningForm`) — option `value` is `t.supabaseId || t.id` so form state matches the uuid column shape.
4. **Submit-time resolution** in `NewBoardColumn` — `onCreated` payload uses `selectedTrip.supabaseId`.
5. **Seven existing `trips.find(t => t.id === value)` lookups** across the provisioning surfaces switched to `findTripByAnyId`.

LS-only pending-sync trips (created locally, not yet migrated) lack a `supabaseId`. The dropdown still renders them with legacy id as fallback; insert into `provisioning_lists.trip_id` would fail uuid validation if selected — acceptable, you shouldn't be able to FK-link to a trip that doesn't exist server-side. PR3's write swap eliminates this case (all new trips will get a Supabase uuid at create time).

### Bug 3 — `/inventory/weekly` bounces to dashboard (PRE-EXISTING, NOT FIXED IN PR2)

`git diff main..HEAD` confirms PR2 didn't modify `InventoryWeeklyPage.jsx` or any of its direct dependencies (`useGuests`, `useInventoryThisWeek`, `useInventoryInsights`). The "getInventoryHealthStats placeholder" warning is from `InventoryHealthWidget` on the dashboard — a separate component. The 400 errors and bouncing-to-dashboard need their own investigation in a follow-up PR. Filed separately.

### Pattern: dual-id lookup during migration windows

`findTripByAnyId` is a **reusable pattern** for any future migration that needs to support a legacy id format and a new canonical id format simultaneously during a transition window. The shape:

```js
// Pure helper — no DB calls, operates over a pre-fetched array.
// Matches by either format. Either id type can be passed in by
// callers, regardless of whether they hold legacy state (URLs,
// older saves) or canonical state (FK columns, new writes).
export const findTripByAnyId = (trips, value) => {
  if (!value || !Array.isArray(trips)) return null;
  return trips.find(t => t?.supabaseId === value || t?.id === value) || null;
};
```

**When to use this pattern:**
- A read-path swap that introduces a new canonical id format alongside an existing legacy format
- Transition windows where some callers have already adopted the new format (FK columns, new writes) while others still hold the old format (URLs, cached state, older saves)
- Where a forced flip would cascade into URL changes, broken bookmarks, or breaking caller assumptions

**Why it's load-bearing:**
- The merge layer's output exposes BOTH formats on each row (`trip.id` legacy, `trip.supabaseId` canonical) so renderers can pick what they need
- Lookup helpers like `findTripByAnyId` and `getTripById` accept either format transparently, so callers don't need to know which they hold
- Write boundaries explicitly resolve to the canonical format (`selectedTrip.supabaseId`) so the wire format is always the new shape

**Cost ledger:**
- Two id fields per row instead of one
- Lookup is O(N) with a 2x constant (checks two fields per row); acceptable for the small N of trips
- Some callers may need updating to use `findTripByAnyId` instead of inline `trips.find(t => t.id === ...)` — grep'd in PR2's review and 7 sites caught
- Once the legacy format is fully retired (post-A3 + cleanup window), `trip.supabaseId` collapses back to `trip.id` and the helper deletes

**Apply elsewhere if/when:**
- The guests, preferences, or any other localStorage→Supabase migration ever needs the same hybrid window. Same shape: legacy id field for compat, canonical uuid field for forwards, dual-lookup helper.
- The provisioning_lists FK migration in A4 — similar shape if it needs to support pre-A3 legacy strings on existing rows (it shouldn't, but if it does, the pattern's there).

### Filed for post-A3 cleanup

- Add Guest modal — slow load on existing-guest list, no skeleton/spinner. Add loading state while `loadGuests()` resolves.
- Provisioning board view — doesn't surface linked trip name after creation. Save works (FK correct), display path needs the trip name fetched + rendered. Lauren is working on a provisioning page update in a separate sprint; folds into that scope.
- `/inventory/weekly` bounce-to-dashboard + 400 errors — pre-existing investigation needed.
