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
  // The minimum-rest rules, stated on the record (as the IMO/ILO model form
  // does). The generic "MLC A2.3 / STCW A-VIII/1" citation is intentionally
  // omitted — it's a given, and the flag's governing reference sits in the
  // footer instead.
  standardRef: 'Minimum rest: 10h in any 24h and 77h in any 7 days; rest in no more than 2 periods, one of at least 6h.',
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
//                     United Kingdom) — ACTIVATED via shared REG_G6, VERIFIED
//                     from the REG Yacht Code July 2024 Common Annexes, Annex G6.
//                     G6 prescribes the rest limits + record duties but NOT a
//                     form/declaration, so the IMO/ILO model + default attestation
//                     stand. UK adds MSN 1895(M). Cayman keeps its national notice.
//   Malta           — ACTIVATED (citation). MS Notice 105 Rev.2 reviewed: it is
//                     general MLC implementation guidance, NOT a record form, so
//                     Malta uses the IMO/ILO model + default attestation; we cite
//                     the Malta MLC framework. National MLC Rules would be needed
//                     for any Malta-specific declaration.
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
// Red Ensign Group — shared. The REG Yacht Code (Common Annex G6, Hours of Work
// and Rest) is the single governing source for all REG flags. VERIFIED from the
// REG Yacht Code July 2024 edition: G6 sets the rest limits and record duties
// (each record endorsed by master/authorised person and the seafarer, a copy
// retained by the seafarer) but does NOT prescribe a record form or declaration
// wording — so the IMO/ILO model + the default attestation are correct; we add
// the G6 reference and the record-duty footer.
const REG_G6 = {
  // standardRef = the rules; formReference = the citation. Keep them distinct so
  // the consolidated reference line doesn't repeat "REG Yacht Code Annex G6".
  formReference: 'Red Ensign Group Yacht Code — Common Annex G6 (Hours of Work and Rest)',
  standardRef: 'Minimum rest: not less than 10h in any 24h and 77h in any 7 days; rest in no more than 2 periods, one of at least 6h, the interval not exceeding 14h.',
  footerNote: 'Each record is endorsed by the master or authorised person and the seafarer; a copy is retained by the seafarer (REG Yacht Code, Annex G6).',
};

const FLAG_HOR_TEMPLATES = {
  // VERIFIED from RMI Marine Notice 7-051-2, Annex II "Model Format for Record
  // of Hours of Rest" (the IMO/ILO model). Declaration + footer are the exact
  // wording from the notice; the table layout is already the IMO/ILO model.
  'Marshall Islands': {
    formReference: 'RMI Maritime Regulations MI-108 §7.51 · Marine Notice 7-051-2, Annex II',
    declaration: 'I agree that this record is an accurate reflection of the hours of rest of the seafarer concerned.',
    standardRef: 'Minimum rest: 10h in any 24h and 77h in any 7 days; rest in no more than 2 periods, one of at least 6h.',
    footerNote: 'A copy of this record is to be given to the seafarer. This form is subject to examination and endorsement under procedures established by the Republic of the Marshall Islands.',
  },
  // VERIFIED governing notices from Cayman GN 03/2022 (Seafarer Rest & Fitness
  // for Duty), which cites CISN 05/2014 as the hours-of-rest recording notice.
  // Cayman is Red Ensign Group → IMO/ILO model format; the default attestation
  // is retained (CISN 05/2014's exact declaration was not in the supplied GN).
  'Cayman Islands': {
    formReference: 'Cayman Islands Shipping Notice CISN 05/2014 · Guidance Note GN 03/2022',
  },
  // Red Ensign Group (Cayman uses its national notice above; the rest share the
  // REG Yacht Code Annex G6). UK additionally publishes it as MSN 1895(M).
  'Jersey': REG_G6,
  'Guernsey': REG_G6,
  'Isle of Man': REG_G6,
  'Bermuda': REG_G6,
  'British Virgin Islands': REG_G6,
  'Gibraltar': REG_G6,
  'United Kingdom': { ...REG_G6, formReference: `${REG_G6.formReference} · UK MSN 1895(M)` },
  // Malta — MS Notice 105 Rev.2 reviewed: it is general MLC 2006 implementation
  // guidance (definitions, scope, DMLC, inspections) and does NOT prescribe a
  // hours-of-rest record form or declaration. Malta uses the IMO/ILO model (also
  // per EU Directive 1999/63/EC), so the default record + attestation stand; we
  // cite the Malta MLC framework. A record-specific declaration would need
  // Malta's national MLC Rules, not this notice.
  'Malta': {
    formReference: 'Malta Merchant Shipping Directorate — MLC 2006 (MS Notice 105 Rev.2)',
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
