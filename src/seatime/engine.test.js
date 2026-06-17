// Rules-engine tests for the ported Sea Time Tracker. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG, PATHWAYS, classify, computeBuckets, computeRequirements,
  runChecks, computeAssurance, buildTestimonialDataset, getVerifierProfiles
} from './engine.js';
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

test('standby is capped at config.standbyCapDays', () => {
  const entries = [{ id: 's', vesselId: 'v1', type: 'standby', days: 200, watchHours: 0 }];
  const b = computeBuckets(entries, V, { ...DEFAULT_CONFIG, standbyCapDays: 90 });
  assert.equal(b.standbyRaw, 200);
  assert.equal(b.standby, 90);
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
test('a self-certified pack can never be generated', () => {
  const clean = [{ id: 'b', vesselId: 'v3', type: 'seagoing', watchHours: 0, days: 14 }];
  const r = runChecks({ entries: clean, vessels: V, signatory: 'self', verifier: 'pya',
    docMet: { passport: true, email: true, srb: true } });
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some(c => !c.ok && /self-certification/.test(c.label)));
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
  assert.deepEqual(ids, ['pya', 'nautilus', 'other']);
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

// --- testimonial dataset: four totals kept separate --------------------------
test('buildTestimonialDataset keeps the four totals separate', () => {
  const ds = buildTestimonialDataset({ seafarer: SEED_SEAFARER, entries: SEED_ENTRIES, vessels: V, signatory: 'master', verifier: 'pya' });
  assert.deepEqual(Object.keys(ds.service.totals).sort(), ['seagoing', 'standby', 'watchkeeping', 'yard']);
  assert.ok(ds.assurance.contentHash && ds.assurance.qrPayload.startsWith('sha256:'));
});
