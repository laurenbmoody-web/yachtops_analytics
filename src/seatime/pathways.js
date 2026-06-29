// Sea Time Tracker — MCA qualifying-service thresholds, departments, roles and
// certificates. Figures extracted from the live notices:
//   DECK   — MSN 1858 (M) Amendment 2  (Deck Officers on Large Yachts 24m+)  IN FORCE
//   ENGINE — MSN 1859 (M+F)            (Yacht Engineer certification)        WITHDRAWN
//
// ⚠️ ENGINE LADDER SUPERSEDED: MSN 1859 was withdrawn on 10 Jan 2023 and replaced
// by MSN 1904 (Engineer Officer Small Vessel CoC). MSN 1904 does NOT use the
// "Y1–Y4 / MEOL_Y" grade names — yacht engineers now obtain STCW Small Vessel
// CoCs (EOOW III/1, Chief Eng III/3 / III/2, non-STCW MEOL SV) endorsed "Limited
// to Yachts" via §5.9.2, with different (lower) service figures. The Y-grade
// entries below are retained as legacy IDs but are marked verified:'SUPERSEDED'
// so the UI never presents their withdrawn figures as fact. // TODO(MSN1904):
// rebuild the engine ladder against MSN 1904 §5.9.2 once the SV-CoC mapping is agreed.
//
// Confidence: HIGH = stated verbatim in the IN-FORCE notice (section cited);
// MEDIUM = inferred; SUPERSEDED = figures come from a withdrawn notice, confirm
// against the replacement; PENDING = not in these notices, confirm before
// production. Treat every numeric threshold as config.

/** @typedef {'seagoing'|'watchkeeping'|'standby'|'yard'} ServiceType */
/** @typedef {'deck'|'engineering'|'interior'|'galley'|'other'} Department */
/** @typedef {'DECK'|'ENGINE'|'ETO'} Family */

// ── Day-counting + service-definition rules (MSN 1858 §5 / MSN 1859 §5) ──────
export const SERVICE_RULES = {
  fullDayMinHours: 4,          // "4 hours working duty in 24h = 1 full day" (1858 §5.1/5.2, 1859 §5.1) HIGH
  monthDays: 30,               // "month = calendar month or 30 days" (1858 §5.3, 1859 §5.3) HIGH
  seagoingMinLengthM: 15,      // OOW/Master <3000 gate (1858 §3.3/3.5/3.6) HIGH
  // Standby: ≤14 consecutive days, never exceeding the previous voyage, and
  // total standby may NOT exceed total actual seagoing service. (1858 §5.2 /
  // MIN 498) HIGH — there is NO flat day cap; the limit is your sea-service total.
  standbyMaxConsecutiveDays: 14,
  standbyNeverExceedsSeagoing: true,
  // Yard service cap; never counts as actual seagoing. Baseline 90 days (OOW
  // <3000GT); Chief Mate / Master = 30 days via the per-certificate override
  // below. (MSN 1858 §3.3–§3.6 / MSN 1859 §5.2) HIGH — confirmed vs MSN 1858
  // Amd 2 + MIN 498.
  yardCapDays: 90,
  // Dual deck+engine capacity counts at 50%. (1858 §5.1 / 1859) HIGH — not yet modelled.
  dualCapacityRate: 0.5,
  // ≥6 months of qualifying seagoing within the 5 years before application. (1858 §5.1) HIGH — not yet enforced.
  recencyMonthsWithin5y: 6,
  // Verification authority in BOTH notices is the MCA. PYA Service Record Book is
  // an accepted record *format* (1859 §5.4); Nautilus is not named in either
  // notice. The testimonial pack's PYA/Nautilus options are submission ROUTES
  // (per MIN 543/642 industry practice), not claims from these notices.
  verificationAuthority: 'MCA'
};

// ── Departments ─────────────────────────────────────────────────────────────
export const DEPARTMENTS = {
  deck:        { id: 'deck',        label: 'Deck' },
  engineering: { id: 'engineering', label: 'Engineering' },
  interior:    { id: 'interior',    label: 'Interior' },
  galley:      { id: 'galley',      label: 'Galley' },
  other:       { id: 'other',       label: 'Other' }
};

