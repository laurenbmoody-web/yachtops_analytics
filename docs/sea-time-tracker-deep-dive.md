# Sea Time Tracker — Deep Dive & Phase 0 Foundation

**Author:** Claude (dev session)
**Date:** 2026-06-16
**Branch:** `claude/ecstatic-tesla-l16yed`
**Status:** Phase 0 implemented (build green, logic unit-tested). Phases 1–4 planned below.

This document is my read of your build spec against the code that already
exists, what I changed for Phase 0, and the decisions I need from you before
going further.

---

## 1. What already existed (before this session)

The Sea Time Tracker lives under **Profile → crew-profile** and is a
localStorage prototype (no Supabase tables yet):

| File | Role |
|---|---|
| `components/SeaTimeTracker.jsx` | Main screen — "My Sea Time" + command-only "Vessel Sea Time" |
| `components/SeaTimeCalendar.jsx` | Month grid, colour + letter coded |
| `components/AddManualEntryModal.jsx` | 3-step manual entry wizard (period → vessel → evidence) |
| `components/DayDetailDrawer.jsx` | Per-day detail / verification panel |
| `components/AddVesselLogModal.jsx`, `ManageCrewAssignmentModal.jsx` | Command-side vessel log + crew assignment |
| `utils/seaTimeStorage.js` | All data + rules logic |

**The core problem your spec calls out was real in the code:**

- There was **one target only** — a single `targetDays: 1095` (3-year) ring.
  No service-type split.
- The "rules engine" hard-coded `minGT: 80` and a `commercialStatus` check.
  **Length / the ≥15m gate did not exist.** Watch hours did not exist; there
  was only a boolean `watchkeepingRole` that nothing consumed.
- `seaServiceType` ("Underway / In port / Yard period / Standby") was captured
  on manual entries but **never used in qualification**.
- Two latent bugs (now fixed — see §3): manual entries stored **no vessel GT or
  length**, so `checkQualificationForPath` always failed them with "Vessel data
  not available"; and `recomputeQualificationForUser` saved a freshly re-parsed
  (unmutated) copy, so qualification results **never persisted**.

---

## 2. Spec → current-state gap analysis

| Spec item | Before | After Phase 0 |
|---|---|---|
| Four MCA service types (seagoing/watchkeeping/standby/yard) | ❌ single day-count | ✅ every day classified to one primary type |
| Vessel attribution | ⚠️ partial (auto entries only) | ✅ manual entries now snapshot GT + length + type |
| Watchkeeping = watch ≥ 4h rule | ❌ | ✅ config `watchkeepingMinHours` (default 4) |
| Vessel-size gate (≥15m) | ❌ | ✅ config `seagoingMinLengthM` + per-requirement `minLengthM` |
| Config-driven thresholds (not hard-coded) | ❌ | ✅ `getRulesConfig()` / `saveRulesConfig()` |
| Multiple requirement bars (not one 1095 ring) | ❌ | ✅ seagoing 365 + watchkeeping 120 bars |
| Human-readable qualify / non-qualify reason | ⚠️ partial | ✅ `qualificationReason` shown in day drawer |
| Standby cap | ❌ | ✅ rule = standby ≤ actual sea service (MSN 1858 §5.2 / MIN 498); enforced in `engine.js` + `testimonial/validate.js`. No flat day cap. Bar-substitution still deferred. |
| MIN 642 export (PDF/CSV) | ❌ ("coming in V2") | ⬜ Phase 1 |
| Captain sign-off + tamper-evident hash + QR | ❌ (stub) | ⬜ Phase 1/2 |
| Captain attestation cockpit | ❌ (stub) | ⬜ Phase 2 |
| AIS + rota auto-classification | ❌ | ⬜ Phase 3 |
| Predictive coaching | ❌ ("V2 feature" label) | ⬜ Phase 4 |
| Accessibility (WCAG 2.2 AA) | ⚠️ colour+letter on calendar | ⚠️ improved (icon+text on bars/buckets); full audit deferred |
| Offline-first / i18n / deck mode | ❌ | ⬜ cross-cutting, not yet started |

---

## 3. What I built this session (Phase 0)

All in `utils/seaTimeStorage.js` + the four components. **Build passes; the
rules engine is unit-tested against your acceptance criteria (see §5).**

### Rules engine (config-driven)
- New `getRulesConfig()` / `getDefaultRulesConfig()` / `saveRulesConfig()`,
  stored under `cargo_seatime_rules_v2`. **Every threshold is a config value**
  with a `reviewStatus: 'UNVERIFIED'` flag and `// TBC` comments.
- `classifyServiceType(entry)` → exactly one of `seagoing | watchkeeping |
  standby | yard` (so the four buckets always reconcile to the total).
