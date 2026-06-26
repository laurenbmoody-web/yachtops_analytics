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

import { SERVICE_RULES } from './pathways.js';

// ── Config — thresholds sourced from MSN 1858 Amd 2 (deck) / MSN 1859 (engine).
// Standby is NOT a flat cap: it may not exceed actual seagoing service (1858
// §5.2 / MIN 498). Yard service is capped at 90 days for OOW <3000GT and 30 days
// for Chief Mate / Master (1858 §3.3–§3.6 / 1859 §5.2). The 90 here is the OOW
// baseline; callers pass the per-certificate cap via yardCapForCertificate(). ──
export const DEFAULT_CONFIG = {
  watchMinHours: 4,        // 4h/24h = 1 day (1858/1859 §5) HIGH
  minLengthM: 15,          // OOW/Master <3000 vessel-size gate (1858 §3.3) HIGH
  yardCapDays: 90,         // yard cap — OOW baseline; 30 for Master/Chief Mate HIGH
  standbyMode: 'le_seagoing' // standby total ≤ actual seagoing service (1858 §5.2) HIGH
};

// ── Pathways (CoC targets) — required days per requirement bar ──────────────
export const PATHWAYS = {
  // TODO(MIN642): confirm every day count against MSN 1858 Amendment 2.
  oow3000:    { id: 'oow3000',    label: 'Officer of the Watch (Yachts) <3000GT', short: 'OOW (Yachts) <3000GT', seagoing: 365, watchkeeping: 120, total: 730 },
  master500:  { id: 'master500',  label: 'Master (Yachts) <500GT',  short: 'Master (Yachts) <500GT',  seagoing: 365, watchkeeping: 120, total: 730 },
  master3000: { id: 'master3000', label: 'Master (Yachts) <3000GT', short: 'Master (Yachts) <3000GT', seagoing: 365, watchkeeping: 180, total: 1095 }
};
export const DEFAULT_PATHWAY = 'oow3000';

