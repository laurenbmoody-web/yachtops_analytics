# Cargo — competitive analysis & feature gap map (defects / ops)

_Snapshot: July 2026. Compares Cargo's defect/snag + asset features against the
two reference products the team benchmarks against: **PinPoint Works** and
**IDEA (idea-yacht)**. Use this to decide what to build next._

## The competitors do different jobs

- **PinPoint Works** — a *snagging / worklist* tool built on a flat GA
  (general-arrangement) drawing. Drop pins on the GA; each pin carries title,
  status, priority, **tags + custom fields**, photos/videos/documents, comments;
  plus per-user access levels, sort/filter reporting, and **PDF export**. Its
  "labelling" is *tags and custom fields* (spreadsheet-style columns). **No**
  maintenance system, **no** QR/asset tags.
  Sources: pinpointworks.com/features, pinpointworks.com

- **IDEA (idea-yacht)** — a full **PMS / ISM** platform. Equipment/asset
  register (manuals, spare-part catalogues, drawings, certificates linked to each
  machine), **planned/preventive maintenance** schedules (preloaded machinery
  list), inventory/stock/purchasing (quotes/invoices/receipts), a **Snag List**,
  and crew/compliance. Recognises **barcodes (EAN, QR) and NFC tags** so crew
  scan a physical tag on equipment to record checks, find storage, or hit "round"
  entry points.
  Sources: idea-yacht.com/idea-yacht, idea-yacht.com/news/sba-features/planned-maintenance

## Where Cargo stands (audited from the codebase)

### Strong / mature (matches or beats the field)
- **Defect lifecycle** — statuses (pending_acceptance → New/Assigned/InProgress/
  WaitingParts/Fixed/Closed/declined/Reopened), priorities (Low→Critical),
  departments, **person or whole-team assignment** with team-claim, an
  acceptance/decline gate, close-with-notes/reopen, due dates, immutable audit
  trail (`defect_events`) + comments. (`defects/utils/defectsStorage.js`)
- **Repair record** — contractor details (+ directory link), repair stages
  (contacted→completed), **quote/invoice tracking with cost variance**, warranty
  tracking, and a **per-vessel configurable quote sign-off threshold + approver
  tier** (server-enforced RPC; blocks scheduling while pending).
- **Defect → other flows** — defect → **parts order** (mints a provisioning
  board pre-filled with parts), defect → **recurring maintenance job**
  (`team_jobs`, monthly→annual recurrence, two-way link), and **warranty-claim
  surfacing** (prior under-warranty repairs at the same location).
- **3D map pins** — pins on a **real Gaussian-splat scan** (not a flat GA):
  severity pulse on Critical/High, completed defects drop off the map, and a
  **"location when fixed" snapshot** captured at close. Deep-link View-on-map.
- **Reporting** — snag list **PDF + Excel** export; dashboard KPIs (open /
  overdue / critical, dept-scoped).
- **Notifications** — in-app bell + **High/Critical email** alerts (edge fn),
  watchers ("also notify"), chief/command escalation for pending/quote-approval.

### Key gaps vs competitors (the real story)
1. **No QR / barcode / NFC asset tags, no printable labels, no scan-to-view.**
   This is an **IDEA** feature; Cargo does **not** have it. What exists today:
   a **barcode *text field*** on inventory items (no decode / no generation / no
   print) and **one live scanner** (supplier-side pick list). There is no
   "scan a tag on a pump → see its defects / manuals / history."
   (The `qrcode` npm dep is used only for seatime packs, MFA, and supplier
   delivery-sign URLs — nothing asset/equipment/defect related.)
2. **No distinct equipment/asset register and no true per-equipment PMS.**
   No `equipment`/`assets` entity, no running hours, no service intervals, no
   per-asset scheduled maintenance, no linked manuals/spares/certs. Cargo's only
   "maintenance" construct is a recurring `team_jobs` row **promoted from a
   defect** — not a classic PMS. This is the biggest single gap vs IDEA.

## Recommendation (next arc)

The two gaps are **linked** and are what separate a snag tool from a full
yacht-ops platform:

1. **Equipment / Asset register + basic PMS** — the missing pillar. A real
   asset entity (details, running hours, service intervals, per-asset scheduled
   preventive jobs, linked manuals/spares/certs). Makes a defect link to a real
   **asset**, not just a location.
2. **QR / NFC asset tags** — only powerful **once #1 exists**: print a tag for a
   pump → scan on a phone → its maintenance schedule, open defects, manuals,
   history. (Could ship pointed at locations/inventory first, but the payoff is
   with equipment.)

On **defects/snagging specifically, Cargo is already ahead of PinPoint and
roughly matches IDEA** — so more defect polish is lower-leverage than closing the
equipment/PMS gap. Remaining defect polish that's still open: **map pin
clustering** (nice-to-have) and a **defect insights/analytics** view.

## Sequencing note (the 3D map)

The map's **defect** functionality is complete and strong; only **clustering**
(optional) remains. The map is a *foundation to build on*, not something to
"finish" in isolation — equipment will eventually be pinned on it and QR scans
will resolve to it. So maturing the map further in isolation is low-leverage
right now; the equipment register is the higher-value next arc, with map/QR
integration folded in as it lands.