// ── Roles. accruesToward = certificate families this role's sea time counts
// toward. Interior/galley log days (CV / visa / tax) but accrue nothing. ──────
export const ROLES = {
  // DECK
  deckhand:       { label: 'Deckhand',                 department: 'deck', accruesToward: ['DECK'], watchkeepingDomain: 'bridge' },
  bosun:          { label: 'Bosun',                    department: 'deck', accruesToward: ['DECK'], watchkeepingDomain: 'bridge' },
  oow:            { label: 'Officer of the Watch',     department: 'deck', accruesToward: ['DECK'], watchkeepingDomain: 'bridge' },
  second_officer: { label: 'Second Officer',           department: 'deck', accruesToward: ['DECK'], watchkeepingDomain: 'bridge' },
  chief_officer:  { label: 'Chief Officer / First Officer', department: 'deck', accruesToward: ['DECK'], watchkeepingDomain: 'bridge' },
  master:         { label: 'Master / Captain',         department: 'deck', accruesToward: ['DECK'], watchkeepingDomain: 'bridge' },
  // ENGINEERING
  sv_engineer:    { label: 'Engineer (sole/SV)',       department: 'engineering', accruesToward: ['ENGINE'], watchkeepingDomain: 'engine' },
  second_engineer:{ label: 'Second Engineer',          department: 'engineering', accruesToward: ['ENGINE'], watchkeepingDomain: 'engine' },
  chief_engineer: { label: 'Chief Engineer',           department: 'engineering', accruesToward: ['ENGINE'], watchkeepingDomain: 'engine' },
  eto:            { label: 'ETO (Electro-Technical Officer)', department: 'engineering', accruesToward: ['ETO'], watchkeepingDomain: 'engine' },
  // DUAL deck+engine (small-vessel combined capacity). Accrues to BOTH ladders,
  // but each day counts at 50% toward each CoC (MSN 1858 §5.1 dual-capacity rate).
  // `dbName` links to the roles-table job title so an assigned role can drive it.
  mate_engineer:  { label: 'Mate/Engineer',  department: 'deck', accruesToward: ['DECK', 'ENGINE'], watchkeepingDomain: 'bridge', dualCapacity: true, dbName: 'Mate/Engineer' },
  deck_engineer:  { label: 'Deck/Engineer',  department: 'deck', accruesToward: ['DECK', 'ENGINE'], watchkeepingDomain: 'bridge', dualCapacity: true, dbName: 'Deck/Engineer' },
  // INTERIOR / GALLEY — log days, no CoC credit
  stewardess:     { label: 'Stewardess',               department: 'interior', accruesToward: [], watchkeepingDomain: null },
  chief_stew:     { label: 'Chief Stewardess',         department: 'interior', accruesToward: [], watchkeepingDomain: null },
  purser:         { label: 'Purser',                   department: 'interior', accruesToward: [], watchkeepingDomain: null },
  cook:           { label: 'Cook',                     department: 'galley', accruesToward: [], watchkeepingDomain: null },
  chef:           { label: 'Yacht Chef / Head Chef',   department: 'galley', accruesToward: [], watchkeepingDomain: null },
  other:          { label: 'Other',                    department: 'other', accruesToward: [], watchkeepingDomain: null }
};

