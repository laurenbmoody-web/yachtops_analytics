// Sea Time Tracker — MCA qualifying-service thresholds, departments, roles and
// certificates. Figures extracted from the live notices:
//   DECK   — MSN 1858 (M) Amendment 2  (Deck Officers on Large Yachts 24m+)
//   ENGINE — MSN 1859 (M+F)            (Yacht Engineer certification)
//
// Confidence: HIGH = stated verbatim in the notice (section cited); MEDIUM =
// inferred; PENDING = not in these notices, confirm before production. Treat
// every numeric threshold as config — see // TODO(MIN642)/(MSN18xx) markers.

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
  // INTERIOR / GALLEY — log days, no CoC credit
  stewardess:     { label: 'Stewardess',               department: 'interior', accruesToward: [], watchkeepingDomain: null },
  chief_stew:     { label: 'Chief Stewardess',         department: 'interior', accruesToward: [], watchkeepingDomain: null },
  purser:         { label: 'Purser',                   department: 'interior', accruesToward: [], watchkeepingDomain: null },
  cook:           { label: 'Cook',                     department: 'galley', accruesToward: [], watchkeepingDomain: null },
  chef:           { label: 'Yacht Chef / Head Chef',   department: 'galley', accruesToward: [], watchkeepingDomain: null },
  other:          { label: 'Other',                    department: 'other', accruesToward: [], watchkeepingDomain: null }
};

