// Rules-engine tests for the ported Sea Time Tracker. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG, PATHWAYS, classify, computeBuckets, computeRequirements,
  runChecks, computeAssurance, buildTestimonialDataset, getVerifierProfiles,
  buildRequirementBars, recentQualifyingDays, MCA_APPLICATION_DOCS
} from './engine.js';
import { CERTIFICATES, ROLES, eligibleCertificates, SERVICE_RULES, yardCapForCertificate, LEGACY_GRADE_CONVERSION, CONVERSION_RECENCY, legacyConversionForGrade, ancillaryFor, isOfficerCapacity, resolveEntry } from './pathways.js';
import { SEED_VESSELS, SEED_ENTRIES, SEED_PRIOR, SEED_SEAFARER } from './seed.js';

const V = SEED_VESSELS;

// --- classify: encodes the regulations, per the handoff seed expectations ---
test('classify matches the seeded qualification outcomes', () => {
  // watchkeeping 8h on a 68m vessel -> qualifies
  assert.equal(classify({ type: 'watchkeeping', watchHours: 8, vesselId: 'v3' }, V.v3).qual, true);
  // seagoing on a 12m vessel -> non-qualifying (under 15m)
  const sub = classify({ type: 'seagoing', watchHours: 0, vesselId: 'v2' }, V.v2);
  assert.equal(sub.qual, false);
  assert.match(sub.reason, /under 15m/);
  // watchkeeping 3h -> non-qualifying (under 4h rule)
  const lowWatch = classify({ type: 'watchkeeping', watchHours: 3, vesselId: 'v1' }, V.v1);
  assert.equal(lowWatch.qual, false);
  assert.match(lowWatch.reason, /4h rule/);
  // standby + yard always count
  assert.equal(classify({ type: 'standby', vesselId: 'v1' }, V.v1).qual, true);
  assert.equal(classify({ type: 'yard', vesselId: 'v1' }, V.v1).qual, true);
});

// --- buckets: four service types totalled SEPARATELY, standby capped ---------
test('computeBuckets totals each type separately and caps standby', () => {
  const b = computeBuckets(SEED_ENTRIES, V, DEFAULT_CONFIG);
  // qualifying seagoing = 14 (Atlantic crossing); the 5d on v2 is excluded by rule
  assert.equal(b.seagoing, 14);
  // qualifying watchkeeping = 24 + 7 = 31 (the 3h day doesn't count)
  assert.equal(b.watchkeeping, 31);
  assert.equal(b.standby, 8);
  assert.equal(b.yard, 8);
  assert.equal(b.total, 14 + 31 + 8 + 8);
});

// --- while-holding + officer-capacity gating for higher CoCs -----------------
test('isOfficerCapacity excludes clear ratings, keeps officers and unknowns', () => {
  assert.equal(isOfficerCapacity('Chief Officer'), true);
  assert.equal(isOfficerCapacity('Master'), true);
  assert.equal(isOfficerCapacity('Second Engineer'), true);
  assert.equal(isOfficerCapacity('Lead Deckhand'), false);
  assert.equal(isOfficerCapacity('Bosun'), false);
  assert.equal(isOfficerCapacity('Motorman'), false);
  assert.equal(isOfficerCapacity('Cadet'), false);
  assert.equal(isOfficerCapacity(''), true); // unknown — never silently dropped
});

test('computeBuckets gates by officer capacity and while-holding date', () => {
  const V2 = { v: { id: 'v', gt: 600, lengthM: 30, over15: true } };
  const ents = [
    { id: 'a', vesselId: 'v', type: 'seagoing', days: 20, capacity: 'Chief Officer', from: '2026-03-01' },
    { id: 'b', vesselId: 'v', type: 'seagoing', days: 30, capacity: 'Lead Deckhand', from: '2026-03-01' }, // rating → dropped when officerOnly
    { id: 'c', vesselId: 'v', type: 'seagoing', days: 10, capacity: 'Chief Officer', from: '2026-01-01' },  // before sinceISO → dropped
  ];
  assert.equal(computeBuckets(ents, V2, DEFAULT_CONFIG).seagoing, 60);                                   // ungated counts all
  assert.equal(computeBuckets(ents, V2, { ...DEFAULT_CONFIG, officerOnly: true }).seagoing, 30);          // drops the deckhand
  assert.equal(computeBuckets(ents, V2, { ...DEFAULT_CONFIG, officerOnly: true, sinceISO: '2026-02-01' }).seagoing, 20); // drops deckhand + pre-date
});