- `evaluateEntryQualification(entry, pathId)` → `{ serviceType, countsToward,
  qualifies, reason, reasons }`. A watchkeeping day counts toward **both** the
  seagoing and watchkeeping bars (watchkeeping happens at sea); gates
  (`minLengthM`, `minGT`) are checked per requirement.
- `getEntryVesselFacts(entry)` resolves GT/length from the managed vessel
  (auto entries) or the entry snapshot / saved vessel (manual entries).
- Rewrote `recomputeQualificationForUser` to load → mutate → save the **same**
  array (fixes the no-op persist bug), and to stamp `serviceType`,
  `countsToward`, `qualificationReason` onto each day.
- `getProgressSummary` now returns `requirements[]` (per-bar verified / pending
  / target / remaining / %) plus `buckets{}` (four-type day counts).

### UI
- **SeaTimeTracker:** replaced the 3 single-ring widgets with per-requirement
  progress bars (two-tone: verified solid + pending light) and a four-bucket
  "Service breakdown" card. Added a visible "Draft thresholds — pending MCA
  verification" badge. Status uses icon **+** text **+** colour (not colour
  alone).
- **AddManualEntryModal:** service-type options relabelled to the MCA four;
  added **Watch hours (per day)**; added required **Registered / Load-line
  length (m)**; snapshots GT/length/type onto each created day.
- **DayDetailDrawer:** shows primary **Service type** and the
  qualify/non-qualify **reason**.
- Fixed manual-entry **duplicate-ID** bug (multi-day ranges collided on
  `Date.now()`).

---

## 4. ⚠️ Compliance — every number here is TO BE CONFIRMED

Per your own caveat, treat the defaults as placeholders, **not** gospel. They
live in `getDefaultRulesConfig()` and are trivially editable:

| Config key | Default (placeholder) | Confirm against |
|---|---|---|
| `watchkeepingMinHours` | 4 | MSN 1858 Amd 2 / MIN 642 |
| `seagoingMinLengthM` | 15 | MSN 1858 Amd 2 size gates |
| `requirements[seagoing-15m].targetDays` | 365 | MSN 1858 Amd 2 OOW thresholds |
| `requirements[watchkeeping].targetDays` | 120 | MSN 1858 Amd 2 |
| `requirements[*].gates.minGT` | 80 | GT bands (<500 / <3000 routes) |
| standby limit | ≤ actual sea service | MSN 1858 §5.2 / MIN 498 — no flat day cap |
| `yardCapDays` | 90 (OOW) / 30 (Master·Chief Mate) | MSN 1858 §3.3–§3.6; per-cert via `yardCapForCertificate()` |

The "UNVERIFIED" badge stays on screen until you set
`reviewStatus: 'VERIFIED'` in config — so no "MCA-compliant" claim can leak out
by accident.

---

## 5. Acceptance criteria — verified

From your Phase 0 acceptance list, tested directly against the engine:

- ✅ A manual day on an **18 m / 600 GT** vessel with a **6-hour watch** →
  auto-classified **watchkeeping**, qualifies, counts toward seagoing **and**
  watchkeeping bars. Reason: *"Counts as Seagoing service (≥15m) + Watchkeeping
  service."*
- ✅ The **same on a 12 m** vessel → **non-qualifying**, reason: *"Vessel length
  (12 m) is below the 15 m minimum for Seagoing service (≥15m)."*
- ✅ Totals **reconcile** across the four buckets (sum of buckets == total days).

---

## 5a. Update — Session 2: moved to Supabase

Per your "move to Supabase now" decision, the tracker's persistence is now real
Postgres (was `localStorage`).

- **Migration `20260617090000_sea_service_foundation.sql`** (applied to *Cargo
  Project* `gwexbrbasfysbheeklyq`, idempotent + additive):
  - `sea_service_entries`, `sea_time_config`, `sea_service_audit` — all
    tenant-scoped with RLS (`is_active_tenant_member` / `is_command_user_in_tenant`).
  - Private `sea-time-signatures` bucket (mirrors `hor-signatures`).
  - `SECURITY DEFINER` RPCs `sea_time_{submit,sign,reject}_entries`. Captain
    sign-off **locks** the row and stamps a server-computed **SHA-256
    `record_hash`** for tamper-evidence.
  - Security-hardened: `anon`/`PUBLIC` execute revoked; trigger `search_path`
    pinned. Advisor shows only the same warning classes that already blanket the
    project (definer-executable / mutable-search-path).
- **`seaTimeService.js`** — async data-access layer; reuses the pure Phase 0
  rules engine over fetched rows (one source of truth for the rules).
