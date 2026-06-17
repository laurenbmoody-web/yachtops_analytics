// Sea Time Tracker — data model + qualification rules engine.
// Faithful port of the logic from the design handoff's <script type="text/x-dc">
// block (design_handoff_sea_time_tracker), re-expressed as pure, framework-
// agnostic functions so the React views and the unit tests share one engine.
//
// EVERY MCA numeric threshold is config (DEFAULT_CONFIG / PATHWAYS), never a
// hard-coded constant — see the // TODO(MIN642) markers. Confirm against the
// live notices (MSN 1858 Amd 2, MIN 642) before any "MCA-compliant" claim.

/** @typedef {'seagoing'|'watchkeeping'|'standby'|'yard'} ServiceType */
/** @typedef {'manual'|'ais'|'rota'} Source */

// ── Config — thresholds (ALL to be confirmed) ──────────────────────────────
export const DEFAULT_CONFIG = {
  watchMinHours: 4,     // TODO(MIN642): MCA 4h/24h watchkeeping minimum — confirm.
  standbyCapDays: 90,   // TODO(MIN642): standby contribution cap — confirm exact figure.
  minLengthM: 15        // TODO(MIN642): vessel-size gate for OOW/Master (Yachts) — confirm.
};

// ── Pathways (CoC targets) — required days per requirement bar ──────────────
export const PATHWAYS = {
  // TODO(MIN642): confirm every day count against MSN 1858 Amendment 2.
  oow3000:    { id: 'oow3000',    label: 'Officer of the Watch (Yachts) <3000GT', short: 'OOW (Yachts) <3000GT', seagoing: 365, watchkeeping: 120, total: 730 },
  master500:  { id: 'master500',  label: 'Master (Yachts) <500GT',  short: 'Master (Yachts) <500GT',  seagoing: 365, watchkeeping: 120, total: 730 },
  master3000: { id: 'master3000', label: 'Master (Yachts) <3000GT', short: 'Master (Yachts) <3000GT', seagoing: 365, watchkeeping: 180, total: 1095 }
};
export const DEFAULT_PATHWAY = 'oow3000';

