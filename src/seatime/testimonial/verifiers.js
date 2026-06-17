// Config-driven verifier profiles. Adding a 4th approved organisation (e.g. a
// flag-state digital Seafarer Record Book) is a NEW OBJECT HERE ONLY — no
// generator, validation, or render code changes.
//
// MCA Annex C (the approved-organisation list) changes over time, so each
// profile is dated. // TODO(MIN642): confirm wording/docs against live sources.

/** @type {import('./types.js').VerifierProfile[]} */
export const VERIFIER_PROFILES = [
  {
    id: 'pya',
    label: 'PYA (Professional Yachting Association)',
    templateLayout: 'min642-annexA-pya',
    requiredSupportingDocs: [
      'certified-passport-copy',
      'signatory-email-confirmation'
    ],
    signatoryRules: { allowResponsibleOfficial: true },
    submissionInstructions:
      'Submit via the PYA D-SRB / member profile route. Non-members pay €50 ' +
      '(minimum 2 testimonials). Attach a certified passport copy and the ' +
      "signatory's email for PYA to confirm authenticity.",
    brandingAssets: {},
    lastReviewed: '2026-06-17'
  },
  {
    id: 'nautilus',
    label: 'Nautilus International',
    templateLayout: 'min642-annexA-nautilus',
    requiredSupportingDocs: [
      'master-signature',
      'vessel-stamp'
    ],
    signatoryRules: { allowResponsibleOfficial: false }, // master sign & stamp
    submissionInstructions:
      'Complete online, print, have the Master sign and stamp, scan, then ' +
      'upload via the Nautilus verification route.',
    brandingAssets: {},
    lastReviewed: '2026-06-17'
  },
  {
    id: 'other',
    label: 'Other / generic MIN 642 Annex A',
    templateLayout: 'min642-annexA-generic',
    requiredSupportingDocs: [],
    signatoryRules: { allowResponsibleOfficial: true },
    submissionInstructions:
      'Generic MIN 642 Annex A testimonial. Have the Master or a Responsible ' +
      'Official sign, then submit to your chosen MCA-approved verifying body.',
    brandingAssets: {},
    lastReviewed: '2026-06-17'
  }
];

/** Feeds the verifier dropdown. */
export const getVerifierProfiles = () => VERIFIER_PROFILES.map(p => ({ ...p }));

/** @returns {import('./types.js').VerifierProfile|undefined} */
export const getVerifierProfile = (id) => {
  const p = VERIFIER_PROFILES.find(v => v.id === id);
  return p ? { ...p } : undefined;
};

// Human-readable labels for the supporting-doc ids used across verifiers.
export const SUPPORTING_DOC_LABELS = {
  'certified-passport-copy': 'Certified copy of passport',
  'signatory-email-confirmation': "Signatory's email (for PYA authenticity check)",
  'master-signature': "Master's wet signature",
  'vessel-stamp': 'Vessel stamp'
};
