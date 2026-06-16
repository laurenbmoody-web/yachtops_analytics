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
| Standby cap | ❌ | ⚠️ threshold stored (`standbyCapDays`), **substitution logic deferred** |
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
| `standbyCapDays` | 90 | template standby cap |

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

## 6. Decisions I need from you (before Phase 1+)

1. **Persistence model.** This is still all `localStorage`. The captain
   attestation + tamper-evident hash (Phase 1/2) really wants Supabase tables
   (entries, signatures, audit). Do you want me to design the schema and
   migrate, or keep it client-only for the demo a bit longer?
2. **Standby substitution.** Should capped standby days *substitute into* the
   seagoing requirement (up to `standbyCapDays`), or just be displayed as a
   tracked bucket? I've done the latter for now.
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
