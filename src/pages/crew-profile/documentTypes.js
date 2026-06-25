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
  { id: 'medical', label: 'Medical & fitness' },
  { id: 'safety', label: 'Safety & security (STCW)' },
  { id: 'deck', label: 'Deck & navigation' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'interior', label: 'Interior & service' },
  { id: 'watersports', label: 'Watersports & dive' },
  { id: 'professional', label: 'Professional & administrative' },
  { id: 'qualification', label: 'Other qualifications' },
  { id: 'issued', label: 'Issued documents' },
  { id: 'other', label: 'Other' },
];

// A free-text "named certificate" field — used by the per-department catch-all
// buckets so any qualification we don't model specifically still files into the
// right department keeping its exact printed title.
const NAMED_CERT = { key: 'custom_label', label: 'Certificate name' };

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
  { id: 'driving_licence', label: 'Driving licence', category: 'travel' },
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

  // ── Medical & fitness ───────────────────────────────────────────────────
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

  // ── Safety & security (STCW) ────────────────────────────────────────────
  // STCW Basic Safety Training is the combined cert; its survival-craft and
  // fire elements (PST, FPFF, AFF, PSCRB) need a 5-yearly refresher, tracked as
  // the expiry. Elementary First Aid (A-VI/1 §2.1.3) is a Basic element and is
  // NOT the same as Medical First Aid / Care (A-VI/4).
  { id: 'stcw_basic', label: 'STCW Basic Safety Training (combined)', category: 'safety', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_pst', label: 'STCW Personal Survival Techniques (PST)', category: 'safety', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_fpff', label: 'STCW Fire Prevention & Fire Fighting (basic)', category: 'safety', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_efa', label: 'STCW Elementary First Aid (EFA)', category: 'safety' },
  { id: 'stcw_pssr', label: 'STCW Personal Safety & Social Responsibility (PSSR)', category: 'safety', expiry: false },
  { id: 'stcw_advanced_ff', label: 'STCW Advanced Firefighting', category: 'safety', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_pscrb', label: 'STCW PSCRB (survival craft)', category: 'safety', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'stcw_medical_care', label: 'STCW Medical First Aid / Care (A-VI/4)', category: 'safety', expiry: false },
  { id: 'pdsd', label: 'Security training (PSA / PDSD)', category: 'safety', expiry: false },
  { id: 'sso_dsd', label: 'Ship Security Officer (SSO)', category: 'safety', expiry: false },
  { id: 'crowd_management', label: 'Crowd Management', category: 'safety', expiry: false },
  { id: 'crisis_management', label: 'Crisis Management & Human Behaviour', category: 'safety', expiry: false },
  { id: 'frb', label: 'STCW Fast Rescue Boat (FRB)', category: 'safety', expiryLabel: STCW_REFRESHER_LABEL },
  { id: 'huet', label: 'Helicopter Underwater Escape Training (HUET)', category: 'safety', expiryLabel: 'Renewal due' },
  { id: 'enclosed_spaces', label: 'Entry into Enclosed Spaces', category: 'safety', expiry: false },
  { id: 'safety_other', label: 'Other safety / security certificate', category: 'safety', fields: [NAMED_CERT] },

  // ── Deck & navigation ───────────────────────────────────────────────────
  {
    id: 'coc', label: 'Certificate of Competency (CoC)', category: 'deck',
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
    id: 'gmdss', label: 'GMDSS Radio Operator (GOC / ROC)', category: 'deck',
    fields: [{ key: 'certificate_type', label: 'Certificate', type: 'select', options: ['GOC (General)', 'ROC (Restricted)'] }],
  },
  { id: 'src', label: 'Short Range Certificate (SRC / VHF radio)', category: 'deck', expiry: false },
  { id: 'lrc', label: 'Long Range Certificate (LRC)', category: 'deck', expiry: false },
  {
    id: 'ecdis', label: 'ECDIS', category: 'deck', expiry: false,
    fields: [{ key: 'ecdis_type', label: 'Type', placeholder: 'Generic, or e.g. Furuno FMD-3300' }],
  },
  { id: 'radar_arpa', label: 'Radar / ARPA', category: 'deck', expiry: false },
  {
    id: 'helm_management', label: 'HELM (Leadership & Management)', category: 'deck', expiry: false,
    fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Operational', 'Management'] }],
  },
  {
    id: 'yachtmaster', label: 'RYA Yachtmaster', category: 'deck', expiry: false,
    fields: [
      { key: 'grade', label: 'Grade', type: 'select', options: ['Yachtmaster Coastal', 'Yachtmaster Offshore', 'Yachtmaster Ocean'] },
      COMMERCIAL_ENDORSEMENT,
    ],
  },
  { id: 'rya_day_skipper', label: 'RYA Day Skipper', category: 'deck', expiry: false },
  { id: 'rya_coastal_skipper', label: 'RYA Coastal Skipper', category: 'deck', expiry: false },
  {
    id: 'powerboat', label: 'RYA Powerboat Level 2', category: 'deck', expiry: false,
    fields: [COMMERCIAL_ENDORSEMENT],
  },
  { id: 'tender_operator', label: 'Tender Operator', category: 'deck', expiry: false },
  { id: 'edh', label: 'Efficient Deck Hand (EDH)', category: 'deck', expiry: false },
  { id: 'yacht_rating', label: 'Yacht / Deck Rating (NWR / Able Seafarer)', category: 'deck', expiry: false },
  { id: 'deck_other', label: 'Other deck / navigation certificate', category: 'deck', fields: [NAMED_CERT] },

  // ── Engineering ─────────────────────────────────────────────────────────
  {
    id: 'aec', label: 'Approved Engine Course (AEC)', category: 'engineering', expiry: false,
    fields: [{ key: 'level', label: 'Course', type: 'select', options: ['AEC 1', 'AEC 2', 'AEC 1 & 2'] }],
  },
  { id: 'meol', label: 'Marine Engine Operator Licence (MEOL)', category: 'engineering', expiry: false },
  { id: 'engineering_other', label: 'Other engineering certificate', category: 'engineering', fields: [NAMED_CERT] },

  // ── Interior & service ──────────────────────────────────────────────────
  {
    id: 'food_hygiene', label: 'Food Hygiene', category: 'interior', expiryLabel: 'Renewal due',
    fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Level 1', 'Level 2', 'Level 3', 'Level 4'] }],
  },
  { id: 'silver_service', label: 'Silver Service / Food & Beverage', category: 'interior', expiry: false },
  {
    id: 'wine_spirits', label: 'Wine & Spirits (WSET)', category: 'interior', expiry: false,
    fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Level 1', 'Level 2', 'Level 3', 'Level 4'] }],
  },
  { id: 'barista', label: 'Barista', category: 'interior', expiry: false },
  { id: 'mixology', label: 'Cocktail / Mixology', category: 'interior', expiry: false },
  { id: 'yacht_purser', label: 'Yacht Purser / Administration', category: 'interior', expiry: false },
  { id: 'guest_interior', label: 'GUEST interior crew course', category: 'interior', expiry: false },
  { id: 'ships_cook', label: "Ship's Cook Certificate", category: 'interior', expiry: false },
  { id: 'culinary', label: 'Culinary / chef qualification', category: 'interior', fields: [NAMED_CERT] },
  { id: 'interior_other', label: 'Other interior / service certificate', category: 'interior', fields: [NAMED_CERT] },

  // ── Watersports & dive ──────────────────────────────────────────────────
  { id: 'pwc_jetski', label: 'PWC / Jet Ski', category: 'watersports', expiry: false },
  {
    id: 'dive', label: 'Diving (PADI / scuba)', category: 'watersports', expiry: false,
    fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Open Water', 'Advanced Open Water', 'Rescue Diver', 'Divemaster', 'Instructor'] }],
  },
  { id: 'waterski', label: 'Water-ski / Wakeboard instructor', category: 'watersports', expiry: false },
  { id: 'watersports_other', label: 'Other watersports / dive certificate', category: 'watersports', fields: [NAMED_CERT] },

  // ── Professional & administrative ───────────────────────────────────────
  // Business / IT / AV / security-management / academic / surveying / project
  // management etc. — captured by department so the exact title is preserved
  // without modelling hundreds of niche courses individually.
  { id: 'professional_other', label: 'Professional / administrative certificate', category: 'professional', fields: [NAMED_CERT] },

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

// Types where holding several distinct records at once is normal — multiple
// visas, a stack of issued letters/contracts, tax docs per year. Everything
// else is single-instance: a newer record supersedes the older one in the UI
// (e.g. a refreshed STCW certificate replaces last cycle's).
const MULTI_INSTANCE_IDS = new Set([
  'visa_us_b1b2', 'visa_schengen', 'visa_other', 'tax_residency',
  'employment_contract', 'contract_amendment', 'offer_letter',
  'certificate_of_employment', 'reference_letter', 'disciplinary_letter',
  'general_letter', 'other',
  // Per-department catch-alls hold distinct named certificates, so several can
  // co-exist (they must not supersede one another).
  'safety_other', 'deck_other', 'engineering_other', 'culinary',
  'interior_other', 'watersports_other', 'professional_other',
]);

export const allowsMultipleDocs = (id) => MULTI_INSTANCE_IDS.has(id);

export const getDocType = (id) => DOCUMENT_TYPES.find((t) => t.id === id) || null;

export const coreDocumentTypes = () =>
  CORE_DOCUMENT_TYPE_IDS.map(getDocType).filter(Boolean);

export const getDocTypeLabel = (id, details) => {
  const t = getDocType(id);
  if (!t) return id || 'Document';
  // Named-certificate buckets (other, the per-department catch-alls, letters)
  // show the specific title the user/parser captured.
  const named = (t.fields || []).some((f) => f.key === 'custom_label');
  if (named && details?.custom_label) return details.custom_label;
  return t.label;
};

// Grouped {category, label, types[]} for categorised pickers.
export const groupedDocumentTypes = () =>
  DOC_CATEGORIES.map((c) => ({
    ...c,
    types: DOCUMENT_TYPES.filter((t) => t.category === c.id),
  }));
