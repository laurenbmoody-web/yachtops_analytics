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

import { SERVICE_RULES, isOfficerCapacity } from './pathways.js';

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
    // MIN 543 verification needs only ID + the signed testimonial; the master's
    // CoC is a FIELD inside the testimonial (validated by Nautilus contacting the
    // signatory), not a separate upload. SRB is supporting, not mandatory.
    docs: [
      { id: 'passport', label: 'Attested passport copy (ID)', profileDoc: 'passport_certified_copy' },
      { id: 'srb', label: 'Discharge book / Service Record Book scan', profileDoc: 'seamans_book', optional: true }
    ],
    fee: 'Members only — join Nautilus to use the service; a free Commercial Yacht SRB is included (MIN 543 authorised).',
    // Nautilus issue their own SST form — Cargo fills Parts 1–2 from your record;
    // the master signs Parts 3–4 and Nautilus verify (Part 5).
    instructions: 'Nautilus International verify yacht sea service for the MCA (MIN 543). Export your pre-filled Nautilus testimonial here, have the master sign and stamp it, then submit to Nautilus to verify with the signatory.',
    lastReviewed: '2026-06-26'
  },
  pya: {
    id: 'pya', label: 'PYA', short: 'PYA', name: 'PYA — Professional Yachting Association',
    docs: [
      { id: 'passport', label: 'Certified passport copy (ID)', profileDoc: 'passport_certified_copy' },
      { id: 'srb', label: 'Discharge book / Service Record Book scan', profileDoc: 'seamans_book', optional: true }
    ],
    fee: '€50 per testimonial (minimum 2 on first submission) for non-members; included for PYA members.',
    // PYA build the testimonial on their portal — Cargo's record is used to complete it / as evidence.
    instructions: 'PYA verify yacht sea service for the MCA (MIN 543). Complete the testimonial on your PYA member profile and send it to your signatory to e-sign — use this captain-attested record to fill it accurately. PYA then verify with the signatory (up to ~25 working days). Self-signed testimonials are declined.',
    lastReviewed: '2026-06-22' // TODO(MIN543): keep the approved-verifier list dated.
  },
  transport_malta: {
    id: 'transport_malta', label: 'Transport Malta', short: 'Transport Malta', name: 'Transport Malta — Merchant Shipping Directorate',
    // Verifying SERVICE only needs what supports the testimonial: ID, the signed
    // testimonial form, and (per the S.L. 499.23 form) the Certificate of
    // Registry / CVC for each vessel. SRB is supporting. CoC / photos / medical
    // are CoC-application docs, NOT testimonial-verification docs.
    docs: [
      { id: 'passport', label: 'Passport or ID card copy', profileDoc: 'passport_certified_copy' },
      { id: 'cvc', label: 'Certificate of Registry / CVC — copy per vessel' },
      { id: 'sig', label: 'Authorised signatory (Captain / CO / CE / Owner / Manager)' },
      { id: 'srb', label: 'Discharge book / Seaman’s book', profileDoc: 'seamans_book', optional: true }
    ],
    fee: 'Verification via the Transport Malta Seafarer Portal (MIN 543 authorised); processing fee applies.',
    instructions: 'Transport Malta is an MCA-authorised verifier (MIN 543). Download the official deck testimonial (S.L. 499.23) here — Cargo pre-fills the service details onto Transport Malta’s own form for the master to complete and sign. Submit it via their Seafarer Portal with your ID and a copy of each vessel’s Certificate of Registry / CVC.',
    lastReviewed: '2026-06-22'
  },
  mca: {
    id: 'mca', label: 'MCA · Discharge Book', short: 'the MCA', name: 'Maritime & Coastguard Agency (direct)',
    // Direct MCA route: the testimonial must be backed by a SECOND form of
    // evidence per vessel (Discharge Book entries / Certificates of Discharge)
    // unless an MCA-approved SRB is used (MSN 1858 Annex F).
    docs: [
      { id: 'srb', label: 'Discharge Book with master’s stamps', profileDoc: 'seamans_book' },
      { id: 'stamp', label: 'Master’s signature & ship’s official stamp on the testimonial' },
      { id: 'passport', label: 'Certified passport copy', profileDoc: 'passport_certified_copy' }
    ],
    fee: 'No verifier fee — but note the MCA still needs a verified testimonial (PYA/Nautilus) unless you use an MCA-approved Service Record Book.',
    instructions: 'Direct MCA route via your Discharge Book and a master-signed Testimonial of Sea Service (MSN 1858). Use this record as the testimonial — the master attests it; the MCA assess it with your application.',
    lastReviewed: '2026-06-22'
  }
};