test('higher CoCs gate on a held prerequisite; entry certs do not', () => {
  assert.equal(CERTIFICATES.MASTER_YACHT_3000.heldWhilstCert, 'OOW_YACHT_3000');
  assert.equal(CERTIFICATES.MASTER_YACHT_3000.asOfficer, true);
  assert.equal(CERTIFICATES.MASTER_YACHT_500.heldWhilstCert, 'OOW_YACHT_3000');
  assert.equal(CERTIFICATES.CHIEF_SV_500_Y.heldWhilstCert, 'EOOW_SV_Y');
  assert.equal(CERTIFICATES.CHIEF_SV_3000_Y.heldWhilstCert, 'EOOW_SV_Y');
  // OOW, MEOL and EOOW are ENTRY certs — no while-holding prerequisite.
  assert.equal(CERTIFICATES.OOW_YACHT_3000.asOfficer, undefined);
  assert.equal(CERTIFICATES.MEOL_Y.heldWhilstCert, undefined);
  assert.equal(CERTIFICATES.EOOW_SV_Y.heldWhilstCert, undefined); // was wrongly set to MEOL — corrected
  assert.equal(CERTIFICATES.EOOW_SV_Y.asOfficer, undefined);
});

test('standby may not exceed actual seagoing service (MSN 1858 §5.2)', () => {
  // 200 standby days but no seagoing => 0 counted standby.
  let b = computeBuckets([{ id: 's', vesselId: 'v1', type: 'standby', days: 200, watchHours: 0 }], V, DEFAULT_CONFIG);
  assert.equal(b.standbyRaw, 200);
  assert.equal(b.standby, 0);
  // With 30 seagoing days, standby counts up to 30.
  b = computeBuckets([
    { id: 'a', vesselId: 'v3', type: 'seagoing', days: 30, watchHours: 0 },
    { id: 's', vesselId: 'v1', type: 'standby', days: 200, watchHours: 0 }
  ], V, DEFAULT_CONFIG);
  assert.equal(b.standby, 30);
});

test('yard service is capped at 90 days (OOW baseline)', () => {
  const b = computeBuckets([{ id: 'y', vesselId: 'v1', type: 'yard', days: 150, watchHours: 0 }], V, DEFAULT_CONFIG);
  assert.equal(b.yardRaw, 150);
  assert.equal(b.yard, 90);
});

test('yard cap is per certificate: 90 for OOW, 30 for Master/Chief Mate (MSN 1858)', () => {
  assert.equal(yardCapForCertificate('OOW_YACHT_3000'), 90);
  assert.equal(yardCapForCertificate('MASTER_YACHT_3000'), 30);
  assert.equal(yardCapForCertificate('MASTER_YACHT_500'), 30);
  assert.equal(yardCapForCertificate('CHIEF_MATE_YACHT_3000'), 30);
  assert.equal(yardCapForCertificate('CHIEF_MATE_UNLIMITED'), 30);
  // engine cert / unknown -> 90-day baseline (SERVICE_RULES.yardCapDays)
  assert.equal(yardCapForCertificate('CHIEF_SV_3000_Y'), SERVICE_RULES.yardCapDays);
  assert.equal(yardCapForCertificate('nope'), 90);
});

test('computeBuckets honours a Master 30-day yard cap', () => {
  const cfg = { ...DEFAULT_CONFIG, yardCapDays: yardCapForCertificate('MASTER_YACHT_3000') };
  const b = computeBuckets([{ id: 'y', vesselId: 'v1', type: 'yard', days: 150, watchHours: 0 }], V, cfg);
  assert.equal(b.yardRaw, 150);
  assert.equal(b.yard, 30);
});

