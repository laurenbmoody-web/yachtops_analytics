// Crew document taxonomy — categorised list the Documents tab adds from.
//
// Per-type config (all optional; sensible defaults shown):
//   fields          type-specific inputs stored in personal_documents.details (jsonb)
//   flagState       surface the issuing flag-state field (CoC / discharge book)
//   expiry          false → this doc has no expiry; hide the Expiry date field
//                   (the field still shows if a value was already saved)
//   number          false → hide the Document number field (letters, contracts)
//   authorityLabel  relabel the "Issuing authority" field for this type
// Defaults: expiry true, number true, authorityLabel "Issuing authority".

import { NATIONALITIES } from '../../data/nationalities';

export const DOC_CATEGORIES = [
  { id: 'travel', label: 'Travel & identity' },
  { id: 'medical', label: 'Medical & safety' },
  { id: 'qualification', label: 'Qualifications' },
  { id: 'issued', label: 'Issued documents' },
  { id: 'other', label: 'Other' },
];

// Commercial endorsement (RYA quals) — the part that actually expires; the
// underlying certificate of competence does not.
const COMMERCIAL_ENDORSEMENT = { key: 'commercial_endorsement_expiry', label: 'Commercial endorsement expiry', type: 'date' };

// Single/multiple-entry, shared by the visa types.
const VISA_ENTRIES = { key: 'entries', label: 'Entries', type: 'select', options: ['Single', 'Multiple'] };

// Passport / national-ID identity fields. On a passport these also feed the
// profile's Personal Details on save (see syncPassportToPersonalDetails).
const IDENTITY_FIELDS = [
  { key: 'country_of_issue', label: 'Country of issue' },
  { key: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITIES },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'place_of_birth', label: 'Place of birth' },
];

// STCW survival/fire/survival-craft proficiencies must be refreshed every 5
// years. We track that as the (re)validation due date and label the expiry
// field accordingly so it still drives the dashboard reminders.
const STCW_REFRESHER_LABEL = 'Refresher due (5-yearly)';

