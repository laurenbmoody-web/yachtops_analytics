// Sea Service Testimonial Pack — acceptance tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getVerifierProfiles, getVerifierProfile,
  assembleTestimonialDataset, validateTestimonial,
  renderTestimonialPack, buildSubmissionChecklist,
  verifyTestimonial, computeContentHash
} from './index.js';

// --- fixtures -------------------------------------------------------------
const SEAFARER = { fullName: 'Maya Fernández', dob: '1996-04-02', nationality: 'Spanish', userId: 'u-maya' };
const CAPTAIN = { name: 'Robert Okafor', rank: 'Master', cocNumber: 'GBR-12345', userId: 'u-rob', signedAt: '2026-09-15T10:00:00Z' };

const day = (date, serviceType, watchHours, over15 = true) => ({
  date, serviceType, watchHours,
  grossTonnage: 498, lengthM: over15 ? 42 : 12,
  vesselName: over15 ? 'M/Y Aurelia' : 'S/Y Halcyon',
  vesselFlag: 'Cayman', vesselImo: over15 ? 'IMO9854321' : 'IMO9712006',
  vesselType: 'Motor Yacht', capacityServed: 'OOW', qualifiesForSelectedPath: over15
});

// A clean, qualifying dataset signed by the captain.
const cleanEntries = [
  day('2026-09-01', 'watchkeeping', 6),
  day('2026-09-02', 'watchkeeping', 5),
  day('2026-09-03', 'seagoing', 0),
  day('2026-09-04', 'standby', 0),
  day('2026-09-05', 'yard', 0)
];
const cleanDataset = () => assembleTestimonialDataset({
  seafarer: SEAFARER, entries: cleanEntries, signatory: CAPTAIN,
  supportingDocs: ['certified-passport-copy', 'signatory-email-confirmation', 'master-signature', 'vessel-stamp']
});

// --- AC: dropdown lists PYA/Nautilus/Other --------------------------------
test('getVerifierProfiles lists pya, nautilus, other', () => {
  const ids = getVerifierProfiles().map(p => p.id);
  assert.deepEqual(ids, ['pya', 'nautilus', 'other']);
});

// --- AC: switching verifier re-renders from the SAME dataset, no re-entry --
test('switching verifier re-renders checklist from the same dataset', () => {
  const ds = cleanDataset();
  const snapshot = JSON.stringify(ds);
  const pya = buildSubmissionChecklist(ds, getVerifierProfile('pya'));
  const nautilus = buildSubmissionChecklist(ds, getVerifierProfile('nautilus'));
  assert.notDeepEqual(pya.documents, nautilus.documents);          // layout/docs differ
  assert.equal(JSON.stringify(ds), snapshot);                       // dataset untouched
  assert.ok(pya.documents.some(d => d.id === 'certified-passport-copy'));
  assert.ok(nautilus.documents.some(d => d.id === 'master-signature'));
});

// --- AC: four service types totalled SEPARATELY ---------------------------
test('totals are kept per service type, never merged', () => {
  const ds = cleanDataset();
  assert.deepEqual(ds.service.totals, { seagoing: 1, watchkeeping: 2, standby: 1, yard: 1 });
  // every Annex A field present
  assert.ok(ds.seafarer.fullName && ds.service.periodFrom && ds.service.periodTo);
  assert.ok(ds.vessels[0].grossTonnage != null && ds.vessels[0].registeredLengthM != null);
  assert.ok(ds.assurance.contentHash && ds.assurance.qrPayload && ds.assurance.verificationRef);
});

// --- AC: self-certified testimonial is impossible -------------------------
test('self-certification (signatory == seafarer) hard-fails by name', () => {
  const ds = assembleTestimonialDataset({
    seafarer: SEAFARER, entries: cleanEntries,
    signatory: { name: 'maya  fernandez', rank: 'Master' } // same person, different casing/accent
  });
  const res = validateTestimonial(ds, getVerifierProfile('other'));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.code === 'SELF_CERTIFICATION'));
});

test('self-certification by user id hard-fails even if names differ', () => {
  const ds = assembleTestimonialDataset({
    seafarer: SEAFARER, entries: cleanEntries,
    signatory: { name: 'M. Fernandez-Lopez', userId: 'u-maya', rank: 'Master' }
  });
  const res = validateTestimonial(ds, getVerifierProfile('other'));
  assert.ok(res.errors.some(e => e.code === 'SELF_CERTIFICATION'));
});

test('renderTestimonialPack refuses to produce a self-certified pack', async () => {
  const ds = assembleTestimonialDataset({ seafarer: SEAFARER, entries: cleanEntries, signatory: { name: 'Maya Fernández' } });
  await assert.rejects(
    () => renderTestimonialPack(ds, getVerifierProfile('other')),
    (e) => e.code === 'VALIDATION_BLOCKED' && e.validation.errors.some(x => x.code === 'SELF_CERTIFICATION')
  );
});