// --- requirement bars: prior + current vs pathway ----------------------------
test('computeRequirements adds prior accrual and flags met/remaining', () => {
  const b = computeBuckets(SEED_ENTRIES, V, DEFAULT_CONFIG);
  const reqs = computeRequirements(b, SEED_PRIOR, PATHWAYS.oow3000);
  const total = reqs.find(r => r.key === 'total');
  assert.equal(total.current, SEED_PRIOR.total + b.total); // 590 + 61 = 651
  assert.equal(total.required, 730);
  assert.equal(total.remaining, 79);
  assert.equal(total.met, false);
});

// --- recency: 6 months qualifying seagoing service in the last 5 years --------
test('recency counts only qualifying seagoing days within the last 5 years', () => {
  const asOf = new Date('2026-06-26T00:00:00Z');
  const entries = [
    { type: 'seagoing', from: '2026-01-01', to: '2026-01-30', days: 30 },     // recent: 30
    { type: 'watchkeeping', from: '2025-06-01', to: '2025-06-10', days: 10 }, // recent: 10
    { type: 'seagoing', from: '2019-01-01', to: '2019-01-31', days: 31 },     // >5y ago: 0
    { type: 'standby', from: '2026-02-01', to: '2026-02-10', days: 10 },      // not qualifying: 0
  ];
  assert.equal(recentQualifyingDays(entries, asOf), 40);
  // The bar shows it against the 6-month (180-day) target.
  const bars = buildRequirementBars({ seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0 }, {}, CERTIFICATES[0], 40);
  assert.ok(bars.some(b => b.key === 'recency' && b.required === 180 && b.current === 40 && !b.met));
});

// --- safety: never present an unverified threshold as authoritative ----------
test('recency bar is advisory, not a hard gate', () => {
  const bars = buildRequirementBars({ seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0 }, {}, CERTIFICATES.OOW_YACHT_3000, 40);
  const recency = bars.find(b => b.key === 'recency');
  assert.equal(recency.advisory, true);
  // HIGH-confidence cert → its hard bars are not flagged provisional.
  assert.ok(bars.filter(b => !b.advisory).every(b => !b.provisional));
});

test('a not-yet-verified route flags every bar provisional', () => {
  // Synthetic PENDING cert — tests the mechanism independent of which real cert
  // happens to be unverified (all shipped routes are now HIGH).
  const pending = { verified: 'PENDING', requires: { seagoingMonths: 6 } };
  const bars = buildRequirementBars({ seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0 }, {}, pending);
  assert.ok(bars.length > 0);
  assert.ok(bars.every(b => b.provisional === true));
});

test('the engine ladder is rebuilt against in-force MSN 1904 (not withdrawn 1859)', () => {
  for (const id of ['MEOL_Y', 'EOOW_SV_Y', 'CHIEF_SV_500_Y', 'CHIEF_SV_3000_Y']) {
    const cert = CERTIFICATES[id];
    assert.equal(cert.verified, 'HIGH', `${id} should be notice-verified`);
    assert.match(cert.msn, /MSN 1904/, `${id} must cite the in-force notice`);
    // No withdrawn-notice citations remain on the engine family.
    assert.doesNotMatch(cert.msn, /1859/);
  }
});

test('ETO is verified against in-force MSN 1860 with the corrected 6-month figure', () => {
  const eto = CERTIFICATES.ETO_COC;
  assert.equal(eto.verified, 'HIGH');
  assert.match(eto.msn, /MSN 1860/);
  assert.equal(eto.requires.seagoingMonths, 6); // was wrongly 12
});

