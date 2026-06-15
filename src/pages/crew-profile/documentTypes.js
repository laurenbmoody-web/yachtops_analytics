// Crew document taxonomy — categorised list the Documents tab adds from.
// `fields` are type-specific inputs stored in personal_documents.details (jsonb).
// `flagState` surfaces the issuing flag-state field (CoC / some visas).

export const DOC_CATEGORIES = [
  { id: 'travel', label: 'Travel & identity' },
  { id: 'medical', label: 'Medical & safety' },
  { id: 'qualification', label: 'Qualifications' },
  { id: 'other', label: 'Other' },
];

export const DOCUMENT_TYPES = [
  // Travel & identity
  { id: 'passport', label: 'Passport', category: 'travel' },
  { id: 'national_id', label: 'National ID card', category: 'travel' },
  { id: 'seamans_book', label: "Seaman's book / Discharge book", category: 'travel' },
  { id: 'visa_us_b1b2', label: 'Visa — US B1/B2', category: 'travel' },
  { id: 'visa_schengen', label: 'Visa — Schengen', category: 'travel' },
  {
    id: 'visa_other', label: 'Visa — other', category: 'travel',
    fields: [
      { key: 'visa_class', label: 'Visa class' },
      { key: 'country', label: 'Country' },
    ],
  },

  // Medical & safety
  { id: 'eng1', label: 'ENG1 medical certificate', category: 'medical' },
  { id: 'seafarer_medical', label: 'Seafarer medical (other)', category: 'medical' },
  { id: 'stcw_basic', label: 'STCW Basic Safety Training', category: 'medical' },
  { id: 'stcw_advanced_ff', label: 'STCW Advanced Firefighting', category: 'medical' },
  { id: 'stcw_pscrb', label: 'STCW PSCRB (survival craft)', category: 'medical' },
  { id: 'stcw_medical_care', label: 'STCW Medical First Aid / Care', category: 'medical' },
  { id: 'pdsd', label: 'PSA / PDSD (ship security)', category: 'medical' },

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
  { id: 'yachtmaster', label: 'RYA Yachtmaster', category: 'qualification' },
  { id: 'powerboat', label: 'Powerboat Level 2', category: 'qualification' },
  { id: 'food_hygiene', label: 'Food Hygiene', category: 'qualification' },
  { id: 'aec', label: 'Approved Engine Course (AEC)', category: 'qualification' },

  // Other
  {
    id: 'other', label: 'Other document', category: 'other',
    fields: [{ key: 'custom_label', label: 'Document name' }],
  },
];

// Documents every crew member is expected to hold — always shown as slots
// on the Documents tab (filled or as an empty prompt). Everything else is
// added on demand via "Add document".
export const CORE_DOCUMENT_TYPE_IDS = ['passport', 'stcw_basic', 'eng1', 'pdsd'];

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
