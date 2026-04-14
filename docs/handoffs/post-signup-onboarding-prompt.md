# Post-signup onboarding flow — Claude Code implementation prompt

**Drafted:** 2026-04-14 by Lauren + Claude (Cowork)
**Trigger:** After a user completes `/set-password` (from the invite email flow built in `HANDOFF_set-password-page.md`) OR lands on `/welcome` from the Stripe checkout webhook's magic-link email.
**Visual / UX reference:** `/mnt/Cargo/onboarding-flow-mockup.jsx` — a clickable React mockup with the exact structure, copy, animations, and Cargo brand styling we want. Read this file first, then mirror its behaviour in the real codebase.

---

## TL;DR

Build the post-signup onboarding flow at `/onboarding`. Three progressive steps (Vessel settings → Departments → Invite crew) followed by a dashboard welcome state with a progress tutorial. The flow pulls data the user already gave us (vessel verification at checkout, tier, user identity) and only asks for what we don't have. On completion, mark the tenant as onboarded and drop them on the real dashboard.

---

## Step 0 — Read this first, don't skip

1. Read `/mnt/Cargo/onboarding-flow-mockup.jsx` end to end. Copy the copy verbatim. Mirror the 3-section progressive disclosure on step 1, the department grid + custom "Other" pattern, the invite paste parser, and the dashboard hero with anchor-and-chain progress. These are UX decisions already made with Lauren — do NOT redesign.
2. Read `HANDOFF_set-password-page.md` if you haven't — the redirect target after password set should be `/onboarding` for brand-new users.
3. Read `src/pages/vessel-settings/index.jsx` — the field list, types, and validation in the mockup are mirrored from this file. Reuse the same fields and, where possible, the same save path.
4. Read `src/pages/crew-management/components/InviteCrewModal.jsx` and `src/utils/authStorage.js` — the department enum and role-by-department cascade in the mockup come from here. Reuse them.
5. Read `src/marketing/pages/HomePage.jsx` and `src/styles/tailwind.css` — the brand tokens (navy `#1E3A5F`, accent `#00A8CC`, fonts Outfit / Plus Jakarta Sans / Archivo) and the pill button component are here.

Do NOT start coding until steps 0.1–0.5 are done.

---

## Step 1 — Schema investigation (mandatory, no code yet)

**Pre-confirmed facts (do NOT re-derive, do NOT duplicate):**