test('legacy Y-grade conversions: codes + month-counts binding (MIN 642 current)', () => {
  for (const [key, c] of Object.entries(LEGACY_GRADE_CONVERSION)) {
    // MIN 642 is current and in use (MCA, Jun 2026) — it is the binding source
    // for the conversion codes AND the §7.3 service month-counts, so both are HIGH.
    assert.equal(c.codeVerified, 'HIGH', `${key} code should be in-force corroborated`);
    assert.equal(c.verified, 'HIGH');
    assert.ok(c.to.every(id => CERTIFICATES[id]), `${key} targets must be real certs`);
  }
  // Route C is the Y3 route; Y4-only holders must use a Route A line instead.
  assert.match(LEGACY_GRADE_CONVERSION.Y3.code, /C/);
  assert.match(LEGACY_GRADE_CONVERSION.Y4.code, /A/);
  // Route C accepts seagoing service in a Y3 or Y4 capacity (MCA clarification).
  assert.match(LEGACY_GRADE_CONVERSION.Y3.seagoingCapacity, /Y3 OR Y4/);
  // The universal in-force recency gate is carried.
  assert.equal(CONVERSION_RECENCY.months, 6);
  assert.equal(CONVERSION_RECENCY.verified, 'HIGH');
  // A held legacy grade string resolves to its conversion.
  assert.equal(legacyConversionForGrade('Engineering — Y3').key, 'Y3');
  assert.equal(legacyConversionForGrade('OOW <3000GT'), null);
});

// --- validation gate ---------------------------------------------------------
test('seed data blocks generation until flagged entries are resolved', () => {
  const r = runChecks({ entries: SEED_ENTRIES, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, email: true, srb: true } });
  // The seed has a sub-15m seagoing entry + a 3h watchkeeping entry -> blocked.
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some(c => !c.ok && /size gate/.test(c.label)));
  assert.ok(r.checks.some(c => !c.ok && /4-hour/.test(c.label)));
});

test('a clean dataset with all docs + master signatory can generate', () => {
  const clean = [
    { id: 'a', vesselId: 'v3', type: 'watchkeeping', watchHours: 8, days: 24 },
    { id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14 }
  ];
  const r = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, email: true, srb: true } });
  assert.equal(r.canGenerate, true);
  assert.equal(r.passed, r.total);
});

// --- self-certification is impossible to produce (hard fail) ------------------
test('Cargo-tracked service with no master on record blocks generation', () => {
  // An auto-logged (source: vessel) day with no master can't be endorsed.
  const clean = [{ id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14, source: 'vessel' }];
  const r = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, srb: true } });
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some(c => !c.ok && /Endorsing master/.test(c.label)));
});

// --- missing required doc blocks; switching verifier re-derives docs ----------
test('missing required supporting doc blocks generation', () => {
  const clean = [{ id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14 }];
  const r = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'pya', docMet: { passport: false, email: true, srb: true } });
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some(c => !c.ok && /Supporting documents/.test(c.label)));
});

test('optional supporting docs do not gate; verifier-specific required docs do', () => {
  const clean = [{ id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14 }];
  // PYA: passport required, SRB optional — passport alone clears the doc gate.
  const pya = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'pya', docMet: { passport: true } });
  assert.equal(pya.canGenerate, true);
  // Transport Malta also requires photos + medical + signatory — passport alone blocks.
  const tm = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'transport_malta', docMet: { passport: true } });
  assert.equal(tm.canGenerate, false);
  assert.ok(tm.checks.some(c => !c.ok && /Supporting documents/.test(c.label)));
  // The onward MCA-application bundle is named separately (not a verification doc).
  assert.ok(MCA_APPLICATION_DOCS.length >= 5);
  assert.ok(MCA_APPLICATION_DOCS.some(d => /ENG1/.test(d)) && MCA_APPLICATION_DOCS.some(d => /oral/i.test(d)));
});

test('Transport Malta testimonial verification: ID + CVC + signatory only', () => {
  const clean = [{ id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14 }];
  // Verification needs only what supports the testimonial — passport, the CVC and
  // the signatory; no CoC / photos / medical (those are CoC-application docs).
  const r = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'transport_malta', docMet: { passport: true, cvc: true, sig: true } });
  assert.equal(r.canGenerate, true);
  const ids = getVerifierProfiles().find(v => v.id === 'transport_malta').docs.map(d => d.id);
  assert.ok(!ids.includes('coc') && !ids.includes('photos') && !ids.includes('medical'));
  assert.ok(ids.includes('cvc') && ids.includes('sig'));
});