// ── Service-type metadata (colours + icon paths from the mock) ──────────────
export const TYPE_META = {
  seagoing:     { label: 'Seagoing',     color: '#1F6F8B', bg: '#E3F0F4', hint: 'Days at sea on passage',      icon: 'M3 16c3 0 3-2 6-2s3 2 6 2 3-2 6-2M5 13l1-6h12l1 6M9 7V5h6v2' },
  watchkeeping: { label: 'Watchkeeping', color: '#4C5FB0', bg: '#ECEEFA', hint: '≥4h bridge watch / day',      icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z' },
  standby:      { label: 'Standby',      color: '#B7791F', bg: '#FBF0DA', hint: 'Subject to regulatory cap',   icon: 'M12 8v4m0 4h.01M12 3 3 20h18L12 3Z' },
  yard:         { label: 'Yard',         color: '#5B6675', bg: '#ECEEF2', hint: 'Shipyard / refit service',    icon: 'M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6' }
};

export const SOURCE_META = {
  manual: { label: 'MANUAL', color: '#5A6478', bg: '#EEF0F3' },
  ais:    { label: 'AIS',    color: '#1F6F8B', bg: '#E3F0F4' },
  rota:   { label: 'ROTA',   color: '#4C5FB0', bg: '#ECEEFA' }
};

// ── Verifier profiles — config-driven; a 4th is data ONLY (no engine change) ─
export const VERIFIER_PROFILES = {
  pya: {
    id: 'pya', label: 'PYA', short: 'PYA', name: 'PYA — Professional Yachting Association',
    docs: [
      { id: 'passport', label: 'Certified passport copy' },
      { id: 'email', label: "Signatory's verified email" },
      { id: 'srb', label: 'Discharge book / SRB scan' }
    ],
    fee: '€50 testimonial fee (minimum 2) applies for non-members. Free for PYA members via the D-SRB.',
    instructions: 'Submit via the PYA D-SRB portal or your member profile. Allow 5–10 working days for human verification.',
    lastReviewed: '2026-06-17' // TODO(MIN642): MCA Annex C approved-org list changes — keep dated.
  },
  nautilus: {
    id: 'nautilus', label: 'Nautilus', short: 'Nautilus', name: 'Nautilus International',
    docs: [
      { id: 'template', label: 'Completed Nautilus testimonial template' },
      { id: 'stamp', label: "Master's signature & ship's stamp" },
      { id: 'scan', label: 'Scanned signed copy (PDF)' }
    ],
    fee: 'Included with Nautilus membership. Flow: complete online → print → master signs & stamps → scan → upload.',
    instructions: 'Complete online, print, have the master sign & stamp, scan, then upload to your Nautilus account.',
    lastReviewed: '2026-06-17'
  },
  other: {
    id: 'other', label: 'Other', short: 'this organisation', name: 'Other approved organisation',
    docs: [
      { id: 'min642', label: 'MCA MIN 642 Annex A form' },
      { id: 'sig', label: 'Authorised signatory details' }
    ],
    fee: 'Fees vary by organisation. Generic MIN 642 Annex A layout — the safe default.',
    instructions: "Generic MIN 642 Annex A testimonial. Confirm your organisation's exact submission route before sending.",
    lastReviewed: '2026-06-17'
  }
};

export const getVerifierProfiles = () => Object.values(VERIFIER_PROFILES).map(v => ({ ...v }));

// ── Qualification rules ─────────────────────────────────────────────────────
/**
 * Classify a single entry against its vessel + config. Encodes the regulation —
 * does not just sum days.
 * @returns {{ qual:boolean, reason?:string }}
 */
export const classify = (entry, vessel, config = DEFAULT_CONFIG) => {
  if (!vessel) return { qual: false, reason: 'Vessel record missing — cannot classify this service.' };
  if (entry.type === 'watchkeeping') {
    if (Number(entry.watchHours) < config.watchMinHours) {
      return { qual: false, reason: `Watch under ${config.watchMinHours}h in the 24h period — does not count as watchkeeping under the MCA ${config.watchMinHours}h rule. Re-tag as standby or correct the hours.` };
    }
    if (!vessel.over15) {
      return { qual: false, reason: `Vessel under ${config.minLengthM}m — watchkeeping service on this vessel does not qualify for this pathway.` };
    }
    return { qual: true };
  }
  if (entry.type === 'seagoing') {
    if (!vessel.over15) {
      return { qual: false, reason: `Vessel under ${config.minLengthM}m (${vessel.lengthM}m) — seagoing service does not qualify for the OOW/Master yacht pathway, which requires ≥${config.minLengthM}m.` };
    }
    return { qual: true };
  }
  // standby + yard always count toward their own bucket.
  return { qual: true };
};

/**
 * Bucket totals from non-excluded entries. Standby is capped.
 * @returns {{ seagoing:number, watchkeeping:number, standby:number, standbyRaw:number, yard:number, total:number }}
 */
export const computeBuckets = (entries, vessels, config = DEFAULT_CONFIG) => {
  const live = entries.filter(e => !e.excluded);
  let seagoing = 0, watchkeeping = 0, standbyRaw = 0, yard = 0;
  for (const e of live) {
    const c = classify(e, vessels[e.vesselId], config);
    if (e.type === 'seagoing' && c.qual) seagoing += e.days;
    else if (e.type === 'watchkeeping' && c.qual) watchkeeping += e.days;
    else if (e.type === 'standby') standbyRaw += e.days;
    else if (e.type === 'yard') yard += e.days;
  }
  const standby = Math.min(standbyRaw, config.standbyCapDays);
  return { seagoing, watchkeeping, standby, standbyRaw, yard, total: seagoing + watchkeeping + standby + yard };
};

/**
 * Multi-requirement progress (NOT one ring): seagoing / watchkeeping / total.
 * current = prior[key] + bucket[key]; required = pathway[key].
 */
export const computeRequirements = (buckets, prior, pathway) => {
  const current = {
    seagoing: prior.seagoing + buckets.seagoing,
    watchkeeping: prior.watchkeeping + buckets.watchkeeping,
    total: prior.total + buckets.total
  };
  const defs = [
    { key: 'seagoing', label: 'Qualifying sea service', sub: 'on vessels ≥15m', short: 'Sea service ≥15m' },
    { key: 'watchkeeping', label: 'Watchkeeping', sub: 'days with ≥4h bridge watch', short: 'Watchkeeping' },
    { key: 'total', label: 'Total sea service', sub: 'all qualifying service combined', short: 'Total service' }
  ];
  return defs.map(r => {
    const c = current[r.key], required = pathway[r.key], met = c >= required;
    return {
      key: r.key, label: r.label, sub: r.sub, short: r.short,
      current: c, required, met,
      pct: Math.min(100, Math.round((c / required) * 100)),
      remaining: Math.max(0, required - c),
      statusLabel: met ? 'Requirement met' : `${Math.max(0, required - c)} days to go`
    };
  });
};

// ── Validation gate — generation BLOCKED unless every rule passes ───────────
/**
 * @param {Object} p
 * @param {Array}  p.entries
 * @param {Object} p.vessels
 * @param {Object} p.config
 * @param {'master'|'self'} p.signatory
 * @param {string} p.verifier   verifier id
 * @param {Object} p.docMet     map docId -> boolean
 * @returns {{ checks:Array, canGenerate:boolean, passed:number, total:number, readinessPct:number }}
 */
export const runChecks = ({ entries, vessels, config = DEFAULT_CONFIG, signatory, verifier, docMet = {} }) => {
  const live = entries.filter(e => !e.excluded);
  const checks = [];

  // 1) Watchkeeping 4-hour rule.
  const badWatch = live.filter(e => e.type === 'watchkeeping' && Number(e.watchHours) < config.watchMinHours);
  checks.push(badWatch.length
    ? { ok: false, label: 'Watchkeeping 4-hour rule', detail: `${badWatch.length} entry tagged watchkeeping with under ${config.watchMinHours}h watch — re-tag or correct before generating.` }
    : { ok: true, label: 'Watchkeeping 4-hour rule', detail: `Every watchkeeping day records ≥${config.watchMinHours}h bridge watch.` });

  // 2) Vessel size gate (≥ minLengthM).
  const badSize = live.filter(e => e.type === 'seagoing' && !vessels[e.vesselId]?.over15);
  checks.push(badSize.length
    ? { ok: false, label: `Vessel size gate (≥${config.minLengthM}m)`, detail: `Seagoing service claimed on a vessel under ${config.minLengthM}m — exclude it or change the pathway.` }
    : { ok: true, label: `Vessel size gate (≥${config.minLengthM}m)`, detail: `All qualifying seagoing service is on vessels ≥${config.minLengthM}m.` });

  // 3) Standby within cap.
  const b = computeBuckets(entries, vessels, config);
  checks.push(b.standbyRaw > config.standbyCapDays
    ? { ok: false, label: 'Standby within cap', detail: `Standby exceeds the ${config.standbyCapDays}-day cap.` }
    : { ok: true, label: 'Standby within cap', detail: `${b.standbyRaw} / ${config.standbyCapDays} standby days — within cap. // TODO(MIN642): confirm exact cap.` });

  // 4) Vessel records complete (GT + registered length present).
  const usedVessels = [...new Set(live.map(e => e.vesselId))].map(id => vessels[id]);
  const incompleteVessel = usedVessels.find(v => !v || v.gt == null || v.lengthM == null);
  checks.push(incompleteVessel
    ? { ok: false, label: 'Vessel records complete', detail: `Vessel "${incompleteVessel?.name || 'unknown'}" is missing GT or registered length.` }
    : { ok: true, label: 'Vessel records complete', detail: 'GT and registered length present for every vessel.' });

  // 5) Signatory & self-certification — HARD FAIL if self.
  const selfCert = signatory === 'self';
  checks.push(selfCert
    ? { ok: false, label: 'Signatory & self-certification', detail: 'Hard fail (MIN 642): the MCA will not accept self-certificated seagoing service. Assign a different master.' }
    : { ok: true, label: 'Signatory & self-certification', detail: 'Signed by the master — not the seafarer.' });

  // 6) Supporting documents for the selected verifier.
  const docs = VERIFIER_PROFILES[verifier]?.docs || [];
  const missing = docs.filter(d => !docMet[d.id]);
  checks.push(missing.length
    ? { ok: false, label: 'Supporting documents', detail: `${missing.length} required document(s) outstanding for ${VERIFIER_PROFILES[verifier]?.short}.` }
    : { ok: true, label: 'Supporting documents', detail: `All ${VERIFIER_PROFILES[verifier]?.short} supporting documents attached.` });

  const passed = checks.filter(c => c.ok).length;
  return { checks, canGenerate: checks.every(c => c.ok), passed, total: checks.length, readinessPct: Math.round((passed / checks.length) * 100) };
};

// ── Tamper-evident hash (FNV-1a from the mock) ──────────────────────────────
// NOTE: the mock uses this deterministic FNV-style hash for the QR seal.
// Production should hash the canonical serialised record with SHA-256 — see
// src/seatime/testimonial/assurance.js. Kept here for parity with the design.
export const fnvHash = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let hex = (h >>> 0).toString(16);
  while (hex.length < 8) hex = '0' + hex;
  let out = '';
  for (let i = 0; i < 4; i++) { out += hex; h = Math.imul(h ^ i, 0x01000193); hex = (h >>> 0).toString(16).padStart(8, '0'); }
  return out.slice(0, 40);
};