- Every vessel-settings field the onboarding step 1 collects ALREADY exists on `public.tenants`. See `supabase/migrations/20260124161000_add_vessel_settings_fields.sql` and `20260124164700_add_vessel_type_label.sql`. Columns present: `flag`, `port_of_registry`, `imo_number`, `official_number`, `loa_m`, `gt`, `year_built`, `year_refit`, `vessel_type_label`, `commercial_status`, `certified_commercial`, `area_of_operation`, `operating_regions`, `seasonal_pattern`, `typical_guest_count`, `typical_crew_count` (plus `ism_applicable`, `isps_applicable`, `departments_in_use`, `bonded_stores_enabled`, `multi_location_storage`). `tenants.name` IS the vessel name. Stripe fields (`stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `plan_tier`, `billing_period`) exist from `20260410120000_add_stripe_billing_fields.sql`. **Do NOT add any of these columns again.**
- Step 1 of onboarding saves back to `public.tenants`. Match the save path used by `src/pages/vessel-settings/index.jsx` (direct RLS-scoped update or existing RPC — reuse, don't re-invent).

**Still to inventory (this IS the investigation to do):**

1. `departments` — does a real table exist, or are departments enum-only in code? `tenants.departments_in_use text` already exists; check if there's also a proper `departments` table + join, or if we read/write the enum list straight into that text column. Whatever the repo currently does, reuse it.
2. `profiles` — confirm there are NO existing `custom_departments`, `dashboard_tutorial_dismissed_at`, or `onboarding_tutorial_state` columns.
3. Confirm `tenants.onboarding_completed_at` does NOT yet exist.
4. Invite path — the HANDOFF says invites go through `inviteUserByEmail`. Find the current caller (likely a Supabase edge function or server action) and reuse it.

Write a short note in the PR body documenting what you found on points 1–4.

---

## Step 2 — Migrations (exact, minimal set)

Write ONE SQL migration file with exactly these four columns — nothing else. Vessel-settings columns on `tenants` already exist (see Step 1); do NOT re-add them.

```sql
-- tenants: onboarding completion flag
alter table public.tenants
  add column if not exists onboarding_completed_at timestamptz;

-- profiles: per-user custom departments (NEVER tenant-wide)
alter table public.profiles
  add column if not exists custom_departments jsonb not null default '[]'::jsonb;

-- profiles: dashboard welcome-tutorial state
alter table public.profiles
  add column if not exists dashboard_tutorial_dismissed_at timestamptz,
  add column if not exists onboarding_tutorial_state jsonb not null default '{}'::jsonb;
```

RLS on the new `profiles` columns inherits whatever the rest of `profiles` uses (user reads/writes their own row only) — no new policies needed. If existing `profiles` policies are column-scoped rather than row-scoped, widen them to cover the new columns.

Locked design rule: custom departments live on `profiles.custom_departments` per user and MUST NEVER be written to a tenant-wide `departments` table or to `tenants.departments_in_use`.

**Commit 1:** `feat(schema): onboarding completion flag + per-user custom departments and tutorial state`

---

## Step 3 — Route + guards

1. Add route `/onboarding` to `src/Routes.jsx`. It's only accessible when the user is authenticated AND `tenants.onboarding_completed_at` for their tenant is NULL. If onboarding is already complete, redirect to `/dashboard`.
2. Wrap in a new `OnboardingRoute` HOC that performs the check. Follow the pattern of `ProtectedRoute` / `VesselAdminRoute` that already exist in that file.
3. From `/set-password`, on successful password update, call `navigate('/onboarding')` for users whose tenant has no `onboarding_completed_at`. For everyone else (returning users resetting a password somehow, shouldn't happen but defensive) → `/dashboard`.
4. The Stripe-checkout magic-link email IS the set-password email for brand-new customers — it should land on `/set-password`, not `/welcome`. Confirm the webhook's `inviteUserByEmail` / magic-link call has `redirectTo` pointing at `https://cargotechnology.netlify.app/set-password`. From `/set-password` success, the normal new-user redirect to `/onboarding` (step 3.3 above) takes over. If a `/welcome` route still exists from earlier work, delete it or make it a thin redirect to `/onboarding` — there should be exactly one post-signup path: set-password → onboarding → dashboard.

**Commit 2:** `feat(routes): add /onboarding route with completion guard`

---

## Step 4 — Step 1: Vessel settings (3 progressive sections)

Build `src/pages/onboarding/VesselSettingsStep.jsx`. Match the mockup exactly:

- Three sub-sections revealed progressively: **Who is your boat?** (name, type, flag, port of registry) → **Her specs** (IMO, Official Number, LOA, GT, year built, year refit) → **How does she operate?** (commercial status, certified commercial, area of operation, operating regions, seasonal pattern, typical guest/crew counts).
- Each section collapses to a summary row with a green tick once confirmed. Clicking the summary re-opens it.
- Pre-fill every field from the existing tenant row — the Stripe webhook already saved vessel name, IMO, and any verification data at checkout. Don't ask the user to re-type what we have.
- Personal hero title: "Welcome aboard {vessel_name}" when we have one, else "Welcome aboard".
- Tooltips on the key fields (copy lifted from the mockup). Build a shared `Tooltip` component or reuse one if the repo has it.
- All cards use the raised Cargo border style: 1px navy top/left/right, 3px navy bottom.
- On "Continue" from the last section, save the whole vessel payload to the tenant row (via the RPC from step 1.5 or a direct update). Progress to step 2.

---

## Step 5 — Step 2: Departments (base from DB + user-local "Other")

Build `src/pages/onboarding/DepartmentsStep.jsx`.

- Load base departments from the Supabase `departments` table on mount. These are tenant-wide.
- Pre-select whichever departments are already associated with this tenant (likely the default 5: Bridge / Interior / Deck / Engineering / Galley — confirm from step 1).
- User can tap to toggle selection. Tick animates in with a spring (mockup class `cg-tick-pop`).
- Below the grid: an input + "Add" button that lets the user add custom departments. These append to the on-screen grid with a "Custom · only you" badge. **Do NOT write custom departments to the `departments` table.** They persist on `profiles.custom_departments` for this user only. Other crew on the same vessel won't see them.
- No tenant-wide write of custom departments under any circumstances.
- Personalised heading uses vessel name from step 1.
- On Continue: save selected base-department IDs to whatever tenant→departments join the repo uses (discover in step 1), and save custom-department names to `profiles.custom_departments` for the current user.

---

## Step 6 — Step 3: Invite crew (cascading + paste parser)

Build `src/pages/onboarding/InviteCrewStep.jsx`.

- One invite row = email + department select + role select. Department select shows both base + the user's custom departments from the previous step. For base departments, role is a select driven by `ROLES_BY_DEPT` (from `authStorage.js` or equivalent). For custom departments, role is a free-text input.
- "Add another" appends a blank row. Trash icon removes a row.
- **Paste from spreadsheet** — a collapsible textarea that parses comma-or-tab-separated lines: `email, department, role`. Fuzzy-match the department string against both base and custom departments (normalise: lowercase, strip non-alphanumeric). Unknown departments leave the department cell blank for the user to resolve manually. Show a success count.
- Footer: **primary button is "Do this later → Go to dashboard"** (navy pill). Secondary button is "Send invites" (outlined). Below-right helper text: "Most captains start solo and invite crew once they've had a look around."
- On "Send invites": call the existing invite path (discovered in step 1) for each valid row. On "Do this later": skip the invite step entirely.
- Either completion path: mark `tenants.onboarding_completed_at = now()` and navigate to `/dashboard`.

**Commit 3:** `feat(onboarding): add 3-step post-signup onboarding flow`

---

## Step 7 — Dashboard welcome state

This is tricky — it lives on `/dashboard`, not `/onboarding`, and has to show for a window AFTER onboarding completes. Approach:

- Add a derived state on the dashboard: `showOnboardingTutorial = onboarding_completed_at is within last 30 days AND user has not dismissed it`. Store dismissal on `profiles.dashboard_tutorial_dismissed_at`.
- Render the tutorial block at the top of the dashboard when active. Copy lifted from the mockup:
  - Hero card (raised Cargo border): anchor + chain progress indicator + heading "Welcome aboard {vessel_name}".
  - Three tutorial cards: Set up vessel locations, Build your inventory folders, Upload your first inventory file. Each has a CTA that routes to the real feature AND marks that tutorial item as done on `profiles.onboarding_tutorial_state jsonb` (design the shape: `{ locations_done: bool, folders_done: bool, upload_done: bool }`).
  - Feature overview grid below: 8 tiles (Provisioning, Trips, Guests, Laundry, Crew, Defects, Team Jobs, Dashboard) — copy and icons from the mockup.
- Progress % calculation: 3 onboarding steps always-done + up to 3 tutorial-done bits → out of 6. Same formula as the mockup.
- Port the anchor-chain progress indicator from the mockup verbatim. That means: the `AnchorChainProgress` component (cleat at top, SVG chain of whole 10px elliptical links, standalone navy anchor symbol with sway animation), the `LivePercent` count-up (requestAnimationFrame, cubic ease-out, 1400ms), the "Onboarding {percent}%" label at matched sizes, and the caption "only a few more shackles to go…" / "Fully anchored." at 100%. This is the signed-off visual — do not substitute a plain progress bar.

**Commit 4:** `feat(dashboard): post-onboarding welcome tutorial with progress tracking`

---

## Step 8 — Admin transfer reminder hookup

If the user answered "No" to the "Will you be Cargo's vessel administrator?" question at signup / checkout (locked design in `project_signup_admin_toggle.md`), the `tenants.admin_transfer_reminder_active` flag is `true`. When that flag is true, surface the banner from that spec AT THE TOP of the dashboard (above the tutorial hero). The banner has two buttons — "Transfer admin" and "Actually, I am the admin" — no dismiss X, per the locked design. Reuse any existing banner infrastructure in the app.

**Commit 5:** `feat(dashboard): wire vessel admin transfer reminder banner`

---

## Step 9 — Testing

Manual test plan — run through all of this before opening the PR:

1. **Stripe checkout → welcome email → /onboarding** (end-to-end in Stripe test mode). Complete all 3 steps. Land on `/dashboard`. Tutorial shows. Progress says 50%.
2. **Invited crew member → set-password → /onboarding**. Should see the same flow, not redirect straight to dashboard.
3. **Completed user hits `/onboarding` again**. Redirects to `/dashboard`. Good.
4. **Step 1 persistence**: fill all 3 sections, click back out to step 2, then back to step 1 — data is still there. Refresh the page mid-flow — data should either persist (if saved after each section) or we restart cleanly.
5. **Custom departments**: add "Dive" and "Toys". They appear with "Custom · only you" badge. Log in as a different crew member on the same tenant — Dive and Toys are NOT visible to them. Confirm by checking `profiles.custom_departments` for each user.
6. **Paste parser**: paste three rows mixing a base department, a custom department, and a typo — confirm typo leaves department blank and a helpful message shows.
7. **"Do this later"**: skips invites, lands on dashboard. Tenant is flagged onboarding-complete.
8. **Admin transfer reminder**: sign up answering No to the admin question, land on dashboard → banner present with both buttons, no dismiss X.
9. **Dashboard tutorial dismissal**: click each tutorial CTA in turn. Each marks done. Progress increments. After all 3, the tutorial block disappears (or compacts — match what you built).
10. **Expired invite**: click an invite link older than the Supabase token lifetime → clear error, no blank page.

---

## Acceptance criteria

- [ ] New `/onboarding` route with proper guard
- [ ] 3 progressive sections in step 1, all mockup fields, all tooltips
- [ ] Base departments from Supabase, custom ones written to `profiles.custom_departments` only
- [ ] Invite paste parser matches against base + custom departments with fuzzy matching
- [ ] "Do this later" is the primary CTA on step 3
- [ ] `tenants.onboarding_completed_at` set on finish
- [ ] Dashboard tutorial appears after onboarding, progress %, CTAs wired, dismiss state persisted
- [ ] Admin transfer reminder banner wired when flag is true
- [ ] All cards use raised Cargo border style (1px navy top/sides, 3px navy bottom)
- [ ] All copy matches the mockup verbatim
- [ ] All 5 commits conventional-commits style

---

## Dependencies / blockers

- Set-password page (HANDOFF_set-password-page.md) must be built OR at minimum its redirect target set to `/onboarding`. Don't build this onboarding flow on a route nothing reaches.
- Stripe checkout onboarding prompt (`payment-page-onboarding-prompt.md`) — these two flows converge on `/onboarding`. If that one is still mid-build, coordinate routing so both paths land here cleanly.
- `departments` schema — if it turns out the repo doesn't yet have a proper departments table (today they may be enum-only in code), adding one is a prerequisite. Call that out and either scope it in or stop and ask Lauren.

## Known open questions for Lauren (ask before merging)

1. Dashboard tutorial lifetime — 30 days, or until dismissed, or until all 3 items done?
2. Admin transfer reminder placement — above the tutorial hero, or below it?