// --- validation checks are pathway-relevant, and only what's in the log ------
test('cert-aware gate names the route threshold; accrual never blocks attestation', () => {
  // OOW <3000GT: metre-gated (≥15m). Clean service on the 68m v3.
  const clean = [
    { id: 'a', vesselId: 'v3', type: 'watchkeeping', watchHours: 8, days: 24 },
    { id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14 }
  ];
  const cert = CERTIFICATES.OOW_YACHT_3000;
  const r = runChecks({ entries: clean, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, srb: true }, cert });
  // Integrity passes → can attest even though the 365-day route is far from met.
  assert.equal(r.canGenerate, true);
  // The size gate names the route's own threshold, not a flat default.
  assert.ok(r.checks.some(c => c.ok && /Vessel size gate/.test(c.label)));
  // No pathway-progress bars in the attestation gate — that lives upstream.
  assert.equal(r.advisories, undefined);
});

test('a tonnage-gated route fails service on an under-GT vessel', () => {
  // Chief Mate Unlimited's OOW-Unlimited entry (§4.3 Path B) gates on ≥500GT;
  // v1 is 380GT. (The default Master-<3000 entry has no extra sea-time gate.)
  const cert = { ...CERTIFICATES.CHIEF_MATE_UNLIMITED, requires: CERTIFICATES.CHIEF_MATE_UNLIMITED.altEntries[0].requires };
  const entries = [{ id: 'a', vesselId: 'v1', type: 'seagoing', watchHours: 0, days: 30 }];
  const r = runChecks({ entries, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, srb: true }, cert });
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some(c => !c.ok && /tonnage gate/.test(c.label)));
});

test('an engine route attests the kW gate (master-confirmed), no hard size check', () => {
  const cert = CERTIFICATES.EOOW_SV_Y; // minPowerKW gate
  const entries = [{ id: 'a', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 30 }];
  const r = runChecks({ entries, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, srb: true }, cert });
  // No metre/tonnage gate for engine — power isn't held per vessel.
  assert.ok(!r.checks.some(c => /size gate|tonnage gate/.test(c.label)));
  // The power requirement appears as a master-attested (passing) check instead.
  assert.ok(r.checks.some(c => c.ok && /Propulsion power/.test(c.label) && /kW/.test(c.label)));
});

test('irrelevant checks are dropped — no standby/watchkeeping rows when none logged', () => {
  // A pure seagoing log on a qualifying deck route: no watchkeeping, no standby.
  const cert = CERTIFICATES.OOW_YACHT_3000;
  const entries = [{ id: 'a', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 30 }];
  const r = runChecks({ entries, vessels: V, signatory: 'master', verifier: 'pya',
    docMet: { passport: true, srb: true }, cert });
  assert.ok(!r.checks.some(c => /Standby within limit/.test(c.label)));
  assert.ok(!r.checks.some(c => /Watchkeeping 4-hour/.test(c.label)));
  // …but the route's vessel gate and the universal record checks remain.
  assert.ok(r.checks.some(c => /Vessel size gate/.test(c.label)));
  assert.ok(r.checks.some(c => /Vessel records complete/.test(c.label)));
});

// --- a new verifier is addable via config object ONLY ------------------------
test('verifier list is data; profiles all expose the same shape', () => {
  const ids = getVerifierProfiles().map(v => v.id);
  assert.deepEqual(ids, ['nautilus', 'pya', 'transport_malta', 'mca']);
  for (const v of getVerifierProfiles()) {
    assert.ok(Array.isArray(v.docs) && typeof v.instructions === 'string' && typeof v.fee === 'string');
  }
});

// --- assurance hash flips when any field changes -----------------------------
test('content hash changes if any totalled field changes', () => {
  const b = computeBuckets(SEED_ENTRIES, V, DEFAULT_CONFIG);
  const a1 = computeAssurance({ verifierShort: 'PYA', buckets: b, signatory: 'master' });
  const a2 = computeAssurance({ verifierShort: 'PYA', buckets: { ...b, seagoing: b.seagoing + 1, total: b.total + 1 }, signatory: 'master' });
  assert.notEqual(a1.contentHash, a2.contentHash);
  assert.match(a1.verificationRef, /^CARGO-STT-/);
});