export const getVerifierProfiles = () => Object.values(VERIFIER_PROFILES).map(v => ({ ...v }));

// The onward MCA CoC-application bundle — what the crew sends to the MCA AFTER
// the testimonial is verified (distinct from the minimal verification docs
// above). Cert/STCW course certs are tracked per-route in the Courses & tickets
// checklist; NoE + oral live in the Certification journey. Listed here so the
// dossier can name the full picture without re-collecting it (MSF 4343 §4A /
// MSN 1858 / GOV.UK "apply for a UK CoC"). HIGH on the set; exact per-route
// applicability is shown by the cert's own ancillary list.
export const MCA_APPLICATION_DOCS = [
  'the verified Sea Service Testimonial (+ your Service Record Book)',
  'your Notice of Eligibility (NoE)',
  'the oral-exam pass notification (valid 3 years)',
  'a valid ENG1 medical',
  'two passport-size photographs',
  'your STCW & ancillary course certificates (PST, FPFF, EFA, PSSR, AFF, PSCRB, medical, GMDSS, ECDIS, HELM, security)'
];

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
  // While-holding + officer gating for higher CoCs. `config.sinceISO` keeps only
  // service dated on/after the date the prerequisite CoC was held; `officerOnly`
  // keeps only officer-capacity service. Both are off by default, so entry certs
  // and existing callers are unaffected (MSN 1858 §3.4-3.6/§4; MSN 1904 §5.9.2).
  let live = entries.filter(e => !e.excluded);
  if (config.sinceISO) live = live.filter(e => e.from && e.from >= config.sinceISO);
  if (config.officerOnly) live = live.filter(e => isOfficerCapacity(e.capacity));
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
  // Larger-vessel onboard service, for the MSN 1858 §3.6 "12mo ≥24m OR 6mo ≥500GT"
  // sub-gate. Onboard = signed-on time, so count all non-excluded days by the
  // vessel's recorded size. Days on a vessel with no GT/length on record can't be
  // size-classified → sizeUnknownDays (surfaced so we never silently undercount).
  let metres24Days = 0, gt500Days = 0, sizeUnknownDays = 0;
  for (const e of live) {
    const v = vessels[e.vesselId];
    if (!v || v.lengthM == null || v.gt == null) { sizeUnknownDays += e.days; continue; }
    if (v.lengthM >= 24) metres24Days += e.days;
    if (v.gt >= 500) gt500Days += e.days;
  }
  // Dual deck+engine capacity: every qualifying day counts at 50% toward each CoC
  // (MSN 1858 §5.1). config.dualRate (default 1) scales all day outputs so the
  // same buckets feed both the deck and engine pathways at half credit.
  const rate = config.dualRate ?? 1;
  const s = (n) => (rate === 1 ? n : Math.round(n * rate));
  return {
    seagoing: s(seagoing), watchkeeping: s(watchkeeping), standby: s(standby), standbyRaw: s(standbyRaw),
    yard: s(yard), yardRaw: s(yardRaw), actualSeagoing: s(actualSeagoing), onboardDays: s(onboardDays),
    metres24Days: s(metres24Days), gt500Days: s(gt500Days), sizeUnknownDays: s(sizeUnknownDays),
    total: s(seagoing + watchkeeping + standby + yard), dualRate: rate
  };
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