- **"My Sea Time" UI is wired to Supabase**: progress bars, calendar, manual
  add (one row/day), day edits, and submit-for-verification all go through the
  service. `tenant_id` flows from `useAuth().activeTenantId`.
- **Verified end-to-end on the live DB**: insert → submit → sign chain run as a
  real COMMAND member inside a rolled-back transaction →
  `status=captain_signed, locked=t, hashlen=64, audit_rows=2`, nothing
  persisted.

**Still on localStorage (intentionally, for now):** the command-only "Vessel
Sea Time" view (vessel service log + crew assignments) and the saved-vessel
convenience cache. These migrate with the **Phase 2 attestation cockpit**.

## 5b. Update — Session 3: Testimonial Pack Generator (Phase 1 export)

Built `src/seatime/testimonial/` — generates an MCA MIN 642 Annex A,
captain-signed testimonial pack from logged sea time.

- **One shared `TestimonialDataset` core → `VerifierProfile` adapter → PDF +
  checklist.** Adding a verifier is a **new config object only** (`verifiers.js`)
  — proven by a unit test that runs validate + checklist + render on a brand-new
  profile with zero generator changes.
- **3 verifiers** config-driven: PYA (D-SRB route, certified passport +
  signatory email, €50 note), Nautilus (print → master sign & stamp → scan →
  upload), Other (generic Annex A).
- **Validation blocks generation** with actionable reasons:
  watchkeeping <4h, standby over cap, seagoing on a <15m vessel, vessel missing
  GT/length, no signatory, missing required doc, and the **self-certification
  hard fail** (signatory == seafarer, by name *and* user id) — MCA won't accept
  self-certified service, so producing one is impossible (unit-tested).
- **Tamper-evidence:** dependency-free SHA-256 (verified against `node:crypto`)
  over the canonical content → `verificationRef` + QR payload; any field change
  flips `verifyTestimonial()` to `tampered`.
- **Four service types totalled SEPARATELY**, never merged.
- **UI:** `ExportTestimonialModal` — verifier dropdown re-renders the
  checklist/validation from the **same dataset** (no re-entry, no refetch);
  generate → downloadable PDF.
- **10 unit tests, all green** (`node --test`). Out of scope (correctly): any
  automated submission to PYA/Nautilus, and any algorithmic "verification".

Open `// TODO(MIN642)` markers left in code: exact Annex A field layout, the
standby cap figure, and embedding a real QR *image* (no QR lib in deps yet — the
payload + hash are rendered as text/URL for now).

## 6. Decisions I need from you (before Phase 1+)

1. ~~**Persistence model.**~~ ✅ Resolved — moved to Supabase (see §5a).
2. **Standby substitution.** The cap rule is settled — standby counts only up to
   your actual sea service (MSN 1858 §5.2 / MIN 498), no flat day figure. Open
   question is only whether those eligible standby days *substitute into* the
   seagoing bar, or stay a displayed-only bucket. I've done the latter for now.
3. **Seagoing vs in-port.** I map `IN_PORT` / `ANCHOR` → **standby**. Some
   pathways treat in-port-underway-prep differently — confirm that's right.
4. **Commercial-status gate.** The old code gated on commercial/private yacht.
   I dropped it from the gates (GT + length only) to avoid false negatives.
   Re-add as a configurable gate?
5. **Source of truth for the official template.** You flagged the MIN 642 fields
   came from PYA/IYT templates, not the raw PDF. Before I build the Phase 1
   export, I'd want the official field layout to diff against.

---

## 7. Proposed sequence for the next sessions

- **Phase 1 — MIN 642 export & verification.** Print-ready PDF (jsPDF +
  autotable are already deps) + CSV; per-vessel blocks with the four totals;
  captain sign-off flow; tamper-evident hash over the signed record + a
  no-login QR verify page.
- **Phase 2 — Captain attestation cockpit.** One screen, bulk approve/reject
  with per-entry notes, full audit trail, lock-on-sign.
- **Phase 3 — AIS + rota auto-classification.** One-tap-confirm pending entries
  derived from voyage legs + rota; offline confirm/sync.
- **Phase 4 — Predictive coaching.** Project eligibility dates, flag shortfalls;
  private, not a leaderboard.
- **Cross-cutting (each phase):** WCAG 2.2 AA pass on the calendar (ARIA grid +
  keyboard nav), offline-first sync, i18n (FIL/ES/FR), `dd/mm/yyyy` + 24h,
  deck/sunlight high-contrast mode, lock entries once captain-signed, and
  guard the "Delete All Entries" action.

---

*Implementation note: the rules engine is intentionally side-effect-light and
unit-testable in isolation (it only needs `localStorage`). When we move to
Supabase, `evaluateEntryQualification` / `classifyServiceType` can move
server-side almost unchanged.*