// --- AC: generation blocked on ANY failed rule ----------------------------
test('each validation rule blocks with an actionable error', () => {
  const v = getVerifierProfile('pya');

  // watchkeeping < 4h
  let ds = assembleTestimonialDataset({ seafarer: SEAFARER, signatory: CAPTAIN, entries: [day('2026-09-01', 'watchkeeping', 2)] });
  assert.ok(validateTestimonial(ds, getVerifierProfile('other')).errors.some(e => e.code === 'WATCHKEEPING_UNDER_4H'));

  // seagoing on a sub-15m vessel
  ds = assembleTestimonialDataset({ seafarer: SEAFARER, signatory: CAPTAIN, entries: [day('2026-09-01', 'seagoing', 0, false)] });
  assert.ok(validateTestimonial(ds, getVerifierProfile('other')).errors.some(e => e.code === 'SEAGOING_UNDER_15M'));

  // standby exceeds actual sea service: 5 standby days, 0 seagoing/watchkeeping.
  ds = assembleTestimonialDataset({ seafarer: SEAFARER, signatory: CAPTAIN,
    entries: Array.from({ length: 5 }, (_, i) => day(`2026-09-0${i + 1}`, 'standby', 0)) });
  assert.ok(validateTestimonial(ds, getVerifierProfile('other')).errors.some(e => e.code === 'STANDBY_EXCEEDS_SEA_SERVICE'));

  // standby within actual sea service is fine (2 standby ≤ 3 sea-service days).
  ds = assembleTestimonialDataset({ seafarer: SEAFARER, signatory: CAPTAIN, entries: [
    day('2026-09-01', 'seagoing', 0), day('2026-09-02', 'watchkeeping', 6), day('2026-09-03', 'watchkeeping', 6),
    day('2026-09-04', 'standby', 0), day('2026-09-05', 'standby', 0)
  ] });
  assert.ok(!validateTestimonial(ds, getVerifierProfile('other')).errors.some(e => e.code === 'STANDBY_EXCEEDS_SEA_SERVICE'));

  // vessel missing gating facts
  ds = assembleTestimonialDataset({ seafarer: SEAFARER, signatory: CAPTAIN,
    entries: [{ date: '2026-09-01', serviceType: 'seagoing', watchHours: 0, vesselName: 'M/Y X', vesselImo: 'IMO1', grossTonnage: null, lengthM: null }] });
  assert.ok(validateTestimonial(ds, getVerifierProfile('other')).errors.some(e => e.code === 'VESSEL_MISSING_DATA'));

  // no signatory
  ds = assembleTestimonialDataset({ seafarer: SEAFARER, entries: cleanEntries, signatory: {} });
  assert.ok(validateTestimonial(ds, getVerifierProfile('other')).errors.some(e => e.code === 'NO_SIGNATORY'));

  // missing required supporting doc for PYA
  ds = assembleTestimonialDataset({ seafarer: SEAFARER, signatory: CAPTAIN, entries: cleanEntries, supportingDocs: [] });
  assert.ok(validateTestimonial(ds, v).errors.some(e => e.code === 'MISSING_SUPPORTING_DOC'));
});

// --- AC: a new verifier is addable via config object ONLY -----------------
test('a brand-new verifier profile works with no generator changes', async () => {
  // Simulates dropping a 4th profile (e.g. a flag-state digital SRB) into config.
  const flagState = {
    id: 'bma-srb', label: 'Bahamas digital Seafarer Record Book',
    templateLayout: 'min642-annexA-generic',
    requiredSupportingDocs: ['certified-passport-copy'],
    signatoryRules: { allowResponsibleOfficial: true },
    submissionInstructions: 'Upload to the BMA digital SRB. Master signs in-app.'
  };
  const ds = cleanDataset();
  // validate + checklist + render all work purely from the config object
  assert.equal(validateTestimonial(ds, flagState).ok, true);
  const cl = buildSubmissionChecklist(ds, flagState);
  assert.equal(cl.verifierId, 'bma-srb');
  const { pdfBytes } = await renderTestimonialPack(ds, flagState);
  assert.equal(String.fromCharCode(...pdfBytes.slice(0, 5)), '%PDF-');
});

// --- AC: pack carries a QR/hash that flips to "tampered" on any change -----
test('content hash flips to tampered when any field changes', () => {
  const ds = cleanDataset();
  assert.equal(verifyTestimonial(ds).ok, true);
  assert.equal(verifyTestimonial(ds).tampered, false);

  const tampered = JSON.parse(JSON.stringify(ds));
  tampered.service.totals.seagoing = 999;          // forge a day count
  const res = verifyTestimonial(tampered, ds.assurance.contentHash);
  assert.equal(res.ok, false);
  assert.equal(res.tampered, true);
  assert.notEqual(computeContentHash(tampered), ds.assurance.contentHash);
});

// --- happy path renders a real PDF + a clean checklist --------------------
test('clean dataset renders a %PDF pack with a complete checklist', async () => {
  const ds = cleanDataset();
  const { pdfBytes, checklist } = await renderTestimonialPack(ds, getVerifierProfile('pya'));
  assert.equal(String.fromCharCode(...pdfBytes.slice(0, 5)), '%PDF-');
  assert.ok(pdfBytes.length > 1000);
  assert.ok(checklist.documents.every(d => d.supplied === true));
  assert.ok(checklist.steps.length >= 1);
});