export const buildRequirementBars = (buckets, prior = {}, cert, recentDays = null, guestOnDays = 0) => {
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
  // onboardDays = an explicit day threshold (used where months DON'T convert at the
  // MCA 30-day rule — e.g. the IAMI purser route counts calendar months, so its
  // 24 months = 730 days, not 720). onboardMonths uses the MSN 30-day equivalence.
  if (r.onboardDays) add('onboard', cert?.family === 'INTERIOR' ? 'Senior onboard yacht service' : 'Onboard yacht service', cur.onboard, r.onboardDays);
  if (r.onboardMonths) add('onboard', cert?.family === 'INTERIOR' ? 'Senior onboard yacht service' : 'Onboard yacht service', cur.onboard, r.onboardMonths * md);
  // Guest-on days — the IAMI GUEST Yacht Purser Route A pairs the 12-month senior
  // service requirement with ≥60 days where guests were aboard. Both gate, so the
  // bar carries `routeA` for the UI to label it as the service-route condition.
  // (Route B — 3 years maritime management — is logged as prior service instead.)
  if (r.guestOnDays) add('guestOn', 'Guest-on days', guestOnDays, r.guestOnDays, { routeA: true });
  if (r.seagoingDays) add('seagoing', `Seagoing service${r.minVesselMetres ? ` (≥${r.minVesselMetres}m)` : ''}`, cur.seagoing, r.seagoingDays);
  // MSN 1858 §3.3 OOW split: 365 = 250 seagoing-only + 115 days that may be any
  // combination of seagoing/standby/yard. Modelling both bars stops all-standby
  // service from falsely qualifying — the 250 seagoing-only bar must be met too.
  // The combined bar counts seagoing *beyond* the 250 plus standby + (capped) yard.
  if (r.combinedTopUpDays) {
    const seaOverflow = Math.max(0, cur.seagoing - (r.seagoingDays || 0));
    const combined = seaOverflow + (prior.standby || 0) + (buckets.standby || 0) + (prior.yard || 0) + (buckets.yard || 0);
    add('combined', 'Combined top-up (seagoing/standby/yard)', combined, r.combinedTopUpDays);
  }
  if (r.seagoingMonths) add('seagoing', 'Seagoing service', cur.seagoing, r.seagoingMonths * md);
  if (r.watchkeepingDays) add('watchkeeping', 'Watchkeeping service', cur.watchkeeping, r.watchkeepingDays);
  if (r.actualSeaServiceMonths) add('actualSea', 'Actual sea service', cur.actualSea, r.actualSeaServiceMonths * md);
  // MSN 1858 §3.6 OR-branch: within the onboard service, either N months on
  // vessels ≥Xm OR M months on vessels ≥YGT. Met if EITHER route is satisfied;
  // the bar tracks whichever route the crew is closer to completing.
  if (r.higherTonnage) {
    const ht = r.higherTonnage;
    const m24 = buckets.metres24Days || 0;
    const g500 = buckets.gt500Days || 0;
    const metresTarget = ht.metresMonths * md, gtTarget = ht.gtMonths * md;
    const metresMet = m24 >= metresTarget, gtMet = g500 >= gtTarget;
    const met = metresMet || gtMet;
    const useGt = met ? gtMet : (gtTarget ? g500 / gtTarget : 0) >= (metresTarget ? m24 / metresTarget : 0);
    const current = useGt ? g500 : m24, required = useGt ? gtTarget : metresTarget;
    bars.push({
      key: 'higherTonnage',
      label: `Larger-vessel service (${ht.metresMonths}mo ≥${ht.metresMin}m or ${ht.gtMonths}mo ≥${ht.gtMin}GT)`,
      current, required, met, remaining: met ? 0 : Math.max(0, required - current),
      pct: required ? Math.min(100, Math.round((current / required) * 100)) : 100,
      provisional, orBranch: true,
      detail: { metres24: m24, metresTarget, gt500: g500, gtTarget, sizeUnknownDays: buckets.sizeUnknownDays || 0 }
    });
  }
  // Recency — the MCA needs ≥6 months qualifying seagoing service within the last
  // 5 years at NoE/CoC issue (MSN 1856 §17.2/§19.1). Its application point varies
  // by route (entry CoC vs revalidation), so it's shown as advisory guidance, not
  // a hard gate that blocks the eligibility flag.
  // Recency is an MCA STCW rule — it doesn't apply to the IAMI GUEST Yacht Purser
  // route, so it's omitted for the INTERIOR family.
  if (recentDays != null && cert?.family !== 'INTERIOR') add('recency', 'Recent service · 6mo in last 5yr', recentDays, 6 * md, { advisory: true });
  if (!bars.length) bars.push({ key: 'none', label: 'No additional qualifying service required', current: 0, required: 0, met: true, remaining: 0, pct: 100 });
  return bars;
};

// The qualifying-vessel gate for a target certificate. Each yacht route gates
// service differently — deck on registered length (or GT for the unlimited
// rungs), engine on propulsion power — so the validation must read the gate off
// the cert rather than hard-code "≥15m". Returns null when the route sets none.
const vesselGateFor = (cert) => {
  const r = cert?.requires || {};
  if (r.minVesselMetres) return { kind: 'metres', min: r.minVesselMetres, unit: 'm',  label: `Vessel size gate (≥${r.minVesselMetres}m)` };
  if (r.minGT)           return { kind: 'gt',     min: r.minGT,           unit: 'GT', label: `Vessel tonnage gate (≥${r.minGT}GT)` };
  if (r.minPowerKW)      return { kind: 'kw',     min: r.minPowerKW,      unit: 'kW', label: `Propulsion power (≥${r.minPowerKW}kW)` };
  return null;
};