// Officer-grade capacity test. The higher CoCs require the qualifying service to
// be performed "as a deck/engineer officer" whilst holding the lower CoC (MSN
// 1858 Master/Chief Mate; MSN 1904 Chief Engineer levels), so rating service
// (deckhand, motorman, cadet, bosun, steward…) does NOT count toward them. The
// capacity field is free text, so we exclude only CLEARLY non-officer ranks and
// count everything else — including blanks — as officer, to never silently drop
// ambiguous service. (Watchkeeping is officer-grade by definition: in full
// charge of a navigational/engine watch — MSN 1858/1904 §5.)
const RATING_CAPACITY = /\b(deck\s*hands?|deck\s*rating|ratings?|cadets?|trainees?|apprentices?|bo'?sun|boatswain|able\s*seaman|ordinary\s*seaman|motor\s*man|motormen|oiler|greaser|wiper|engine\s*rating|steward(?:ess)?|cook|chef|galley)\b/i;
export const isOfficerCapacity = (capacity) => {
  const s = String(capacity || '').trim();
  if (!s) return true;                 // unknown — don't silently drop; the crew can set the capacity
  return !RATING_CAPACITY.test(s);
};

// ── Certificates. `requires` fields drive the progress bars (only the fields
// present are shown). Months are converted to days at SERVICE_RULES.monthDays.
// `routes` documents alternative service routes where the notice gives several.
// `heldWhilstCert` = the prerequisite CoC (a CERTIFICATES id) whose qualifying
// service must be performed WHILE HOLDING it; `asOfficer` = that service must be
// in an officer capacity. Both gate the requirement bars in the engine so a
// higher cert only counts officer service dated after the prerequisite was held
// (MSN 1858 §3.4-3.6 / §4; MSN 1904 §5.9.2). Entry certs set neither. ─────────
export const CERTIFICATES = {
  // ===================== DECK — MSN 1858 Amendment 2 (HIGH) =====================
  // Small-vessel command entry tier (Code <200GT / OOW Yachts <500GT). Service is
  // 6 months seagoing whilst holding the relevant RYA/IYT qualification (§3.1/§3.2);
  // a separate, shorter line from the OOW <3000GT ladder below.
  MASTER_CODE_200_COASTAL: {
    family: 'DECK', label: 'Master (Code <200GT) / OOW Yachts <500GT — 150nm', short: 'Master <200GT · 150nm',
    msn: 'MSN 1858 Amd 2 §3.1', verified: 'HIGH',
    requires: { seagoingMonths: 6, minVesselMetres: 15 },
    heldWhilst: 'RYA Yachtmaster Offshore (or IYT Master of Yachts Limited)',
    note: 'STCW II/3, limited to 150nm from a safe haven. 6 months seagoing whilst holding an RYA Yachtmaster Offshore or IYT Master of Yachts Limited. Min age 18; ENG1; GMDSS ROC; form MSF 4343.'
  },
  MASTER_CODE_200_UNLIMITED: {
    family: 'DECK', label: 'Master (Code <200GT) / OOW Yachts <500GT — Unlimited', short: 'Master <200GT · Unltd',
    msn: 'MSN 1858 Amd 2 §3.2', verified: 'HIGH',
    requires: { seagoingMonths: 6, minVesselMetres: 15 },
    heldWhilst: 'RYA Yachtmaster Ocean (or IYT Master of Yachts Unlimited)',
    note: 'STCW II/2, unlimited area. 6 months seagoing whilst holding an RYA Yachtmaster Ocean or IYT Master of Yachts Unlimited. Min age 18; ENG1; GMDSS GOC; form MSF 4343.'
  },
  OOW_YACHT_3000: {
    family: 'DECK', label: 'OOW (Yachts <3000GT)', short: 'OOW <3000GT',
    msn: 'MSN 1858 Amd 2 §3.3', verified: 'HIGH',
    yardCapDays: 90,                // OOW: up to 90 yard days may count (1858 §3.3)
    requires: {
      onboardMonths: 36,            // 36 months onboard yacht service since age 16
      seagoingDays: 250,            // ≥250 days seagoing-only on vessels ≥15m …
      combinedTopUpDays: 115,       // … + 115 days combined seagoing/standby/yard = 365 total
      minVesselMetres: 15
    },
    note: 'Entry watchkeeping CoC. 365 seagoing days = 250 days seagoing-only + 115 days that may combine seagoing/standby/yard. The 250 must be actual seagoing — standby/yard alone cannot make it up.'
  },
  CHIEF_MATE_YACHT_3000: {
    family: 'DECK', label: 'Chief Mate (Yachts <3000GT)', short: 'Chief Mate <3000GT',
    msn: 'MSN 1858 Amd 2 §3.4', verified: 'HIGH',
    yardCapDays: 30,                // Chief Mate / Master: max 30 yard days (1858 §3.4)
    requires: {},                   // no additional sea time — concurrent with OOW <3000 II/1
    heldWhilst: 'OOW (Yachts <3000GT) II/1',
    note: 'No additional qualifying service beyond OOW <3000GT; may be applied for at the same time.'
  },
  MASTER_YACHT_500: {
    family: 'DECK', label: 'Master (Yachts <500GT)', short: 'Master <500GT',
    msn: 'MSN 1858 Amd 2 §3.5', verified: 'HIGH',
    yardCapDays: 30,                // Master: max 30 yard days (1858 §3.5)
    requires: { onboardMonths: 12, watchkeepingDays: 120, minVesselMetres: 15 },
    heldWhilst: 'OOW (Yachts <3000GT) II/1', heldWhilstCert: 'OOW_YACHT_3000', asOfficer: true
  },
  MASTER_YACHT_3000: {
    family: 'DECK', label: 'Master (Yachts <3000GT)', short: 'Master <3000GT',
    msn: 'MSN 1858 Amd 2 §3.6', verified: 'HIGH',
    yardCapDays: 30,                // Master: max 30 yard days (1858 §3.6)
    requires: {
      onboardMonths: 24, watchkeepingDays: 240, minVesselMetres: 15,
      // §3.6 sub-gate, computed from each vessel's recorded GT + length.
      higherTonnage: { metresMonths: 12, metresMin: 24, gtMonths: 6, gtMin: 500 }
    },
    heldWhilst: 'OOW (Yachts <3000GT) II/1', heldWhilstCert: 'OOW_YACHT_3000', asOfficer: true,
    note: 'All service ≥15m AND include 12 months on ≥24m OR 6 months on ≥500GT. The larger-vessel bar is computed from each vessel’s GT/length on record; the prior-service baseline and any entry without vessel size can’t be size-attributed.'
  },
  CHIEF_MATE_UNLIMITED: {
    family: 'DECK', label: 'Chief Mate (Yachts Unlimited)', short: 'Chief Mate Unltd',
    msn: 'MSN 1858 Amd 2 §4.3', verified: 'HIGH',
    yardCapDays: 30,                // Chief Mate: max 30 yard days (1858 §4.3)
    requires: { onboardMonths: 12, seagoingMonths: 6, minGT: 500 },
    heldWhilst: 'OOW Unlimited (or Master Yachts <3000GT II/1)', heldWhilstCert: 'MASTER_YACHT_3000', asOfficer: true,
    note: 'OOW-Unlimited route: 12 months onboard as OOW incl. 6 months seagoing, all on a yacht ≥500GT.'
  },
  MASTER_UNLIMITED: {
    family: 'DECK', label: 'Master (Yachts Unlimited)', short: 'Master Unltd',
    msn: 'MSN 1858 Amd 2 §4.4', verified: 'HIGH',
    yardCapDays: 30,                // Master: max 30 yard days (1858 §4.4)
    // 3 alternative routes — default bar uses the Chief-Mate-Unlimited route (A).
    requires: { onboardMonths: 12, seagoingMonths: 6, minGT: 500 },
    heldWhilst: 'Chief Mate (Yachts Unlimited)', heldWhilstCert: 'CHIEF_MATE_UNLIMITED', asOfficer: true,
    routes: [
      { whilstHolding: 'Chief Mate Yachts Unlimited', onboardMonths: 12, seagoingMonths: 6, minGT: 500 },
      { whilstHolding: 'Master Yachts <3000GT II/2', onboardMonths: 6, seagoingMonths: 3, minGT: 500 },
      { whilstHolding: 'OOW Unlimited', onboardMonths: 36, seagoingMonths: 15, minVesselMetres: 15, seagoingMinGT: 500 }
    ]
  },

  // ====== ENGINE — MSN 1904 §5.9.2 (Small Vessel CoC, "Limited to Yachts") ======
  // The old MSN 1859 "Y-grade" yacht-engineer ladder was withdrawn (10 Jan 2023)
  // and consolidated into MSN 1904 (with MIN 524 + MIN 594). Yacht engineers now
  // hold STCW Small Vessel CoCs endorsed "Limited to Yachts". Figures: MSN 1904
  // §5.9.2, cross-checked against MIN 642 Annex A (MIN 642 itself expired 1 Dec
  // 2025 — used as corroborating summary only; the MSN is the binding source).
  //   legacyAlias = the nearest old Y-grade, for crew who still think in Y-grades.
  //   The precise legacy→SV conversion is LEGACY_GRADE_CONVERSION (MIN 642 §7.3,
  //   to which MSN 1904 §12.1 delegates — provisional, see that map's note).
  // Yacht seagoing = days actually UNDERWAY with main propulsion in full use; yard
  // time never counts as seagoing; up to 2 months at-anchor/fast-to-shore on own
  // power may count as watchkeeping (MSN 1904 §5.9).
  MEOL_Y: {
    family: 'ENGINE', label: 'MEOL — Small Vessel (Yacht)', short: 'MEOL (SV·Y)',
    legacyAlias: 'MEOL (Yachts)',
    msn: 'MSN 1904 §3.2', verified: 'HIGH',
    requires: { onboardMonths: 24, seagoingMonths: 6, minPowerKW: 200 },
    note: 'Non-STCW entry licence (operate 200–750kW). 24 months onboard as a Small Vessel engineer incl. ≥6 months seagoing on yachts ≥200kW — OR 36 months as dual-purpose deckhand/engineer incl. ≥6 months seagoing. Requires AEC 1 & 2; min age 19; ENG1.'
  },
  EOOW_SV_Y: {
    family: 'ENGINE', label: 'EOOW Engineer — Small Vessel (Yacht)', short: 'EOOW SV (Y)',
    legacyAlias: '≈ Y4',
    msn: 'MSN 1904 §5.9.2', verified: 'HIGH',
    requires: { onboardMonths: 12, seagoingMonths: 4, minPowerKW: 350 },
    // Entry officer CoC (STCW III/1) — MSN 1904 §4.4 Experienced Seafarer Route
    // does NOT require a lower engineer CoC as a prerequisite (verified against
    // MSN 1904 + MCA-approved training schools). A TRB / approved cadetship is a
    // training route, not a held CoC, so there is no `heldWhilstCert` gate.
    entryNote: 'Built via a Training Record Book / approved cadetship — no lower engineer CoC is a prerequisite.',
    note: 'Experienced route: 12 months onboard on yachts ≥350kW, including ≥4 months actual seagoing (days underway). Up to 2 further months at-anchor / fast-to-shore on own power count as watchkeeping (6 months of watch out of 24). STCW III/1. CoC caps: <9000kW, <3000GT.'
  },
  CHIEF_SV_500_Y: {
    family: 'ENGINE', label: 'Chief Engineer — Small Vessel <500GT / <3000kW (Yacht)', short: 'Chief SV <500GT (Y)',
    legacyAlias: '≈ Y3',
    msn: 'MSN 1904 §5.9.2', verified: 'HIGH',
    requires: { onboardMonths: 6, seagoingMonths: 4, minPowerKW: 350 },
    heldWhilst: 'EOOW Engineer SV (Yacht)', heldWhilstCert: 'EOOW_SV_Y', asOfficer: true,
    note: '6 months onboard as EOOW SV on yachts ≥350kW, incl. ≥4 months seagoing (underway), whilst holding the EOOW SV yacht CoC. STCW III/3. CoC caps: <500GT & <3000kW.'
  },
  CHIEF_SV_3000_Y: {
    family: 'ENGINE', label: 'Chief Engineer — Small Vessel <3000GT / <9000kW (Yacht)', short: 'Chief SV <3000GT (Y)',
    legacyAlias: '≈ Y2 / Y1',
    msn: 'MSN 1904 §5.9.2', verified: 'HIGH',
    requires: { onboardMonths: 12, seagoingMonths: 8, minPowerKW: 350 },
    heldWhilst: 'EOOW Engineer SV (Yacht)', heldWhilstCert: 'EOOW_SV_Y', asOfficer: true,
    note: '12 months onboard ≥350kW incl. ≥8 months seagoing — of which ≥4 months on yachts ≥750kW — whilst holding EOOW SV; OR 6 months onboard incl. ≥4 months seagoing whilst holding Chief SV <500GT. STCW III/2. CoC caps: <3000GT & <9000kW.',
    routes: [
      { whilstHolding: 'EOOW Engineer SV (Yacht)', onboardMonths: 12, seagoingMonths: 8, minPowerKW: 350, seagoingMinPowerKW: 750 },
      { whilstHolding: 'Chief Engineer SV <500GT (Yacht)', onboardMonths: 6, seagoingMonths: 4, minPowerKW: 350 }
    ]
  },

  // ===================== ETO — MSN 1860 (M) Amendment 1 (HIGH) =================
  ETO_COC: {
    family: 'ETO', label: 'Electro-Technical Officer (STCW III/6)', short: 'ETO',
    msn: 'MSN 1860 Amd 1 §3.2', verified: 'HIGH',
    requires: { seagoingMonths: 6, minPowerKW: 750 },
    note: 'Cadet / FD-HND route (§3.2): 12 months combined seagoing + workshop, including ≥6 months seagoing on ships ≥750kW + ≥3 months approved workshop skills. Cargo tracks the 6-month seagoing portion; workshop training is logged separately. Non-cadet route (§4.2) is set case-by-case by the MCA between 6 and 33 months — no single figure. Recency: 6 months seagoing in the 5 years before CoC issue. Min age 18; ENG1; High Voltage (Management); oral STCW III/6. Form MSF 4259. Revalidation per MSN 1861.',
    routes: [
      { label: 'Cadet / FD-HND (§3.2)', seagoingMonths: 6, workshopMonths: 3, combinedMonths: 12, minPowerKW: 750 },
      { label: 'Non-cadet — set case-by-case by the MCA (§4.2)', seagoingMonthsMin: 6, seagoingMonthsMax: 33, minPowerKW: 750, mcaAssessed: true },
      { label: 'Electro-technical Rating (§4.3)', combinedMonths: 36, minPowerKW: 750 }
    ]
  }
};

export const DEFAULT_CERTIFICATE = 'OOW_YACHT_3000';

// ── Goal-based routing. A crew member picks a GOAL (career ceiling); the spine
// shows only the certificates on the route to it. Held certs (from the crew's
// CoC documents) mark where they are; the live target is the first un-held rung
// on the route. TODO(MSN-routes): confirm exact prerequisite chains vs 1858/1859.
export const CERTIFICATE_ROUTES = {
  // DECK — small-vessel command entry tier (standalone, RYA/IYT based)
  MASTER_CODE_200_COASTAL:   ['MASTER_CODE_200_COASTAL'],
  MASTER_CODE_200_UNLIMITED: ['MASTER_CODE_200_UNLIMITED'],
  // DECK — OOW <3000GT ladder
  OOW_YACHT_3000:        ['OOW_YACHT_3000'],
  CHIEF_MATE_YACHT_3000: ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000'],
  MASTER_YACHT_500:      ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_500'],
  MASTER_YACHT_3000:     ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_500', 'MASTER_YACHT_3000'],
  CHIEF_MATE_UNLIMITED:  ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED'],
  MASTER_UNLIMITED:      ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED', 'MASTER_UNLIMITED'],
  // ENGINE — MSN 1904 Small Vessel (Yacht) ladder
  MEOL_Y:         ['MEOL_Y'],
  EOOW_SV_Y:      ['MEOL_Y', 'EOOW_SV_Y'],
  CHIEF_SV_500_Y: ['MEOL_Y', 'EOOW_SV_Y', 'CHIEF_SV_500_Y'],
  CHIEF_SV_3000_Y:['MEOL_Y', 'EOOW_SV_Y', 'CHIEF_SV_500_Y', 'CHIEF_SV_3000_Y'],
  // ETO
  ETO_COC: ['ETO_COC']
};

/** Sensible career-ceiling goals offered per family (entry certs excluded). */
export const GOAL_OPTIONS = {
  DECK: ['MASTER_CODE_200_COASTAL', 'MASTER_CODE_200_UNLIMITED', 'MASTER_YACHT_500', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED', 'MASTER_UNLIMITED'],
  ENGINE: ['EOOW_SV_Y', 'CHIEF_SV_500_Y', 'CHIEF_SV_3000_Y'],
  ETO: ['ETO_COC']
};

export const DEFAULT_GOAL = { DECK: 'MASTER_YACHT_3000', ENGINE: 'CHIEF_SV_3000_Y', ETO: 'ETO_COC' };

/** Certificate families a department can work toward (drives the pathway).
 *  Engineering carries both the Small Vessel engine ladder and the ETO route. */
export const DEPT_FAMILIES = {
  deck: ['DECK'],
  engineering: ['ENGINE', 'ETO'],
  interior: [],
  galley: [],
  other: []
};

export const routeFor = (goalId) => CERTIFICATE_ROUTES[goalId] || (goalId ? [goalId] : []);

/** Maps a personal_documents CoC `grade` (documentTypes.js) to a ladder cert id. */
export const GRADE_TO_CERT = {
  'Master Code <200GT (150nm)': 'MASTER_CODE_200_COASTAL',
  'Master Code <200GT (Unlimited)': 'MASTER_CODE_200_UNLIMITED',
  'OOW <3000GT': 'OOW_YACHT_3000',
  'Chief Mate <3000GT': 'CHIEF_MATE_YACHT_3000',
  'Chief Mate unlimited': 'CHIEF_MATE_UNLIMITED',
  'Master <500GT': 'MASTER_YACHT_500',
  'Master <3000GT': 'MASTER_YACHT_3000',
  'Master unlimited': 'MASTER_UNLIMITED',
  // In-force MSN 1904 Small Vessel (Yacht) grades — canonical (listed first so
  // CERT_TO_GRADE presets the current name when adding a held cert).
  'Engineering — MEOL (Yachts)': 'MEOL_Y',
  'Engineering — EOOW SV (Yachts)': 'EOOW_SV_Y',
  'Engineering — Chief SV <500GT (Yachts)': 'CHIEF_SV_500_Y',
  'Engineering — Chief SV <3000GT (Yachts)': 'CHIEF_SV_3000_Y',
  // Legacy MSN 1859 Y-grade CoCs a crew member may still hold → mapped to the
  // SV rung they convert across to (MIN 642 §7, per MSN 1904 §12.1). Held-position
  // approximation; the exact conversion top-up is in LEGACY_GRADE_CONVERSION.
  'Engineering — SV / Y4': 'EOOW_SV_Y',
  'Engineering — Y3': 'CHIEF_SV_500_Y',
  'Engineering — Y2': 'CHIEF_SV_3000_Y',
  'Engineering — Y1': 'CHIEF_SV_3000_Y',
  'Y4 / OOW (Yachts)': 'EOOW_SV_Y',
  'Y3 / Master <500GT': 'CHIEF_SV_500_Y',
  'Y2 / Master <3000GT': 'CHIEF_SV_3000_Y',
  'Y1 / Master <3000GT (>500GT)': 'CHIEF_SV_3000_Y'
};

/** Reverse of GRADE_TO_CERT — the CoC `grade` to preset when adding a held cert. */
export const CERT_TO_GRADE = (() => {
  const out = {};
  for (const [grade, cert] of Object.entries(GRADE_TO_CERT)) { if (cert && !out[cert]) out[cert] = grade; }
  return out;
})();

/** Certificates a role's sea time can count toward (by family). */
export const eligibleCertificates = (roleKey) => {
  const role = ROLES[roleKey];
  const fams = role?.accruesToward || [];
  return Object.entries(CERTIFICATES)
    .filter(([, c]) => fams.includes(c.family))
    .map(([id, c]) => ({ id, ...c }));
};

/** Roles for a department (for the role dropdown). */
export const rolesForDepartment = (deptId) =>
  Object.entries(ROLES).filter(([, r]) => r.department === deptId).map(([id, r]) => ({ id, ...r }));

/** Yard-service day cap for a certificate (MSN 1858): OOW <3000GT counts up to
 *  90 yard days; Chief Mate / Master up to 30. Falls back to the 90-day baseline
 *  (e.g. engine certs under MSN 1859 §5.2) when a cert sets no override. */
export const yardCapForCertificate = (certId) =>
  CERTIFICATES[certId]?.yardCapDays ?? SERVICE_RULES.yardCapDays;

// ── Ancillary courses / tickets required for each CoC (the "courses" half of
// eligibility, alongside the sea-time bars). Each item lists the documentTypes.js
// doc-type ids that satisfy it (anyOf — met if the crew holds any of them), so the
// tracker auto-detects what they hold from the Documents tab. Exam-only modules
// (e.g. Celestial Nav, GSK) aren't documents, so they're not listed here. ───────
const A = (key, label, anyOf, note) => ({ key, label, anyOf, ...(note ? { note } : {}) });
const STCW_CORE = [
  A('stcw', 'STCW Basic Safety Training', ['stcw_basic']),
  A('pscrb', 'Survival Craft & Rescue Boats (PSCRB)', ['stcw_pscrb']),
];
const MASTER_TICKETS = [
  ...STCW_CORE,
  A('adv_ff', 'Advanced Firefighting', ['stcw_advanced_ff']),
  A('med', 'Medical First Aid', ['stcw_medical_care']),
  A('ecdis', 'ECDIS', ['ecdis']),
  A('gmdss', 'GMDSS GOC', ['gmdss']),
  A('helm_m', 'HELM (Management)', ['helm_management']),
];
export const ANCILLARY = {
  MASTER_CODE_200_COASTAL: [
    A('ym', 'RYA Yachtmaster Offshore (or IYT Master of Yachts Limited)', ['yachtmaster']),
    A('edh', 'Efficient Deck Hand (EDH)', ['edh']),
    ...STCW_CORE,
    A('gmdss', 'GMDSS ROC (or GOC)', ['gmdss']),
    A('helm_o', 'HELM (Operational)', ['helm_management']),
  ],
  MASTER_CODE_200_UNLIMITED: [
    A('ym', 'RYA Yachtmaster Ocean (or IYT Master of Yachts Unlimited)', ['yachtmaster']),
    A('edh', 'Efficient Deck Hand (EDH)', ['edh']),
    ...STCW_CORE,
    A('gmdss', 'GMDSS GOC', ['gmdss']),
    A('helm_o', 'HELM (Operational)', ['helm_management']),
  ],
  OOW_YACHT_3000: [
    A('ym', 'RYA Yachtmaster Offshore (or IYT / RYA equivalent)', ['yachtmaster', 'rya_coastal_skipper']),
    A('edh', 'Efficient Deck Hand (EDH)', ['edh'], 'Must be held ≥18 months before the CoC is issued (§3.3d).'),
    ...STCW_CORE,
    A('gmdss', 'GMDSS GOC', ['gmdss']),
    A('helm_o', 'HELM (Operational)', ['helm_management']),
    A('ecdis', 'ECDIS', ['ecdis']),
  ],
  CHIEF_MATE_YACHT_3000: MASTER_TICKETS,
  MASTER_YACHT_500: MASTER_TICKETS,
  MASTER_YACHT_3000: MASTER_TICKETS,
  CHIEF_MATE_UNLIMITED: [...MASTER_TICKETS, A('naest', 'NAEST (Management)', ['radar_arpa', 'ecdis'])],
  MASTER_UNLIMITED: [...MASTER_TICKETS, A('naest', 'NAEST (Management)', ['radar_arpa', 'ecdis'])],
  // ENGINE — MSN 1904 Small Vessel (Yacht). AEC is the entry building block, so
  // it's listed at every rung (held from below; shown so the picture is complete).
  MEOL_Y: [A('aec', 'Approved Engine Course (AEC 1 & 2)', ['aec']), ...STCW_CORE, A('adv_ff', 'Advanced Firefighting', ['stcw_advanced_ff']), A('med', 'Medical First Aid', ['stcw_medical_care'])],
  EOOW_SV_Y: [A('aec', 'Approved Engine Course (AEC 1 & 2)', ['aec']), ...STCW_CORE, A('adv_ff', 'Advanced Firefighting', ['stcw_advanced_ff']), A('med', 'Medical First Aid', ['stcw_medical_care']), A('helm_o', 'HELM (Operational)', ['helm_management'])],
  CHIEF_SV_500_Y: [A('aec', 'Approved Engine Course (AEC 1 & 2)', ['aec']), ...STCW_CORE, A('adv_ff', 'Advanced Firefighting', ['stcw_advanced_ff']), A('med', 'Medical First Aid', ['stcw_medical_care']), A('helm_m', 'HELM (Management)', ['helm_management'])],
  CHIEF_SV_3000_Y: [A('aec', 'Approved Engine Course (AEC 1 & 2)', ['aec']), ...STCW_CORE, A('adv_ff', 'Advanced Firefighting', ['stcw_advanced_ff']), A('med', 'Medical First Aid', ['stcw_medical_care']), A('helm_m', 'HELM (Management)', ['helm_management'])],
  // ETO — MSN 1860 §7.3. HV (Management), GMDSS Radio Maintenance and ENEM are
  // the electro-technical specialist tickets unique to this route.
  ETO_COC: [
    ...STCW_CORE,
    A('adv_ff', 'Advanced Firefighting', ['stcw_advanced_ff']),
    A('med', 'Medical First Aid', ['stcw_medical_care']),
    A('hv', 'High Voltage (Management)', ['hv']),
    A('helm_o', 'HELM (Operational)', ['helm_management']),
    A('gmdss_rm', 'GMDSS Radio Maintenance', ['gmdss_radio_maint']),
    A('enem', 'Electronic Nav Equipment Maintenance (ENEM)', ['enem']),
  ],
};

/** The ancillary course requirements for a certificate (empty array if none modelled). */
export const ancillaryFor = (certId) => ANCILLARY[certId] || [];

/** Dual deck+engine service counts at this rate toward each CoC (MSN 1858 §5.1). */
export const DUAL_CAPACITY_RATE = SERVICE_RULES.dualCapacityRate;

/** True if a roles-table job title (or sea-time role key) is a dual-capacity role. */
export const isDualCapacityRole = (nameOrKey) =>
  !!ROLES[nameOrKey]?.dualCapacity ||
  Object.values(ROLES).some(r => r.dualCapacity && r.dbName === nameOrKey);

/** Confidence of a certificate's encoded thresholds, for the UI to gate display.
 *  HIGH = stated verbatim in the cited notice; anything else is provisional and
 *  must be flagged "confirm against [notice]" rather than shown as authoritative,
 *  so crew on a not-yet-verified route are never given a wrong eligibility figure. */
export const certConfidence = (cert) => {
  const level = cert?.verified || 'PENDING';
  return {
    level,
    authoritative: level === 'HIGH',
    superseded: level === 'SUPERSEDED',
    notice: cert?.msn || null,
    supersededBy: cert?.supersededBy || null,
    label: level === 'HIGH' ? 'Notice-verified'
      : level === 'SUPERSEDED' ? `Superseded — confirm against ${cert?.supersededBy || 'the replacement notice'}`
      : level === 'MEDIUM' ? 'Provisional — confirm figures'
      : 'Not yet verified — confirm figures'
  };
};

// ── Legacy MSN 1859 "Y-grade" CoC → in-force MSN 1904 Small Vessel CoC.
// For crew who still HOLD an old Y-grade certificate: where it converts to, the
// MCA conversion code, and the service/course top-up.
// SOURCING: the in-force MSN 1904 carries NO conversion table — §12.1 delegates
// the detail to MIN 642 ("This is available in MIN 642"). The conversion CODES,
// target bands, source-grade gates and recency rule ARE corroborated in force by
// GOV.UK "Engineering Officers and Ratings" guidance (updated 2 Feb 2026, i.e.
// after MIN 642 expired) — `codeVerified:'HIGH'`. That page also confirms
// Conversion C is the Y3 route (resolving MIN 642 §7.3.5's "Y3/Y4" wording bug).
// The per-conversion service month-counts (topUp) are NOT restated anywhere in
// force — they exist only in MIN 642 §7.3 (expired 1 Dec 2025), so `verified` stays
// 'PROVISIONAL' (UI: "confirm with your training provider"). `from` = the source
// grade's GT/kW/STCW-class gate (note Y1 is III/2; Y2–Y4 are III/3). Conversions
// B and E need no extra sea time — courses + ENG1 only. ───────────────────────
export const LEGACY_GRADE_CONVERSION = {
  Y4: { from: 'Chief Engineer III/3 · <200GT & <1500kW', to: ['EOOW_SV_Y', 'CHIEF_SV_500_Y', 'CHIEF_SV_3000_Y'],
        code: 'A1–A3', verified: 'PROVISIONAL', codeVerified: 'HIGH',
        topUp: '6mo onboard / 4mo seagoing ≥350kW (EOOW) up to 12mo seagoing incl. 6mo ≥750kW (Chief <3000GT).' },
  Y3: { from: 'Chief Engineer III/3 · <500GT & <3000kW', to: ['CHIEF_SV_500_Y', 'CHIEF_SV_3000_Y'],
        code: 'B / C', verified: 'PROVISIONAL', codeVerified: 'HIGH',
        topUp: 'Courses + ENG1 only for Chief <500GT (code B); 12mo onboard incl. 6mo seagoing for Chief <3000GT (code C).' },
  Y2: { from: 'Chief Engineer III/3 · <3000GT & <3000kW', to: ['CHIEF_SV_3000_Y'],
        code: 'D', verified: 'PROVISIONAL', codeVerified: 'HIGH',
        topUp: '3 months seagoing on yachts ≥750kW.' },
  Y1: { from: 'Chief Engineer III/2 · <3000GT & <9000kW', to: ['CHIEF_SV_3000_Y'],
        code: 'E', verified: 'PROVISIONAL', codeVerified: 'HIGH',
        topUp: 'Courses + ENG1 only (Y1 is the highest legacy grade).' }
};

// Every Y-grade conversion ALSO requires recent service: 6 months' seagoing in
// the last 5 years (MSN 1904 §11.1 — in force; mirrored by the GOV.UK Engineering
// Officers and Ratings guidance, 2 Feb 2026). Applies on top of each conversion's
// service top-up. The yacht structure is closed — conversions are for existing
// Y-grade holders only (no new NoEs except resits).
export const CONVERSION_RECENCY = { months: 6, windowYears: 5, msn: 'MSN 1904 §11.1', verified: 'HIGH' };

// Grade strings (documentTypes.js) that denote a LEGACY MSN 1859 Y-grade CoC,
// mapped to their conversion key — so when a crew member records/uploads an old
// certificate we can nudge them to convert it to the in-force SV CoC.
export const LEGACY_GRADE_STRINGS = {
  'Engineering — SV / Y4': 'Y4',
  'Engineering — Y3': 'Y3',
  'Engineering — Y2': 'Y2',
  'Engineering — Y1': 'Y1',
  'Y4 / OOW (Yachts)': 'Y4',
  'Y3 / Master <500GT': 'Y3',
  'Y2 / Master <3000GT': 'Y2',
  'Y1 / Master <3000GT (>500GT)': 'Y1'
};

/** Conversion info for a held CoC `grade` string if it's a legacy Y-grade, else
 *  null. Returns { key, to, code, topUp, verified } for the nudge. */
export const legacyConversionForGrade = (grade) => {
  const key = LEGACY_GRADE_STRINGS[grade];
  return key ? { key, ...LEGACY_GRADE_CONVERSION[key] } : null;
};

// ── CoC revalidation — ONE universal procedure for every CoC (MSN 1861 Amd 1).
// Cargo treats this as a shared "stay-current" node, not a per-rung requirement.
// Three alternative service branches, OR 30 months in an acceptable occupation
// (Annex A). Department service gates differ. Form MSF 4201 (MSF 4258 for the
// §9 alternative/lapsed route). HIGH — verbatim from the in-force notice. ──────
export const REVALIDATION = {
  msn: 'MSN 1861 Amd 1 §3.2', verified: 'HIGH', form: 'MSF 4201', altForm: 'MSF 4258',
  validityYears: 5,
  serviceBranches: [
    { label: '12 months seagoing in the last 5 years', months: 12, windowYears: 5 },
    { label: '3 months seagoing in the last 6 months', months: 3, windowMonths: 6 },
    { label: '3 months as supernumerary, immediately prior', months: 3, supernumerary: true }
  ],
  occupationAlternative: { label: '30 months in an acceptable occupation (Annex A)', months: 30 },
  gates: { deck: '>80GT or ≥24m', engineer: '≥750kW', eto: '≥750kW', yacht: 'per the yacht MSN' },
  note: 'Revalidate every 5 years. If your CoC has lapsed, the §9 alternative route issues a temporary lower-rank CoC valid 6 months; full revalidation follows a further 3 months seagoing. A valid ENG1 is required.'
};
