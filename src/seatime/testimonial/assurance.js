// Tamper-evidence for the testimonial pack: a SHA-256 over the canonical MCA
// content, surfaced as a verification ref + QR payload. Any change to a hashed
// field flips verifyTestimonial() to tampered.

import { sha256Hex } from './sha256.js';
import { SERVICE_TYPES } from './types.js';

// Public, no-login verify page. // TODO(MIN642): confirm final host/route.
export const VERIFY_BASE_URL = 'https://app.cargocrew.io/verify/sea-time';

/** Deterministic stringify: keys sorted recursively so hashing is stable. */
const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
};

/**
 * The subset of the dataset that is covered by the tamper-evident hash — the
 * MCA content itself (not the assurance block, not transient UI bits).
 * @param {import('./types.js').TestimonialDataset} d
 */
export const hashableContent = (d) => ({
  seafarer: {
    fullName: d?.seafarer?.fullName ?? null,
    dob: d?.seafarer?.dob ?? null,
    nationality: d?.seafarer?.nationality ?? null,
    dischargeBookNo: d?.seafarer?.dischargeBookNo ?? null,
    noeRef: d?.seafarer?.noeRef ?? null,
    cocHeld: d?.seafarer?.cocHeld ?? null
  },
  vessels: (d?.vessels || [])
    .map(v => ({
      name: v?.name ?? null, flag: v?.flag ?? null, imo: v?.imo ?? null,
      mmsi: v?.mmsi ?? null, grossTonnage: v?.grossTonnage ?? null,
      registeredLengthM: v?.registeredLengthM ?? null, vesselType: v?.vesselType ?? null
    }))
    .sort((a, b) => String(a.imo).localeCompare(String(b.imo))),
  service: {
    capacity: d?.service?.capacity ?? null,
    periodFrom: d?.service?.periodFrom ?? null,
    periodTo: d?.service?.periodTo ?? null,
    totals: SERVICE_TYPES.reduce((o, t) => { o[t] = d?.service?.totals?.[t] ?? 0; return o; }, {})
  },
  signatory: {
    name: d?.signatory?.name ?? null,
    rank: d?.signatory?.rank ?? null,
    cocNumber: d?.signatory?.cocNumber ?? null,
    signedAt: d?.signatory?.signedAt ?? null
  }
});

/** SHA-256 hex over the canonical MCA content. */
export const computeContentHash = (dataset) => sha256Hex(canonical(hashableContent(dataset)));

/**
 * Build the assurance block for a dataset.
 * @param {import('./types.js').TestimonialDataset} dataset
 * @returns {import('./types.js').TestimonialAssurance}
 */
export const buildAssurance = (dataset) => {
  const contentHash = computeContentHash(dataset);
  const verificationRef = 'CST-' + contentHash.slice(0, 12).toUpperCase();
  return {
    verificationRef,
    contentHash,
    qrPayload: `${VERIFY_BASE_URL}/${verificationRef}#${contentHash}`
  };
};

/**
 * Re-derive the hash from the (possibly mutated) dataset and compare against the
 * expected hash. If any hashed field changed, tampered === true.
 * @param {import('./types.js').TestimonialDataset} dataset
 * @param {string} [expectedHash]  defaults to dataset.assurance.contentHash
 */
export const verifyTestimonial = (dataset, expectedHash) => {
  const expected = expectedHash ?? dataset?.assurance?.contentHash ?? null;
  const recomputed = computeContentHash(dataset);
  return { ok: expected != null && recomputed === expected, tampered: recomputed !== expected, recomputedHash: recomputed };
};
