// Rules-engine tests for the ported Sea Time Tracker. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG, PATHWAYS, classify, computeBuckets, computeRequirements,
  runChecks, computeAssurance, buildTestimonialDataset, getVerifierProfiles,
  buildRequirementBars, recentQualifyingDays
} from './engine.js';
import { CERTIFICATES, ROLES, eligibleCertificates, SERVICE_RULES, yardCapForCertificate } from './pathways.js';
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
  assert.equal(yardCapForCertificate('Y4'), SERVICE_RULES.yardCapDays);
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
  const bars = buildRequirementBars({ seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0 }, {}, CERTIFICATES.ETO_COC);
  assert.ok(bars.length > 0);
  assert.ok(bars.every(b => b.provisional === true));
});

test('the engine ladder is flagged superseded (MSN 1859 withdrawn → MSN 1904)', () => {
  for (const id of ['MEOL_Y', 'Y4', 'Y3', 'Y2', 'Y1']) {
    const cert = CERTIFICATES[id];
    assert.equal(cert.verified, 'SUPERSEDED', `${id} must not present withdrawn figures as HIGH`);
    assert.equal(cert.supersededBy, 'MSN 1904');
    // Non-HIGH → provisional bars → never declares eligibility off withdrawn figures.
    const bars = buildRequirementBars({ seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0 }, {}, cert);
    assert.ok(bars.every(b => b.provisional === true));
  }
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

  // OOW <3000GT: 36 months onboard + 365 seagoing days (no watchkeeping bar).
  const oow = buildRequirementBars(b, SEED_PRIOR, CERTIFICATES.OOW_YACHT_3000);
  assert.deepEqual(oow.map(x => x.key).sort(), ['onboard', 'seagoing']);
  assert.equal(oow.find(x => x.key === 'onboard').required, 36 * md);
  assert.equal(oow.find(x => x.key === 'seagoing').required, 365);
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

test('engine certificates use kW gates (MSN 1859)', () => {
  assert.equal(CERTIFICATES.Y4.requires.minPowerKW, 350);
  assert.equal(CERTIFICATES.Y1.requires.minPowerKW, 1500);
  assert.equal(CERTIFICATES.MEOL_Y.requires.minPowerKW, 200);
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
