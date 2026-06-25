// Flag-specific "Record of Hours of Rest" templates.
//
// MLC 2006 Std A2.3 ¶10 leaves the record's format to the flag administration,
// "taking into account the IMO/ILO guidelines". In practice almost every flag
// adopts the IMO/ILO model — some republish it under their own form number /
// letterhead / declaration wording. The rota HOR export produces the IMO/ILO
// model by DEFAULT; this registry lets it swap in a flag-specific variant when
// (and only when) that flag's official form has been sourced and verified.
//
// IMPORTANT: never guess a flag's form. An unverified "official [flag] form" is
// worse than the accepted IMO/ILO version. Until a verified entry exists in
// FLAG_HOR_TEMPLATES below, every flag uses DEFAULT_HOR_TEMPLATE.

import { FLAG_STATES } from '../../data/flagStates';

const DEFAULT_HOR_TEMPLATE = {
  recordTitle: 'Record of Hours of Rest',
  // Declarations printed above the signature lines.
  declaration: 'I confirm that the above is a true record of the seafarer’s hours of rest for the period stated.',
  ncDeclaration: 'I confirm the non-conformities listed above and the reasons recorded are a true and accurate account.',
  // null → use the shared MLC_STANDARD_REF (restHours.js).
  standardRef: null,
  // Flag form / marine-notice number, printed in the header when set.
  formReference: null,
};

// Flags that commonly publish their OWN Record of Hours of Rest form: the Red
// Ensign Group (REG Yacht Code, from the `reg` flag in flagStates) plus the
// major open registries. A vessel under one of these MAY need its flag's
// specific form — this is the watch-list that tells us to go source it.
// Rendering still falls back to the IMO/ILO model until a verified
// FLAG_HOR_TEMPLATES entry is added.
const REG_FLAGS = FLAG_STATES.filter((f) => f.reg).map((f) => f.name);
export const FLAGS_WITH_OWN_FORM = new Set([
  ...REG_FLAGS,
  'Marshall Islands', 'Liberia', 'Panama', 'Malta',
]);

// ── Research notes (Jun 2026) — verify against the official PDF before use ────
// Headline finding: the flags below DO NOT use a different record layout — each
// adopts the IMO/ILO model format (the one this export already produces) and
// references it from its own shipping/marine notice. So the only flag-specific
// element is a CITATION of that notice (printed via `formReference`), and — if
// the notice prescribes specific wording — the declaration/standard-ref text.
// These notice numbers came from secondary sources (search), NOT the official
// PDFs (which are access-blocked here), so they are NOT activated. Confirm the
// current notice/revision + exact declaration wording from the flag's published
// document, then move the entry into FLAG_HOR_TEMPLATES (uncomment) to activate.
//
//   Cayman Islands  — record/table established by Shipping Notice CISN 05/2014,
//                     "based on ILO Guidelines" (i.e. IMO/ILO model).
//                     → likely: { formReference: 'Cayman Islands Shipping Notice CISN 05/2014' }
//                     src: cishipping.com (Master's/Yachtmaster's Handbooks);
//                          redensigngroup.org REG Yacht Code (Jul 2024).
//   Marshall Islands — Marine Notice MN 7-051 (rev -2), record format per Annex I,
//                     "based on IMO/ILO Guidelines"; forms published as MI-300.
//                     → likely: { formReference: 'RMI Marine Notice MN 7-051' }
//                     src: register-iri.com (MN-7-051-2.pdf).
//   Red Ensign Group (Jersey, Guernsey, Isle of Man, Bermuda, BVI, Gibraltar,
//                     United Kingdom) — REG Yacht Code, MLC-aligned, standard
//                     IMO/ILO format. → citation only, per each registry's notice.
//   Liberia / Panama / Malta — major registries; own marine notices not yet
//                     sourced. Default IMO/ILO model applies until confirmed.

// Verified per-flag overrides. ADD ONLY from a flag's official published form,
// then the export uses it automatically. Shape:
//   'Marshall Islands': {
//     formReference: 'RMI Marine Notice MN 7-051',
//     // declaration: '…exact wording, only if the notice prescribes it…',
//     // standardRef: '…only if the notice prescribes a specific reference line…',
//   },
const FLAG_HOR_TEMPLATES = {
  // (empty — research staged above; nothing activated until verified from source)
};

// Resolve the template for a flag. Always returns a complete object (the
// IMO/ILO default merged with any verified override) plus metadata the export
// and UI can use.
export function getHorTemplateForFlag(flag) {
  const override = FLAG_HOR_TEMPLATES[flag] || null;
  return {
    ...DEFAULT_HOR_TEMPLATE,
    ...(override || {}),
    flag: flag || null,
    publishesOwnForm: !!flag && FLAGS_WITH_OWN_FORM.has(flag),
    usingDefault: !override,
  };
}