// ── Certificates. `requires` fields drive the progress bars (only the fields
// present are shown). Months are converted to days at SERVICE_RULES.monthDays.
// `routes` documents alternative service routes where the notice gives several. ─
export const CERTIFICATES = {
  // ===================== DECK — MSN 1858 Amendment 2 (HIGH) =====================
  OOW_YACHT_3000: {
    family: 'DECK', label: 'OOW (Yachts <3000GT)', short: 'OOW <3000GT',
    msn: 'MSN 1858 Amd 2 §3.3', verified: 'HIGH',
    yardCapDays: 90,                // OOW: up to 90 yard days may count (1858 §3.3)
    requires: {
      onboardMonths: 36,            // 36 months onboard yacht service since age 16
      seagoingDays: 365,            // ≥365 days seagoing on vessels ≥15m (250 seagoing + 115 combo)
      minVesselMetres: 15
      // TODO(MSN1858): model the 250 + 115 split (115 may be seagoing/standby/yard combined).
    },
    note: 'Entry watchkeeping CoC. 365 seagoing days = 250 days seagoing + 115 days combined seagoing/standby/yard.'
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
    heldWhilst: 'OOW (Yachts <3000GT) II/1'
  },
  MASTER_YACHT_3000: {
    family: 'DECK', label: 'Master (Yachts <3000GT)', short: 'Master <3000GT',
    msn: 'MSN 1858 Amd 2 §3.6', verified: 'HIGH',
    yardCapDays: 30,                // Master: max 30 yard days (1858 §3.6)
    requires: { onboardMonths: 24, watchkeepingDays: 240, minVesselMetres: 15 },
    heldWhilst: 'OOW (Yachts <3000GT) II/1',
    note: 'All service ≥15m AND include 12 months on ≥24m OR 6 months on ≥500GT.'
  },
  CHIEF_MATE_UNLIMITED: {
    family: 'DECK', label: 'Chief Mate (Yachts Unlimited)', short: 'Chief Mate Unltd',
    msn: 'MSN 1858 Amd 2 §4.3', verified: 'HIGH',
    yardCapDays: 30,                // Chief Mate: max 30 yard days (1858 §4.3)
    requires: { onboardMonths: 12, seagoingMonths: 6, minGT: 500 },
    heldWhilst: 'OOW Unlimited (or Master Yachts <3000GT II/1)',
    note: 'OOW-Unlimited route: 12 months onboard as OOW incl. 6 months seagoing, all on a yacht ≥500GT.'
  },
  MASTER_UNLIMITED: {
    family: 'DECK', label: 'Master (Yachts Unlimited)', short: 'Master Unltd',
    msn: 'MSN 1858 Amd 2 §4.4', verified: 'HIGH',
    yardCapDays: 30,                // Master: max 30 yard days (1858 §4.4)
    // 3 alternative routes — default bar uses the Chief-Mate-Unlimited route (A).
    requires: { onboardMonths: 12, seagoingMonths: 6, minGT: 500 },
    heldWhilst: 'Chief Mate (Yachts Unlimited)',
    routes: [
      { whilstHolding: 'Chief Mate Yachts Unlimited', onboardMonths: 12, seagoingMonths: 6, minGT: 500 },
      { whilstHolding: 'Master Yachts <3000GT II/2', onboardMonths: 6, seagoingMonths: 3, minGT: 500 },
      { whilstHolding: 'OOW Unlimited', onboardMonths: 36, seagoingMonths: 15, minVesselMetres: 15, seagoingMinGT: 500 }
    ]
  },

  // ===================== ENGINE — MSN 1859 (HIGH on figures) =====================
  MEOL_Y: {
    family: 'ENGINE', label: 'Marine Engine Operator Licence (Yacht)', short: 'MEOL (Y)',
    msn: 'MSN 1859 §3.3', verified: 'HIGH',
    requires: { onboardMonths: 24, minPowerKW: 200 },
    note: '24 months as yacht engineer on yachts ≥200kW — OR 36 months dual deck/engineer (≥50% in the engine room).'
  },
  Y4: {
    family: 'ENGINE', label: 'Chief Engineer (Y4) — STCW III/3', short: 'Y4',
    msn: 'MSN 1859 §3.4', verified: 'HIGH',
    requires: { onboardMonths: 42, onboardMonthsAtPower: 12, actualSeaServiceMonths: 6, minPowerKW: 350 },
    routes: [
      { whilstHolding: null, onboardMonths: 42, onboardMonthsAtPower: 12, actualSeaServiceMonths: 6, minPowerKW: 350 },
      { whilstHolding: 'MEOL (yacht or MN)', onboardMonths: 12, actualSeaServiceMonths: 6, minPowerKW: 350 },
      { whilstHolding: 'MN SMEOL', onboardMonths: 6, actualSeaServiceMonths: 3, minPowerKW: 350 }
    ]
  },
  Y3: {
    family: 'ENGINE', label: 'Chief Engineer (Y3) — STCW III/3', short: 'Y3',
    msn: 'MSN 1859 §3.5', verified: 'HIGH',
    requires: { onboardMonths: 9, actualSeaServiceMonths: 3, minPowerKW: 350 },
    heldWhilst: 'Y4',
    routes: [
      { whilstHolding: 'Y4', onboardMonths: 9, actualSeaServiceMonths: 3, minPowerKW: 350 },
      { whilstHolding: null, onboardMonths: 51, onboardMonthsAtPower: 21, actualSeaServiceMonths: 9, minPowerKW: 350 }
    ]
  },
  Y2: {
    family: 'ENGINE', label: 'Chief Engineer (Y2) — STCW III/2', short: 'Y2',
    msn: 'MSN 1859 §3.6', verified: 'HIGH',
    requires: { onboardMonths: 15, actualSeaServiceMonths: 9, minPowerKW: 350 },
    heldWhilst: 'Y3 (or Y4)',
    routes: [
      { whilstHolding: 'Y4', onboardMonths: 24, actualSeaServiceMonths: 12, minPowerKW: 350 },
      { whilstHolding: 'Y3', onboardMonths: 15, actualSeaServiceMonths: 9, minPowerKW: 350 }
    ]
  },
  Y1: {
    family: 'ENGINE', label: 'Chief Engineer (Y1) — STCW III/2', short: 'Y1',
    msn: 'MSN 1859 §3.7', verified: 'HIGH',
    requires: { onboardMonths: 12, minPowerKW: 1500, minGT: 500 },
    heldWhilst: 'Y2',
    note: 'Motor yachts ≥1500kW & ≥500GT, OR sailing yachts ≥1500kW & ≥1000GT — 12 months whilst holding Y2.',
    routes: [
      { whilstHolding: 'Y2', onboardMonths: 12, minPowerKW: 1500, minGT: 500, hull: 'motor' },
      { whilstHolding: 'Y2', onboardMonths: 12, minPowerKW: 1500, minGT: 1000, hull: 'sail' }
    ]
  },

  // ===================== ETO — STCW A-III/6 (not in these notices) =============
  ETO_COC: {
    family: 'ETO', label: 'Electro-Technical Officer (STCW A-III/6)', short: 'ETO',
    msn: 'STCW A-III/6', verified: 'PENDING',
    requires: { seagoingMonths: 12 },
    note: 'Not covered by MSN 1858/1859. // TODO: confirm 12 months combined workshop + seagoing against STCW A-III/6.'
  }
};