// --- certificate thresholds (MSN 1858/1859) + per-cert bars ------------------
test('certificate requirement bars reflect each CoC (MSN 1858)', () => {
  const md = SERVICE_RULES.monthDays;
  const b = computeBuckets(SEED_ENTRIES, SEED_VESSELS, DEFAULT_CONFIG);

  // OOW <3000GT: 36 months onboard + the 250 seagoing-only / 115 combined split.
  const oow = buildRequirementBars(b, SEED_PRIOR, CERTIFICATES.OOW_YACHT_3000);
  assert.deepEqual(oow.map(x => x.key).sort(), ['combined', 'onboard', 'seagoing']);
  assert.equal(oow.find(x => x.key === 'onboard').required, 36 * md);
  assert.equal(oow.find(x => x.key === 'seagoing').required, 250);  // seagoing-only floor
  assert.equal(oow.find(x => x.key === 'combined').required, 115);  // combined top-up
  assert.ok(!oow.some(x => x.key === 'watchkeeping')); // OOW has no watchkeeping-day figure

  // Master <500GT: 12 months + 120 watchkeeping days.
  const m500 = buildRequirementBars(b, SEED_PRIOR, CERTIFICATES.MASTER_YACHT_500);
  assert.equal(m500.find(x => x.key === 'watchkeeping').required, 120);
  assert.equal(m500.find(x => x.key === 'onboard').required, 12 * md);

  // Master <3000GT: 240 watchkeeping days.
  const m3000 = buildRequirementBars(b, SEED_PRIOR, CERTIFICATES.MASTER_YACHT_3000);
  assert.equal(m3000.find(x => x.key === 'watchkeeping').required, 240);

  // Chief Mate <3000GT: no additional service.
  const cm = buildRequirementBars(b, SEED_PRIOR, CERTIFICATES.CHIEF_MATE_YACHT_3000);
  assert.equal(cm[0].key, 'none');
});

test('OOW 250/115 split: all-standby cannot satisfy the 250 seagoing-only floor', () => {
  // 400 standby days, zero seagoing: the combined top-up (115) is satisfied, but
  // the 250 seagoing-only bar is not — so the crew member is NOT yet qualified.
  const b = { seagoing: 0, watchkeeping: 0, standby: 400, yard: 0, total: 400, onboardDays: 1100 };
  const oow = buildRequirementBars(b, {}, CERTIFICATES.OOW_YACHT_3000);
  const seagoing = oow.find(x => x.key === 'seagoing');
  const combined = oow.find(x => x.key === 'combined');
  assert.equal(seagoing.met, false, 'standby cannot make up the 250 seagoing-only days');
  assert.equal(combined.met, true, 'standby counts toward the 115 combined top-up');
  // Seagoing beyond 250 spills into the combined bar (no double-count below 250).
  const b2 = { seagoing: 300, watchkeeping: 0, standby: 0, yard: 0, total: 300, onboardDays: 1100 };
  const oow2 = buildRequirementBars(b2, {}, CERTIFICATES.OOW_YACHT_3000);
  assert.equal(oow2.find(x => x.key === 'combined').current, 50); // 300 - 250 overflow
});

