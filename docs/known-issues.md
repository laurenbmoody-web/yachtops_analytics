# Known issues / tech debt

Running log of things we've deliberately parked. Newest first.

---

## `get_my_context()` over-filters on `tenant_members.status = 'ACTIVE'` — inconsistent with the rest of the auth stack

**Logged:** 2026-06-12 · **Status:** RESOLVED 2026-11-26 — option (a)

> **Resolution:** `20261126120100_get_my_context_leave_statuses.sql` drops the
> status gate (keeping `active = true`, and excluding only `'invited'`). Crew
> marked `on_leave`, `rotational_leave`, `medical_leave`, `training` or
> `travelling` now resolve their real tier instead of NULL → least-privileged.
> `tenant_members.status` is a crew lifecycle label, not an access gate;
> `active` + `permission_tier` is the source of truth across the stack.
> Follow-up `20261126130000_leave_statuses_keep_access.sql` removed the same
> `upper(tm.status) = 'ACTIVE'` gate from 24 RLS policies (job steps / checklist
> items / links / reminders, duty-set templates, duty task progress) and from
> `get_tenant_members_for_jobs`. Still present but harmless: a few policies and
> helpers (`tm_is_member`, `tm_my_role`, `get_my_active_memberships`, and one
> policy each on `profiles`, `rotation_assignments`, `tenants`) compare
> `status = 'ACTIVE'` case-sensitively, which matches no row — they are dead and
> other policies grant the access. Clean them up rather than "fix" them, since
> making them live would widen rotation_assignments writes to HODs.
> Intentional: the sign-in board (`crewPresence.js`) lists only `status =
> 'active'` crew — that is "who is serving", not access.

**Symptom that surfaced it:** A COMMAND user was locked to view-only on `/vessel-settings` (could not edit the vessel profile) even though they are COMMAND.

**Diagnosis:**
- `get_my_context()` (`supabase/migrations/20260224193000_fix_get_my_context_use_permission_tier.sql`) resolves the caller's `role` from `tenant_members` filtered by `active = true` **AND `status = 'ACTIVE'`**. If a member's `status` is anything other than exactly `'ACTIVE'` (e.g. NULL), the RPC returns a **null role**, and callers that default that to `'CREW'` silently lose permissions.
- The rest of the auth stack does **not** use `status`:
  - `AuthContext` bootstrap reads `permission_tier` filtered only by `tenant_id` + `active = true` (`src/contexts/AuthContext.jsx`).
  - `hasCommandAccess()` keys off `permission_tier` alone (`src/utils/authStorage.js:304`).
  - The `vessels` RLS UPDATE/INSERT policies require `permission_tier = 'COMMAND' AND active = true` — **no status filter** (`supabase/migrations/20260207105200_add_vessels_rls_policies.sql`).
- So `permission_tier` + `active` is the de-facto source of truth; `get_my_context`'s extra `status = 'ACTIVE'` gate is the outlier. The vessel-settings page loaded (tenant_id comes from `profiles.last_active_tenant_id`, not the status-filtered query) but `canEdit` came back false.

**Immediate fix applied (vessel-settings only):** `canEdit` now derives from `useAuth().hasCommandAccess()` (authoritative `permission_tier`), with the RPC role kept as a fallback. Commit on branch `claude/practical-pasteur-6Bnih`.

**Still to do (the parked, whole-app part):**
1. Audit every consumer of `get_my_context()` for permission gates that trust its `role` — those have the same latent lock-out.
2. Decide the correct fix at the source, one of:
   - **(a)** Relax `get_my_context()` to drop the `status = 'ACTIVE'` requirement (keep `active = true`), so it matches `AuthContext` + RLS everywhere. Lowest-friction, aligns the stack. Need to confirm nothing intentionally relies on `status` gating here.
   - **(b)** Treat `status` as a real lifecycle gate and instead ensure member rows are correctly stamped `status = 'ACTIVE'` (data fix + onboarding writes), then keep the filter. Heavier; only if `status` is meant to gate access.
3. Clarify the intended semantics of `tenant_members.status` vs `active` (and `permission_tier_override`) so future code uses one consistent activeness check.