// ── Service-type metadata. Colours are a restrained, harmonious set (calm,
// low-saturation tints) so the four buckets read as a family rather than four
// competing colours; terracotta stays reserved for the brand accent. ──────────
export const TYPE_META = {
  seagoing:     { label: 'Seagoing',     color: '#2F6080', bg: '#E8EFF4', hint: 'Days at sea on passage',      icon: 'M3 16c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 20c3 0 3-2 6-2s3 2 6 2 3-2 6-2M5 14l1-6h12l1 6M9 8V5h6v3' },
  watchkeeping: { label: 'Watchkeeping', color: '#6B57A0', bg: '#ECE7F6', hint: '≥4h bridge watch / day',      icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z' },
  standby:      { label: 'Standby',      color: '#A6712C', bg: '#F5ECDA', hint: 'Can’t exceed your sea-service days', icon: 'M6 2h12M6 22h12M8 2v5l4 4 4-4V2M8 22v-5l4-4 4 4v5' },
  yard:         { label: 'Yard',         color: '#6E665C', bg: '#F1EFEA', hint: 'Shipyard / refit service',    icon: 'M14.5 6a3.5 3.5 0 0 0-4.6 4.3l-5.3 5.3a1.6 1.6 0 1 0 2.3 2.3l5.3-5.3A3.5 3.5 0 0 0 18 9.5l-2 2-1.5-1.5 2-2A3.5 3.5 0 0 0 14.5 6Z' }
};

export const SOURCE_META = {
  manual: { label: 'MANUAL', color: '#6B7280', bg: '#F0F1F4' },
  ais:    { label: 'AIS',    color: '#3A5A74', bg: '#EDF1F5' },
  rota:   { label: 'ROTA',   color: '#4F5D8A', bg: '#ECEEF6' },
  vessel: { label: 'AUTO',   color: '#3F7A52', bg: '#EFF6F1' }
};

// ── Verifier profiles — config-driven; a 4th is data ONLY (no engine change) ─
export const VERIFIER_PROFILES = {
  nautilus: {
    id: 'nautilus', label: 'Nautilus', short: 'Nautilus', name: 'Nautilus International',
    // profileDoc = the personal_documents doc_type that satisfies it, so the
    // check ticks automatically when the crew has it on file (no email needed
    // now that sign-off is parked).
    docs: [
      { id: 'passport', label: 'Certified passport copy', profileDoc: 'passport_certified_copy' },
      { id: 'srb', label: 'Discharge book / SRB scan', profileDoc: 'seamans_book' }
    ],
    fee: 'Verification via Nautilus International (MIN 543 authorised); fees per their member tariff.',
    // Nautilus issue their own SST form — Cargo fills Parts 1–2 from your record;
    // the master signs Parts 3–4 and Nautilus verify (Part 5).
    instructions: 'Nautilus International verify yacht sea service for the MCA (MIN 543). Export your pre-filled Nautilus testimonial here, have the master sign and stamp it, then submit to Nautilus to verify with the signatory.',
    lastReviewed: '2026-06-26'
  },
  pya: {
    id: 'pya', label: 'PYA', short: 'PYA', name: 'PYA — Professional Yachting Association',
    docs: [
      { id: 'passport', label: 'Certified passport copy', profileDoc: 'passport_certified_copy' },
      { id: 'srb', label: 'Discharge book / SRB scan', profileDoc: 'seamans_book' }
    ],
    fee: '€50 per testimonial (minimum 2 on first submission) for non-members; included for PYA members.',
    // PYA build the testimonial on their portal — Cargo's record is used to complete it / as evidence.
    instructions: 'PYA verify yacht sea service for the MCA (MIN 543). Complete the testimonial on your PYA member profile and send it to your signatory to e-sign — use this captain-attested record to fill it accurately. PYA then verify with the signatory (up to ~25 working days). Self-signed testimonials are declined.',
    lastReviewed: '2026-06-22' // TODO(MIN543): keep the approved-verifier list dated.
  },
  transport_malta: {
    id: 'transport_malta', label: 'Transport Malta', short: 'Transport Malta', name: 'Transport Malta — Merchant Shipping Directorate',
    docs: [
      { id: 'passport', label: 'Certified passport copy', profileDoc: 'passport_certified_copy' },
      { id: 'sig', label: 'Authorised signatory details' },
      { id: 'srb', label: 'Discharge book / service record' }
    ],
    fee: 'Verification via the Transport Malta yacht sea-service route (MIN 543 authorised).',
    instructions: 'Transport Malta is an MCA-authorised verifier (MIN 543). Submit through their route using this captain-attested record as your evidence.',
    lastReviewed: '2026-06-22'
  },
  mca: {
    id: 'mca', label: 'MCA · Discharge Book', short: 'the MCA', name: 'Maritime & Coastguard Agency (direct)',
    docs: [
      { id: 'srb', label: 'Discharge Book with master’s stamps' },
      { id: 'stamp', label: 'Master’s signature & ship’s stamp' },
      { id: 'passport', label: 'Certified passport copy', profileDoc: 'passport_certified_copy' }
    ],
    fee: 'No verifier fee — submitted directly to the MCA with your CoC application.',
    instructions: 'Direct MCA route via your Discharge Book and a master-signed Testimonial of Sea Service (MSN 1858). Use this record as the testimonial — the master attests it; the MCA assess it with your application.',
    lastReviewed: '2026-06-22'
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
  let seagoing = 0, watchkeeping = 0, standbyRaw = 0, yardRaw = 0;
  for (const e of live) {
    const c = classify(e, vessels[e.vesselId], config);
    if (e.type === 'seagoing' && c.qual) seagoing += e.days;
    else if (e.type === 'watchkeeping' && c.qual) watchkeeping += e.days;
    else if (e.type === 'standby') standbyRaw += e.days;
    else if (e.type === 'yard') yardRaw += e.days;
  }
  // Watchkeeping is part of actual seagoing service; standby may not exceed it.
  const actualSeagoing = seagoing + watchkeeping;
  const standby = Math.min(standbyRaw, actualSeagoing);
  const yard = Math.min(yardRaw, config.yardCapDays ?? 90);
  const onboardDays = live.reduce((n, e) => n + e.days, 0); // onboard = signed-on, any activity
  return { seagoing, watchkeeping, standby, standbyRaw, yard, yardRaw, actualSeagoing, onboardDays, total: seagoing + watchkeeping + standby + yard };
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

/**
 * Build the progress bars for a specific CERTIFICATE (from pathways.js). Only
 * the requirement fields the certificate actually defines are shown, so each
 * CoC tracks its real MCA thresholds. Months convert at SERVICE_RULES.monthDays.
 * `prior` = lifetime accrual baseline { onboard, seagoing, watchkeeping }.
 */
// Qualifying seagoing service (seagoing + watchkeeping) whose days fall within
// the last `years` years — the MCA's recency rule: at least 6 months of
// qualifying seagoing service in the 5 years immediately preceding NoE/CoC issue
// (MSN 1856 §17.2/§19.1; MSN 1858 §5.1). Counts only the in-window days of each
// period; undated baselines can't be assessed for recency and are excluded.
export const recentQualifyingDays = (entries, asOf = new Date(), years = 5) => {
  const end = asOf instanceof Date ? asOf : new Date(asOf);
  const start = new Date(end); start.setFullYear(start.getFullYear() - years);
  const MS = 86400000;
  let total = 0;
  for (const e of entries || []) {
    if (e.excluded) continue;
    if (e.type !== 'seagoing' && e.type !== 'watchkeeping') continue;
    if (!e.from) continue;
    const f = new Date(e.from + 'T00:00:00');
    const t = e.to ? new Date(e.to + 'T00:00:00') : f;
    const oStart = f > start ? f : start;
    const oEnd = t < end ? t : end;
    if (oEnd >= oStart) total += Math.round((oEnd - oStart) / MS) + 1;
  }
  return total;
};

export const buildRequirementBars = (buckets, prior = {}, cert, recentDays = null) => {
  const md = SERVICE_RULES.monthDays;
  const cur = {
    onboard: (prior.onboard || 0) + (buckets.onboardDays || 0),
    seagoing: (prior.seagoing || 0) + buckets.seagoing,
    watchkeeping: (prior.watchkeeping || 0) + buckets.watchkeeping,
    actualSea: (prior.seagoing || 0) + buckets.seagoing + buckets.watchkeeping
  };
  const r = cert?.requires || {};
  // Each bar carries the route's confidence so the UI never presents an
  // unverified threshold as authoritative. provisional = the cert's figures
  // aren't HIGH-confidence from the cited notice (e.g. ETO STCW A-III/6).
  const provisional = cert?.verified && cert.verified !== 'HIGH';
  const bars = [];
  const add = (key, label, current, targetDays, extra = {}) => {
    const met = current >= targetDays;
    bars.push({ key, label, current, required: targetDays, met, remaining: Math.max(0, targetDays - current), pct: targetDays ? Math.min(100, Math.round(current / targetDays * 100)) : 100, provisional, ...extra });
  };
  if (r.onboardMonths) add('onboard', 'Onboard yacht service', cur.onboard, r.onboardMonths * md);
  if (r.seagoingDays) add('seagoing', `Seagoing service${r.minVesselMetres ? ` (≥${r.minVesselMetres}m)` : ''}`, cur.seagoing, r.seagoingDays);
  if (r.seagoingMonths) add('seagoing', 'Seagoing service', cur.seagoing, r.seagoingMonths * md);
  if (r.watchkeepingDays) add('watchkeeping', 'Watchkeeping service', cur.watchkeeping, r.watchkeepingDays);
  if (r.actualSeaServiceMonths) add('actualSea', 'Actual sea service', cur.actualSea, r.actualSeaServiceMonths * md);
  // Recency — the MCA needs ≥6 months qualifying seagoing service within the last
  // 5 years at NoE/CoC issue (MSN 1856 §17.2/§19.1). Its application point varies
  // by route (entry CoC vs revalidation), so it's shown as advisory guidance, not
  // a hard gate that blocks the eligibility flag.
  if (recentDays != null) add('recency', 'Recent service · 6mo in last 5yr', recentDays, 6 * md, { advisory: true });
  if (!bars.length) bars.push({ key: 'none', label: 'No additional qualifying service required', current: 0, required: 0, met: true, remaining: 0, pct: 100 });
  return bars;
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

  // 3) Standby within limit — standby may not exceed actual seagoing service.
  const b = computeBuckets(entries, vessels, config);
  checks.push(b.standbyRaw > b.actualSeagoing
    ? { ok: false, label: 'Standby within limit', detail: `Standby (${b.standbyRaw}d) exceeds actual seagoing service (${b.actualSeagoing}d). MCA caps standby at your seagoing total (MSN 1858 §5.2) — exclude the excess.` }
    : { ok: true, label: 'Standby within limit', detail: `${b.standbyRaw}d standby ≤ ${b.actualSeagoing}d actual seagoing — within limit (MSN 1858 §5.2).` });

  // 4) Vessel records complete (GT + registered length present).
  const usedVessels = [...new Set(live.map(e => e.vesselId))].map(id => vessels[id]);
  const incompleteVessel = usedVessels.find(v => !v || v.gt == null || v.lengthM == null);
  checks.push(incompleteVessel
    ? { ok: false, label: 'Vessel records complete', detail: `Vessel "${incompleteVessel?.name || 'unknown'}" is missing GT or registered length.` }
    : { ok: true, label: 'Vessel records complete', detail: 'GT and registered length present for every vessel.' });

  // 5) Endorsing master on record — the Nautilus/PYA testimonial is per-master,
  //    so every Cargo-tracked period must carry the master who covered it (they
  //    sign the exported form; Cargo no longer captures a signature in-app).
  const cargoTracked = (entries || []).filter(e => e.source === 'vessel' && !e.excluded);
  const noMasterDays = cargoTracked.filter(e => !e.masterUserId && !e.masterName).reduce((s, e) => s + (e.days || 0), 0);
  checks.push(noMasterDays > 0
    ? { ok: false, label: 'Endorsing master on record', detail: `${noMasterDays} day(s) of Cargo-tracked service have no master on record to endorse them.` }
    : { ok: true, label: 'Endorsing master on record', detail: 'Every Cargo-tracked period has an identified master to endorse it on the exported form.' });

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
