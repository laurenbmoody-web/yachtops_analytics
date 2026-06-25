// Crew document taxonomy — categorised list the Documents tab adds from.
// `fields` are type-specific inputs stored in personal_documents.details (jsonb).
// `flagState` surfaces the issuing flag-state field (CoC / some visas).

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

export const DOCUMENT_TYPES = [
  // Travel & identity
  {
    id: 'passport', label: 'Passport', category: 'travel',
    // Identity fields the passport is authoritative for — these feed the
    // profile's Personal Details on save (see syncPassportToPersonalDetails).
    fields: [
      { key: 'country_of_issue', label: 'Country of issue' },
      { key: 'nationality', label: 'Nationality' },
      { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
      { key: 'place_of_birth', label: 'Place of birth' },
    ],
  },
  { id: 'national_id', label: 'National ID card', category: 'travel' },
  { id: 'seamans_book', label: "Seaman's book / Discharge book", category: 'travel' },
  {
    id: 'tax_residency', label: 'Tax / Residency document', category: 'travel',
    fields: [{ key: 'country', label: 'Country' }],
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

  // Medical & safety. STCW survival/firefighting/security elements need a
  // 5-yearly refresher, so they carry a revalidation/refresher date.
  { id: 'eng1', label: 'ENG1 medical certificate', category: 'medical' },
  { id: 'seafarer_medical', label: 'Seafarer medical (other)', category: 'medical' },
  { id: 'stcw_basic', label: 'STCW Basic Safety Training', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'stcw_advanced_ff', label: 'STCW Advanced Firefighting', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'stcw_pscrb', label: 'STCW PSCRB (survival craft)', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'stcw_medical_care', label: 'STCW Medical First Aid / Care', category: 'medical' },
  { id: 'pdsd', label: 'PSA / PDSD (ship security)', category: 'medical', fields: [STCW_REFRESHER] },
  { id: 'sso_dsd', label: 'SSO / DSD (security officer / duties)', category: 'medical' },

  // Qualifications
  {
    id: 'coc', label: 'Certificate of Competency (CoC)', category: 'qualification',
    flagState: true,
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
  { id: 'ecdis', label: 'ECDIS (generic + type-specific)', category: 'qualification' },
  { id: 'helm_management', label: 'HELM (Management)', category: 'qualification' },
  { id: 'yachtmaster', label: 'RYA Yachtmaster', category: 'qualification' },
  { id: 'powerboat', label: 'Powerboat Level 2', category: 'qualification' },
  { id: 'food_hygiene', label: 'Food Hygiene', category: 'qualification' },
  { id: 'aec', label: 'Approved Engine Course (AEC)', category: 'qualification' },

  // Issued documents — the kept-on-file record between the crew member and the
  // employer: signed contracts, amendments, letters. COMMAND uploads these
  // (a generated contract is only a draft until it's signed by both parties).
  { id: 'employment_contract', label: 'Employment contract (signed)', category: 'issued' },
  { id: 'contract_amendment', label: 'Contract amendment (signed)', category: 'issued' },
  { id: 'offer_letter', label: 'Offer letter', category: 'issued' },
  { id: 'certificate_of_employment', label: 'Certificate of employment', category: 'issued' },
  { id: 'reference_letter', label: 'Reference letter', category: 'issued' },
  { id: 'disciplinary_letter', label: 'Disciplinary / warning letter', category: 'issued' },
  {
    id: 'general_letter', label: 'Letter / document (other)', category: 'issued',
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
