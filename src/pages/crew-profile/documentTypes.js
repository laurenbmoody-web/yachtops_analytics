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

// STCW "updating" / refresher revalidation (5-year cycle). Shared so every
// cert that needs it tracks the same field.
const STCW_REFRESHER = { key: 'revalidation_date', label: 'Refresher / revalidation date', type: 'date' };

// A commercial endorsement (RYA quals) is the part that actually expires — the
// underlying certificate does not.
const COMMERCIAL_ENDORSEMENT = { key: 'commercial_endorsement_expiry', label: 'Commercial endorsement expiry', type: 'date' };

// Passport / national-ID identity fields. On a passport these also feed the
// profile's Personal Details on save (see syncPassportToPersonalDetails).
const IDENTITY_FIELDS = [
  { key: 'country_of_issue', label: 'Country of issue' },
  { key: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITIES },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'place_of_birth', label: 'Place of birth' },
];

export const DOCUMENT_TYPES = [
  // Travel & identity
  { id: 'passport', label: 'Passport', category: 'travel', fields: IDENTITY_FIELDS },
  { id: 'national_id', label: 'National ID card', category: 'travel', fields: IDENTITY_FIELDS },
  {
    // A discharge book is a record of sea service / identity book; it does not
    // expire. Issued by a flag-state administration.
    id: 'seamans_book', label: "Seaman's book / Discharge book", category: 'travel',
    expiry: false, flagState: true, authorityLabel: 'Issuing administration',
  },
  {
    id: 'tax_residency', label: 'Tax / Residency document', category: 'travel',
    expiry: false,
    fields: [
      { key: 'country', label: 'Country' },
      { key: 'tax_year', label: 'Tax year' },
    ],
  },
  {
    id: 'visa_us_b1b2', label: 'Visa — US B1/B2', category: 'travel',
    fields: [{ key: 'max_stay', label: 'Max stay (days per entry)' }],
  },
  {
    id: 'visa_schengen', label: 'Visa — Schengen', category: 'travel',
    fields: [{ key: 'max_stay', label: 'Max stay (days per entry)' }],
  },
  {
    id: 'visa_other', label: 'Visa — other', category: 'travel',
    fields: [
      { key: 'visa_class', label: 'Visa class / type' },
      { key: 'country', label: 'Country' },
      { key: 'max_stay', label: 'Max stay (days per entry)' },
    ],
  },

  // Medical & safety. Medicals carry an expiry and an examining doctor/clinic;
  // STCW survival/firefighting/security elements need a 5-yearly refresher.
  {
    id: 'eng1', label: 'ENG1 medical certificate', category: 'medical',
    authorityLabel: 'Approved doctor / clinic',
    fields: [{ key: 'restrictions', label: 'Restrictions / limitations' }],
  },
  {
    id: 'seafarer_medical', label: 'Seafarer medical (other)', category: 'medical',
    authorityLabel: 'Approved doctor / clinic',
    fields: [{ key: 'restrictions', label: 'Restrictions / limitations' }],
  },
  { id: 'stcw_basic', label: 'STCW Basic Safety Training', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'stcw_advanced_ff', label: 'STCW Advanced Firefighting', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'stcw_pscrb', label: 'STCW PSCRB (survival craft)', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'stcw_medical_care', label: 'STCW Medical First Aid / Care', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'pdsd', label: 'PSA / PDSD (ship security)', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'sso_dsd', label: 'SSO / DSD (security officer / duties)', category: 'medical', expiry: false },

  // Qualifications
  {
    id: 'coc', label: 'Certificate of Competency (CoC)', category: 'qualification',
    flagState: true, authorityLabel: 'Issuing administration',
    fields: [
      {
        key: 'grade', label: 'Licence grade', type: 'select',
        options: [
          'Master <500GT', 'Master <3000GT', 'Master unlimited',
          'Chief Mate <3000GT', 'Chief Mate unlimited',
          'OOW <3000GT', 'OOW unlimited',
          'Y4 / OOW (Yachts)', 'Y3 / Master <500GT', 'Y2 / Master <3000GT', 'Y1 / Master <3000GT (>500GT)',
          'Engineering — MEOL (Yachts)', 'Engineering — SV / Y4', 'Engineering — Y3', 'Engineering — Y2', 'Engineering — Y1',
        ],
      },
      { key: 'revalidation_date', label: 'Revalidation date', type: 'date' },
    ],
  },
  { id: 'gmdss', label: 'GMDSS / GOC / ROC', category: 'qualification' },
  { id: 'ecdis', label: 'ECDIS (generic + type-specific)', category: 'qualification', expiry: false },
  { id: 'helm_management', label: 'HELM (Management)', category: 'qualification', expiry: false },
  {
    id: 'yachtmaster', label: 'RYA Yachtmaster', category: 'qualification',
    expiry: false, fields: [COMMERCIAL_ENDORSEMENT],
  },
  {
    id: 'powerboat', label: 'Powerboat Level 2', category: 'qualification',
    expiry: false, fields: [COMMERCIAL_ENDORSEMENT],
  },
  { id: 'food_hygiene', label: 'Food Hygiene', category: 'qualification', expiry: false },
  { id: 'aec', label: 'Approved Engine Course (AEC)', category: 'qualification', expiry: false },

  // Issued documents — the kept-on-file record between the crew member and the
  // employer: signed contracts, amendments, letters. These are records, not
  // expiring credentials, and rarely carry a document number; the issuer is
  // the employer/company, so the authority field reads "Issued by".
  { id: 'employment_contract', label: 'Employment contract (signed)', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'contract_amendment', label: 'Contract amendment (signed)', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'offer_letter', label: 'Offer letter', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'certificate_of_employment', label: 'Certificate of employment', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'reference_letter', label: 'Reference letter', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  { id: 'disciplinary_letter', label: 'Disciplinary / warning letter', category: 'issued', expiry: false, number: false, authorityLabel: 'Issued by' },
  {
    id: 'general_letter', label: 'Letter / document (other)', category: 'issued',
    expiry: false, number: false, authorityLabel: 'Issued by',
    fields: [{ key: 'custom_label', label: 'Document name' }],
  },

  // Other
  {
    id: 'other', label: 'Other document', category: 'other',
    fields: [{ key: 'custom_label', label: 'Document name' }],
  },
];

// Documents every crew member is expected to hold — always shown as slots
// on the Documents tab (filled or as an empty prompt). Everything else is
// added on demand via "Add document".
export const CORE_DOCUMENT_TYPE_IDS = ['passport', 'stcw_basic', 'eng1', 'pdsd', 'seamans_book', 'tax_residency'];

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
