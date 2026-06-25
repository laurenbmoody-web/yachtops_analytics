// Sea Service Testimonial Pack — public surface.
//   ONE dataset core -> VerifierProfile adapter -> rendered pack + checklist.
// Add a verifier = a new object in verifiers.js. No generator changes.

export { SERVICE_TYPES, SERVICE_TYPE_LABELS, WATCHKEEPING_MIN_HOURS, SEAGOING_MIN_LENGTH_M } from './types.js';
export { getVerifierProfiles, getVerifierProfile, VERIFIER_PROFILES, SUPPORTING_DOC_LABELS } from './verifiers.js';
export { assembleTestimonialDataset, buildTestimonialDataset } from './dataset.js';
export { validateTestimonial } from './validate.js';
export { renderTestimonialPack, buildSubmissionChecklist } from './render.js';
export { buildAssurance, computeContentHash, verifyTestimonial, VERIFY_BASE_URL } from './assurance.js';