export const DOCUMENT_TYPES = [
  // ── Travel & identity ───────────────────────────────────────────────────
  { id: 'passport', label: 'Passport', category: 'travel', fields: IDENTITY_FIELDS },
  { id: 'national_id', label: 'National ID card', category: 'travel', fields: IDENTITY_FIELDS },
  {
    // A discharge book is a record of sea service / identity book — it does not
    // expire. Issued by a flag-state administration.
    id: 'seamans_book', label: "Seaman's book / Discharge book", category: 'travel',
    expiry: false, flagState: true, authorityLabel: 'Issuing administration',
  },
  {
    // Not universally required — added on demand. A residency/tax certificate
    // states the country of tax residence for a given year.
    id: 'tax_residency', label: 'Tax / Residency document', category: 'travel',
    expiry: false,
    fields: [
      { key: 'country', label: 'Country of residence' },
      { key: 'tax_year', label: 'Tax year' },
    ],
  },
  {
    id: 'visa_us_b1b2', label: 'Visa — US B1/B2', category: 'travel',
    authorityLabel: 'Issuing embassy / consulate',
    fields: [VISA_ENTRIES, { key: 'max_stay', label: 'Max stay (days per entry)' }],
  },
  {
    id: 'visa_schengen', label: 'Visa — Schengen', category: 'travel',
    authorityLabel: 'Issuing embassy / consulate',
    fields: [VISA_ENTRIES, { key: 'max_stay', label: 'Max stay (days per entry)' }],
  },
  {
    id: 'visa_other', label: 'Visa — other', category: 'travel',
    authorityLabel: 'Issuing embassy / consulate',
    fields: [
      { key: 'visa_class', label: 'Visa class / type' },
      { key: 'country', label: 'Country' },
      VISA_ENTRIES,
      { key: 'max_stay', label: 'Max stay (days per entry)' },
    ],
  },

  // ── Medical & safety ────────────────────────────────────────────────────
  {
    id: 'eng1', label: 'ENG1 medical certificate', category: 'medical',
    authorityLabel: 'Approved doctor / clinic',
    fields: [
      { key: 'result', label: 'Result', type: 'select', options: ['Fit', 'Fit with restrictions', 'Unfit'] },
      { key: 'restrictions', label: 'Restrictions / limitations' },
    ],
  },
  {
    id: 'seafarer_medical', label: 'Seafarer medical (other flag)', category: 'medical',
    authorityLabel: 'Approved doctor / clinic',
    fields: [
      { key: 'issuing_flag', label: 'Flag / standard' },
      { key: 'result', label: 'Result', type: 'select', options: ['Fit', 'Fit with restrictions', 'Unfit'] },
      { key: 'restrictions', label: 'Restrictions / limitations' },
    ],
  },
  { id: 'stcw_basic', label: 'STCW Basic Safety Training', category: 'medical', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_advanced_ff', label: 'STCW Advanced Firefighting', category: 'medical', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_pscrb', label: 'STCW PSCRB (survival craft)', category: 'medical', expiryLabel: STCW_REFRESHER_LABEL },
  // Medical First Aid / Care and the security proficiencies carry no 5-yearly
  // refresher, so no expiry.
  { id: 'stcw_medical_care', label: 'STCW Medical First Aid / Care', category: 'medical', expiry: false },
  { id: 'pdsd', label: 'Security training (PSA / PDSD)', category: 'medical', expiry: false },
  { id: 'sso_dsd', label: 'Ship Security Officer (SSO)', category: 'medical', expiry: false },

  // ── Qualifications ──────────────────────────────────────────────────────
  {
    id: 'coc', label: 'Certificate of Competency (CoC)', category: 'qualification',
    flagState: true, authorityLabel: 'Issuing administration',
    fields: [
      {
        key: 'grade', label: 'Capacity / grade', type: 'select',
        options: [
          'Master <500GT', 'Master <3000GT', 'Master unlimited',
          'Chief Mate <3000GT', 'Chief Mate unlimited',
          'OOW <3000GT', 'OOW unlimited',
          'Y4 / OOW (Yachts)', 'Y3 / Master <500GT', 'Y2 / Master <3000GT', 'Y1 / Master <3000GT (>500GT)',
          'Engineering — MEOL (Yachts)', 'Engineering — SV / Y4', 'Engineering — Y3', 'Engineering — Y2', 'Engineering — Y1',
        ],
      },
    ],
  },
  {
    id: 'gmdss', label: 'GMDSS Radio Operator', category: 'qualification',
    fields: [{ key: 'certificate_type', label: 'Certificate', type: 'select', options: ['GOC (General)', 'ROC (Restricted)'] }],
  },
  {
    // ECDIS certificates don't expire; generic vs type-specific (manufacturer
    // /model) matters operationally.
    id: 'ecdis', label: 'ECDIS', category: 'qualification', expiry: false,
    fields: [{ key: 'ecdis_type', label: 'Type', placeholder: 'Generic, or e.g. Furuno FMD-3300' }],
  },
  {
    id: 'helm_management', label: 'HELM (Leadership & Management)', category: 'qualification', expiry: false,
    fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Operational', 'Management'] }],
  },
  {
    id: 'yachtmaster', label: 'RYA Yachtmaster', category: 'qualification', expiry: false,
    fields: [
      { key: 'grade', label: 'Grade', type: 'select', options: ['Yachtmaster Coastal', 'Yachtmaster Offshore', 'Yachtmaster Ocean'] },
      COMMERCIAL_ENDORSEMENT,
    ],
  },
  {
    id: 'powerboat', label: 'RYA Powerboat Level 2', category: 'qualification', expiry: false,
    fields: [COMMERCIAL_ENDORSEMENT],
  },
  {
    // No statutory expiry, but vessels typically require renewal every 5 years.
    id: 'food_hygiene', label: 'Food Hygiene', category: 'qualification', expiryLabel: 'Renewal due',
    fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Level 1', 'Level 2', 'Level 3', 'Level 4'] }],
  },
  {
    id: 'aec', label: 'Approved Engine Course (AEC)', category: 'qualification', expiry: false,
    fields: [{ key: 'level', label: 'Course', type: 'select', options: ['AEC 1', 'AEC 2', 'AEC 1 & 2'] }],
  },

  // ── Issued documents ────────────────────────────────────────────────────
  // The kept-on-file record between crew member and employer: signed contracts,
  // amendments, letters. Records, not expiring credentials, and rarely carry a
  // document number; the issuer is the employer, so the authority reads
  // "Issued by".
  {
    id: 'employment_contract', label: 'Employment contract (signed)', category: 'issued',
    expiryLabel: 'Contract end date', number: false, authorityLabel: 'Issued by',
    fields: [{ key: 'position', label: 'Position / rank' }],
  },
  { id: 'contract_amendment', label: 'Contract amendment (signed)', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'offer_letter', label: 'Offer letter', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'certificate_of_employment', label: 'Certificate of employment', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'reference_letter', label: 'Reference letter', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  {
    id: 'disciplinary_letter', label: 'Disciplinary / warning letter', category: 'issued',
    expiry: false, number: false, authorityLabel: 'Issued by',
    fields: [{ key: 'warning_level', label: 'Level', type: 'select', options: ['Verbal warning', 'First written warning', 'Final written warning'] }],
  },
  {
    id: 'general_letter', label: 'Letter / document (other)', category: 'issued',
    expiry: false, number: false, authorityLabel: 'Issued by',
    fields: [{ key: 'custom_label', label: 'Document name' }],
  },

  // ── Other ───────────────────────────────────────────────────────────────
  {
    id: 'other', label: 'Other document', category: 'other',
    fields: [{ key: 'custom_label', label: 'Document name' }],
  },
];

// Documents every crew member is expected to hold — always shown as slots
// on the Documents tab (filled or as an empty prompt). Everything else is
// added on demand via "Add document". Tax/residency isn't universal, so it's
// not a core slot.
export const CORE_DOCUMENT_TYPE_IDS = ['passport', 'stcw_basic', 'eng1', 'pdsd', 'seamans_book'];

export const getDocType = (id) => DOCUMENT_TYPES.find((t) => t.id === id) || null;

export const coreDocumentTypes = () =>
  CORE_DOCUMENT_TYPE_IDS.map(getDocType).filter(Boolean);

export const getDocTypeLabel = (id, details) => {
  const t = getDocType(id);
  if (!t) return id || 'Document';
  if (id === 'other' && details?.custom_label) return details.custom_label;
  return t.label;
};

// Grouped {category, label, types[]} for categorised pickers.
export const groupedDocumentTypes = () =>
  DOC_CATEGORIES.map((c) => ({
    ...c,
    types: DOCUMENT_TYPES.filter((t) => t.category === c.id),
  }));