test('Master <3000GT §3.6 OR-branch computes from vessel GT/length', () => {
  const md = SERVICE_RULES.monthDays;
  const vsl = {
    big: { gt: 600, lengthM: 30 },   // ≥24m AND ≥500GT
    mid: { gt: 200, lengthM: 26 },   // ≥24m only
    sm:  { gt: 100, lengthM: 18 },   // neither
    nodim: { gt: null, lengthM: null } // size unknown
  };
  // 200 days on the 26m (length route) + 190 days on the 600GT/30m vessel.
  const entries = [
    { id: '1', vesselId: 'mid', type: 'seagoing', days: 200, watchHours: 8 },
    { id: '2', vesselId: 'big', type: 'seagoing', days: 190, watchHours: 8 },
    { id: '3', vesselId: 'nodim', type: 'seagoing', days: 40, watchHours: 8 }
  ];
  const b = computeBuckets(entries, vsl, DEFAULT_CONFIG);
  assert.equal(b.metres24Days, 390);          // 200 + 190 on ≥24m
  assert.equal(b.gt500Days, 190);             // only the 600GT vessel
  assert.equal(b.sizeUnknownDays, 40);        // the no-dimension vessel
  const bars = buildRequirementBars(b, {}, CERTIFICATES.MASTER_YACHT_3000);
  const ht = bars.find(x => x.key === 'higherTonnage');
  assert.ok(ht, 'higher-tonnage OR-branch bar present');
  assert.equal(ht.met, true);                 // 390 ≥ 12mo(360) on the length route
  assert.equal(ht.detail.metresTarget, 12 * md);
  assert.equal(ht.detail.gtTarget, 6 * md);
  assert.equal(ht.detail.sizeUnknownDays, 40);
});

test('Yacht Purser Route A gates on 365 senior days AND 60 guest-on days', () => {
  const purser = CERTIFICATES.PURSER_COC;
  assert.ok(purser, 'PURSER_COC certificate present');
  assert.equal(purser.family, 'INTERIOR');
  const b = { seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0, onboardDays: 400 };
  // 400 senior days but only 20 guest-on days → guest bar NOT met.
  const low = buildRequirementBars(b, {}, purser, null, 20);
  const onboardLow = low.find(x => x.key === 'onboard');
  const guestLow = low.find(x => x.key === 'guestOn');
  assert.ok(onboardLow && onboardLow.met, '400 ≥ 365 senior days met');
  assert.ok(guestLow, 'guest-on bar present for the purser route');
  assert.equal(guestLow.required, 60);
  assert.equal(guestLow.current, 20);
  assert.equal(guestLow.met, false, '20 guest-on days does not satisfy the 60-day floor');
  // 60 guest-on days → guest bar met.
  const ok = buildRequirementBars(b, {}, purser, null, 60);
  assert.equal(ok.find(x => x.key === 'guestOn').met, true);
  // Recency does NOT apply to the interior family — no recency bar even when days passed.
  assert.equal(low.find(x => x.key === 'recency'), undefined, 'recency omitted for INTERIOR');
});

test('dual deck+engine capacity scales every day-count to 50% (MSN 1858 §5.1)', () => {
  const vsl = { v: { gt: 600, lengthM: 30, over15: true } };
  const entries = [
    { id: '1', vesselId: 'v', type: 'seagoing', days: 100, watchHours: 8 },
    { id: '2', vesselId: 'v', type: 'watchkeeping', days: 40, watchHours: 8 }
  ];
  const full = computeBuckets(entries, vsl, DEFAULT_CONFIG);
  const dual = computeBuckets(entries, vsl, { ...DEFAULT_CONFIG, dualRate: 0.5 });
  assert.equal(full.seagoing, 100);
  assert.equal(dual.seagoing, 50);          // halved
  assert.equal(dual.watchkeeping, 20);      // halved
  assert.equal(dual.metres24Days, 70);      // (100+40)/2 onboard days on ≥24m
  assert.equal(dual.dualRate, 0.5);
});

test('ancillary course requirements are modelled with valid doc-type matchers', () => {
  // OOW carries EDH (with its 18-month timing note) + Yachtmaster + STCW set.
  const oow = ancillaryFor('OOW_YACHT_3000');
  assert.ok(oow.length > 0);
  const edh = oow.find(a => a.key === 'edh');
  assert.ok(edh && edh.anyOf.includes('edh'));
  assert.match(edh.note, /18 months/);
  assert.ok(oow.some(a => a.anyOf.includes('yachtmaster')));
  // Deck officer certs carry ECDIS; ETO carries its electro-technical tickets.
  assert.ok(ancillaryFor('MASTER_YACHT_3000').some(a => a.anyOf.includes('ecdis')));
  assert.ok(ancillaryFor('ETO_COC').some(a => a.anyOf.includes('enem')));
  // Every modelled CoC across all families has a non-empty, valid checklist.
  for (const id of ['MASTER_CODE_200_COASTAL', 'OOW_YACHT_3000', 'MASTER_YACHT_3000', 'CHIEF_MATE_UNLIMITED', 'MEOL_Y', 'EOOW_SV_Y', 'CHIEF_SV_3000_Y', 'ETO_COC']) {
    const items = ancillaryFor(id);
    assert.ok(items.length > 0, `${id} should have a course checklist`);
    for (const a of items) assert.ok(Array.isArray(a.anyOf) && a.anyOf.length > 0, `${id}/${a.key}`);
  }
  assert.deepEqual(ancillaryFor('NOPE'), []);
});