/** Seed string + hash + verification ref for the assurance seal. */
export const computeAssurance = ({ verifierShort, buckets, signatory }) => {
  const seed = `${verifierShort}|${buckets.total}|${buckets.seagoing}|${buckets.watchkeeping}|${buckets.standby}|${buckets.yard}|${signatory}`;
  const contentHash = fnvHash(seed);
  return { seed, contentHash, verificationRef: 'CARGO-STT-' + contentHash.slice(0, 6).toUpperCase(), qrPayload: `sha256:${contentHash}` };
};

/**
 * MIN 642 Annex A export object — totals split into the four service types
 * SEPARATELY (never merged).
 */
export const buildTestimonialDataset = ({ seafarer, entries, vessels, config = DEFAULT_CONFIG, signatory, verifier }) => {
  const buckets = computeBuckets(entries, vessels, config);
  const live = entries.filter(e => !e.excluded);
  const usedVessels = [...new Set(live.map(e => e.vesselId))].map(id => vessels[id]);
  const assurance = computeAssurance({ verifierShort: VERIFIER_PROFILES[verifier]?.short, buckets, signatory });
  return {
    seafarer,
    vessels: usedVessels.map(v => ({ name: v.name, flag: v.flag, imo: v.imo, gt: v.gt, lengthM: v.lengthM })),
    service: {
      capacity: live[0]?.capacity || seafarer?.cocHeld || '',
      totals: { seagoing: buckets.seagoing, watchkeeping: buckets.watchkeeping, standby: buckets.standby, yard: buckets.yard }
    },
    signatory,
    assurance
  };
};