export const DEFAULT_CERTIFICATE = 'OOW_YACHT_3000';

// ── Goal-based routing. A crew member picks a GOAL (career ceiling); the spine
// shows only the certificates on the route to it. Held certs (from the crew's
// CoC documents) mark where they are; the live target is the first un-held rung
// on the route. TODO(MSN-routes): confirm exact prerequisite chains vs 1858/1859.
export const CERTIFICATE_ROUTES = {
  // DECK
  OOW_YACHT_3000:        ['OOW_YACHT_3000'],
  CHIEF_MATE_YACHT_3000: ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000'],
  MASTER_YACHT_500:      ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_500'],
  MASTER_YACHT_3000:     ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_500', 'MASTER_YACHT_3000'],
  CHIEF_MATE_UNLIMITED:  ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED'],
  MASTER_UNLIMITED:      ['OOW_YACHT_3000', 'CHIEF_MATE_YACHT_3000', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED', 'MASTER_UNLIMITED'],
  // ENGINE
  MEOL_Y: ['MEOL_Y'],
  Y4: ['MEOL_Y', 'Y4'],
  Y3: ['MEOL_Y', 'Y4', 'Y3'],
  Y2: ['MEOL_Y', 'Y4', 'Y3', 'Y2'],
  Y1: ['MEOL_Y', 'Y4', 'Y3', 'Y2', 'Y1'],
  // ETO
  ETO_COC: ['ETO_COC']
};

/** Sensible career-ceiling goals offered per family (entry certs excluded). */
export const GOAL_OPTIONS = {
  DECK: ['MASTER_YACHT_500', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED', 'MASTER_UNLIMITED'],
  ENGINE: ['Y4', 'Y3', 'Y2', 'Y1'],
  ETO: ['ETO_COC']
};

export const DEFAULT_GOAL = { DECK: 'MASTER_YACHT_3000', ENGINE: 'Y1', ETO: 'ETO_COC' };

/** Certificate families a department can work toward (drives the pathway).
 *  Engineering carries both the Y-grade engine ladder and the ETO route. */
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
  'OOW <3000GT': 'OOW_YACHT_3000',
  'Chief Mate <3000GT': 'CHIEF_MATE_YACHT_3000',
  'Chief Mate unlimited': 'CHIEF_MATE_UNLIMITED',
  'Master <500GT': 'MASTER_YACHT_500',
  'Master <3000GT': 'MASTER_YACHT_3000',
  'Master unlimited': 'MASTER_UNLIMITED',
  'Engineering — MEOL (Yachts)': 'MEOL_Y',
  'Engineering — SV / Y4': 'Y4',
  'Engineering — Y3': 'Y3',
  'Engineering — Y2': 'Y2',
  'Engineering — Y1': 'Y1',
  'Y4 / OOW (Yachts)': 'Y4',
  'Y3 / Master <500GT': 'Y3',
  'Y2 / Master <3000GT': 'Y2',
  'Y1 / Master <3000GT (>500GT)': 'Y1'
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

/** Confidence of a certificate's encoded thresholds, for the UI to gate display.
 *  HIGH = stated verbatim in the cited notice; anything else is provisional and
 *  must be flagged "confirm against [notice]" rather than shown as authoritative,
 *  so crew on a not-yet-verified route are never given a wrong eligibility figure. */
export const certConfidence = (cert) => {
  const level = cert?.verified || 'PENDING';
  return {
    level,
    authoritative: level === 'HIGH',
    notice: cert?.msn || null,
    label: level === 'HIGH' ? 'Notice-verified'
      : level === 'MEDIUM' ? 'Provisional — confirm figures'
      : 'Not yet verified — confirm figures'
  };
};