// ── Validation gate — generation BLOCKED unless every rule passes ───────────
/**
 * Pathway-aware validation of the exported sea-service record. This step is the
 * captain attesting the *logged service is true* — so every check is a rule that
 * could actually fail against the record, and only the rules RELEVANT to the
 * target route appear (the ≥15m gate for metre-gated deck CoCs, GT for the
 * unlimited rungs, propulsion power for engine routes; watchkeeping/standby
 * checks only when that service is logged or the route counts it). Pass `cert`
 * (from CERTIFICATES) to validate against the real route; omit it for the
 * generic ≥15m deck default. No pathway-progress here — that lives upstream.
 * @param {Object} p
 * @param {Array}  p.entries
 * @param {Object} p.vessels
 * @param {Object} p.config
 * @param {'master'|'self'} p.signatory
 * @param {string} p.verifier   verifier id
 * @param {Object} p.docMet     map docId -> boolean
 * @param {Object} [p.cert]     target certificate (CERTIFICATES[id])
 * @param {Object} [p.buckets]  precomputed buckets (recomputed if absent)
 * @returns {{ checks:Array, canGenerate:boolean, passed:number, total:number, readinessPct:number }}
 */
export const runChecks = ({ entries, vessels, config = DEFAULT_CONFIG, signatory, verifier, docMet = {}, cert = null, buckets = null }) => {
  const live = entries.filter(e => !e.excluded);
  const checks = [];
  const b = buckets || computeBuckets(entries, vessels, config);
  const req = cert?.requires || {};
  const family = cert?.family || 'DECK';
  const engineering = family === 'ENGINE' || family === 'ETO'; // engine-room domain
  // Interior (Yacht Purser, IAMI GUEST) service isn't assessed on watchkeeping,
  // vessel size/GT or standby — those are deck/engine STCW concepts. A purser's
  // record is verified on senior onboard service + an endorser + ID/service docs,
  // so the deck-specific checks are skipped for the INTERIOR family.
  const interior = family === 'INTERIOR';
  // The testimonial endorser by department: deck = the master; engine/ETO = the
  // chief engineer (or master) (MSN 1904 §5.5); purser = the captain or manager.
  const endorserWord = interior ? 'captain / manager' : engineering ? 'chief engineer / master' : 'master';
  // Standby day-limit reference notice, by route.
  const standbyRef = family === 'ENGINE' ? 'MSN 1904 §5' : family === 'ETO' ? 'MSN 1860 §6' : 'MSN 1858 §5.2';

  // 1) Watchkeeping 4-hour rule — only relevant when the route counts
  //    watchkeeping or the log actually holds watchkeeping days. A day tagged
  //    watchkeeping must record ≥4h watch (MSN 1858/1904 §5).
  const watchEntries = live.filter(e => e.type === 'watchkeeping');
  if (!interior && (watchEntries.length || req.watchkeepingDays)) {
    const watchWord = engineering ? 'engine-room watch' : 'bridge watch';
    const badWatch = watchEntries.filter(e => Number(e.watchHours) < config.watchMinHours);
    checks.push(badWatch.length
      ? { ok: false, label: 'Watchkeeping 4-hour rule', detail: `${badWatch.length} entry tagged watchkeeping with under ${config.watchMinHours}h watch — re-tag or correct before generating.` }
      : { ok: true, label: 'Watchkeeping 4-hour rule', detail: `Every watchkeeping day records ≥${config.watchMinHours}h ${watchWord}.` });
  }

  // 2) Qualifying-vessel gate — read off the TARGET certificate, not a flat
  //    ≥15m. Deck routes gate seagoing/watchkeeping on registered length (or GT
  //    for the unlimited rungs); engine routes gate on propulsion power, which
  //    Cargo doesn't hold per vessel, so the master attests it on the
  //    testimonial. With no cert we keep the legacy ≥15m default. A route may
  //    set no vessel gate at all (e.g. Chief Mate concurrent with OOW) — then
  //    no gate check appears.
  const gate = vesselGateFor(cert);
  if (!cert) {
    const badSize = live.filter(e => e.type === 'seagoing' && !vessels[e.vesselId]?.over15);
    checks.push(badSize.length
      ? { ok: false, label: `Vessel size gate (≥${config.minLengthM}m)`, detail: `Seagoing service claimed on a vessel under ${config.minLengthM}m — exclude it or change the pathway.` }
      : { ok: true, label: `Vessel size gate (≥${config.minLengthM}m)`, detail: `All qualifying seagoing service is on vessels ≥${config.minLengthM}m.` });
  } else if (gate && (gate.kind === 'metres' || gate.kind === 'gt')) {
    const qualifying = live.filter(e => e.type === 'seagoing' || e.type === 'watchkeeping');
    const bad = qualifying.filter(e => {
      const v = vessels[e.vesselId];
      if (!v) return false; // missing record caught by check 4
      if (gate.kind === 'metres') return gate.min === 15 ? !v.over15 : (v.lengthM != null && v.lengthM < gate.min);
      return v.gt != null && v.gt < gate.min; // gt
    });
    const badDays = bad.reduce((s, e) => s + (e.days || 0), 0);
    checks.push(bad.length
      ? { ok: false, label: gate.label, detail: `${badDays} day(s) of qualifying service are on a vessel under ${gate.min}${gate.unit} — ${cert.short} can't count them. Exclude the period or change the goal.` }
      : { ok: true, label: gate.label, detail: `All qualifying service for ${cert.short} is on vessels ≥${gate.min}${gate.unit}.` });
  } else if (gate && gate.kind === 'kw') {
    // Propulsion power isn't held per vessel in Cargo — the signing master
    // confirms it on the testimonial, so this is an attested check, not a fail.
    checks.push({ ok: true, label: gate.label, detail: `${cert.short} requires ≥${gate.min}kW propulsion — the master confirms this on the signed testimonial.` });
  }

  // 3) Standby within limit — only relevant when standby is actually logged;
  //    standby may not exceed actual seagoing service.
  if (!interior && live.some(e => e.type === 'standby')) {
    const stbyRef = standbyRef;
    checks.push(b.standbyRaw > b.actualSeagoing
      ? { ok: false, label: 'Standby within limit', detail: `Standby (${b.standbyRaw}d) exceeds actual seagoing service (${b.actualSeagoing}d). The MCA caps standby at your seagoing total (${stbyRef}) — exclude the excess.` }
      : { ok: true, label: 'Standby within limit', detail: `${b.standbyRaw}d standby ≤ ${b.actualSeagoing}d actual seagoing — within limit (${stbyRef}).` });
  }

  // 4) Vessel records complete (GT + registered length) — these print on the MCA
  //    testimonial and drive the tonnage/size gates, neither of which apply to a
  //    purser, so the check is skipped for the INTERIOR family.
  if (!interior) {
    const usedVessels = [...new Set(live.map(e => e.vesselId))].map(id => vessels[id]);
    const incompleteVessel = usedVessels.find(v => !v || v.gt == null || v.lengthM == null);
    checks.push(incompleteVessel
      ? { ok: false, label: 'Vessel records complete', detail: `Vessel "${incompleteVessel?.name || 'unknown'}" is missing GT or registered length.` }
      : { ok: true, label: 'Vessel records complete', detail: 'GT and registered length present for every vessel.' });
  }

  // 5) Endorser on record — every Cargo-tracked period must carry the person who
  //    can attest it on the exported form (endorserWord, by department above).
  const cargoTracked = (entries || []).filter(e => e.source === 'vessel' && !e.excluded);
  const noMasterDays = cargoTracked.filter(e => !e.masterUserId && !e.masterName).reduce((s, e) => s + (e.days || 0), 0);
  checks.push(noMasterDays > 0
    ? { ok: false, label: `Endorsing ${endorserWord} on record`, detail: `${noMasterDays} day(s) of Cargo-tracked service have no ${endorserWord} on record to endorse them.` }
    : { ok: true, label: `Endorsing ${endorserWord} on record`, detail: `Every Cargo-tracked period has an identified ${endorserWord} to endorse it on the exported form.` });

  // 6) Supporting documents for the selected verifier (optional ones don't gate).
  // Supporting docs for the testimonial verification — optional ones don't gate.
  const docs = VERIFIER_PROFILES[verifier]?.docs || [];
  const missing = docs.filter(d => !d.optional && !docMet[d.id]);
  checks.push(missing.length
    ? { ok: false, label: 'Supporting documents', detail: `${missing.length} required document(s) outstanding for ${VERIFIER_PROFILES[verifier]?.short}.` }
    : { ok: true, label: 'Supporting documents', detail: `All ${VERIFIER_PROFILES[verifier]?.short} supporting documents attached.` });

  const passed = checks.filter(c => c.ok).length;
  return { checks, canGenerate: checks.every(c => c.ok), passed, total: checks.length, readinessPct: checks.length ? Math.round((passed / checks.length) * 100) : 100 };
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
