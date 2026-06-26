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
  // Footer note some flags require on the record (e.g. copy-to-seafarer /
  // endorsement statement). Printed near the signatures when set.
  footerNote: null,
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
//   Marshall Islands — ACTIVATED below, VERIFIED from the official MN 7-051-2
//                     (Annex II "Model Format for Record of Hours of Rest"):
//                     exact declaration + copy/endorsement footer; cites MI-108
//                     §7.51. Confirmed the layout is the IMO/ILO model.
//   Cayman Islands  — ACTIVATED below (citation), from Cayman GN 03/2022 which
//                     names CISN 05/2014 as the recording notice. REG Yacht Code
//                     uses the IMO/ILO model; default attestation retained as the
//                     GN did not include CISN 05/2014's exact declaration text.
//   Red Ensign Group (Jersey, Guernsey, Isle of Man, Bermuda, BVI, Gibraltar,
//                     United Kingdom) — ONE shared source covers all seven: the
//                     REG Yacht Code, Common Annex G6 "Hours of Work and Rest"
//                     (IMO/ILO model). UK publishes it as MSN 1895(M). So a
//                     single doc (redensigngroup.org / gov.uk) verifies the
//                     whole group at once. Not activated — official text not
//                     retrievable here (403); supply the PDF to activate all 7.
//   Malta           — Transport Malta Merchant Shipping Notice 105 Rev.2 (MLC
//                     implementation); IMO/ILO model. Needs the notice to verify
//                     the record declaration/format before activating.
//   EU flags (Netherlands, France, Italy, Spain, Madeira/Portugal, Monaco) —
//                     implement EU Directive 1999/63/EC alongside MLC; IMO/ILO
//                     model. Per-state notice needed to activate a citation.
//   Liberia / Panama — major open registries; own marine notices not yet
//                     sourced. Default IMO/ILO model applies until confirmed.

// Verified per-flag overrides. ADD ONLY from a flag's official published form,
// then the export uses it automatically. Shape:
//   'Marshall Islands': {
//     formReference: 'RMI Marine Notice MN 7-051',
//     // declaration: '…exact wording, only if the notice prescribes it…',
//     // standardRef: '…only if the notice prescribes a specific reference line…',
//   },
const FLAG_HOR_TEMPLATES = {
  // VERIFIED from RMI Marine Notice 7-051-2, Annex II "Model Format for Record
  // of Hours of Rest" (the IMO/ILO model). Declaration + footer are the exact
  // wording from the notice; the table layout is already the IMO/ILO model.
  'Marshall Islands': {
    formReference: 'RMI Marine Notice 7-051-2, Annex II',
    declaration: 'I agree that this record is an accurate reflection of the hours of rest of the seafarer concerned.',
    standardRef: 'Minimum hours of rest per RMI Maritime Regulations MI-108 §7.51, in conformity with the ILO MLC 2006 and STCW 1978, as amended. Minimum rest: 10h in any 24h and 77h in any 7 days; rest in no more than 2 periods, one of at least 6h.',
    footerNote: 'A copy of this record is to be given to the seafarer. This form is subject to examination and endorsement under procedures established by the Republic of the Marshall Islands.',
  },
  // VERIFIED governing notices from Cayman GN 03/2022 (Seafarer Rest & Fitness
  // for Duty), which cites CISN 05/2014 as the hours-of-rest recording notice.
  // Cayman is Red Ensign Group → IMO/ILO model format; the default attestation
  // is retained (CISN 05/2014's exact declaration was not in the supplied GN).
  'Cayman Islands': {
    formReference: 'Cayman Islands Shipping Notice CISN 05/2014 · Guidance Note GN 03/2022',
  },
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