test('small-vessel command entry routes exist and are notice-verified', () => {
  for (const id of ['MASTER_CODE_200_COASTAL', 'MASTER_CODE_200_UNLIMITED']) {
    const c = CERTIFICATES[id];
    assert.equal(c.family, 'DECK');
    assert.equal(c.verified, 'HIGH');
    assert.match(c.msn, /MSN 1858/);
    assert.equal(c.requires.seagoingMonths, 6);
  }
});

test('engine certificates use kW gates (MSN 1904 Small Vessel)', () => {
  assert.equal(CERTIFICATES.EOOW_SV_Y.requires.minPowerKW, 350);
  assert.equal(CERTIFICATES.CHIEF_SV_3000_Y.requires.minPowerKW, 350);
  assert.equal(CERTIFICATES.MEOL_Y.requires.minPowerKW, 200);
});

test('Chief Mate Unlimited resolves the entry route (§4.3): Master <3000 = no extra sea time, OOW Unlimited = 12/6/500', () => {
  const cmu = CERTIFICATES.CHIEF_MATE_UNLIMITED;
  // Path A — holds Master <3000 (the primary entry): no additional sea service.
  const a = resolveEntry(cmu, { MASTER_YACHT_3000: { issueDate: '2025-01-01' } });
  assert.deepEqual(a.requires, {});
  assert.equal(a.asOfficer, false);
  // Path B — holds OOW Unlimited but NOT Master <3000: the §4.3 service applies.
  const b = resolveEntry(cmu, { OOW_UNLIMITED: { issueDate: '2025-01-01' } });
  assert.equal(b.requires.onboardMonths, 12);
  assert.equal(b.requires.seagoingMonths, 6);
  assert.equal(b.requires.minGT, 500);
  assert.equal(b.asOfficer, true);
  assert.equal(b.heldWhilstCert, 'OOW_UNLIMITED');
  // Neither held → default to the primary (no extra sea time), not the alt.
  assert.deepEqual(resolveEntry(cmu, {}).requires, {});
  // Master <3000 wins even if OOW Unlimited is also held (on the primary path).
  assert.deepEqual(resolveEntry(cmu, { MASTER_YACHT_3000: {}, OOW_UNLIMITED: {} }).requires, {});
  // A plain cert with no altEntries is unchanged.
  assert.deepEqual(resolveEntry(CERTIFICATES.OOW_YACHT_3000, {}).requires, CERTIFICATES.OOW_YACHT_3000.requires);
});

test('roles map to eligible certificate families', () => {
  assert.ok(eligibleCertificates('master').every(c => c.family === 'DECK'));
  assert.ok(eligibleCertificates('chief_engineer').every(c => c.family === 'ENGINE'));
  assert.equal(eligibleCertificates('stewardess').length, 0); // interior accrues nothing
});

// --- testimonial dataset: four totals kept separate --------------------------
test('buildTestimonialDataset keeps the four totals separate', () => {
  const ds = buildTestimonialDataset({ seafarer: SEED_SEAFARER, entries: SEED_ENTRIES, vessels: V, signatory: 'master', verifier: 'pya' });
  assert.deepEqual(Object.keys(ds.service.totals).sort(), ['seagoing', 'standby', 'watchkeeping', 'yard']);
  assert.ok(ds.assurance.contentHash && ds.assurance.qrPayload.startsWith('sha256:'));
});
