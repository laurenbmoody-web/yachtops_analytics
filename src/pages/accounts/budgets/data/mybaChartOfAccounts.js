// Standard superyacht management chart of accounts, taken from the owner's-office
// "Expenditure Analysis by Month" report. Seeded as a one-click budget template so
// budgets speak the same language as the management accounts. bucket = section
// heading, code = 3-letter account code, category = line description, kind =
// revenue | expense. Budgeted amounts start at 0 for the crew to fill in.

export const STANDARD_CHART_OF_ACCOUNTS = [
  // ── Revenue ──────────────────────────────────────────────────────────────
  { bucket: 'Revenue', kind: 'revenue', code: 'NCR', category: 'Net Charter Revenue' },
  { bucket: 'Revenue', kind: 'revenue', code: 'CRI', category: 'Charter Reimbursements' },
  { bucket: 'Revenue', kind: 'revenue', code: 'OIN', category: 'Other Income' },

  // ── Crew cost ────────────────────────────────────────────────────────────
  { bucket: 'Crew Cost', kind: 'expense', code: 'OCW', category: 'Officer & Crew Wages' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CCW', category: 'Casual Crew Wages' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CTE', category: 'Crew Travelling' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CFC', category: 'Crew Food & Consumables' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CUF', category: 'Crew Uniforms' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'MCC', category: 'Miscellaneous Crew Cost' },

  // ── Deck ─────────────────────────────────────────────────────────────────
  { bucket: 'Deck', kind: 'expense', code: 'DCN', category: 'Deck Consumables' },
  { bucket: 'Deck', kind: 'expense', code: 'DSR', category: 'Deck Spares & Renewals' },
  { bucket: 'Deck', kind: 'expense', code: 'DRM', category: 'Deck Repair & Maintenance' },

  // ── Engineer ─────────────────────────────────────────────────────────────
  { bucket: 'Engineer', kind: 'expense', code: 'ECN', category: 'Engineer Consumables' },
  { bucket: 'Engineer', kind: 'expense', code: 'ESR', category: 'Engineer Spares & Renewals' },
  { bucket: 'Engineer', kind: 'expense', code: 'ERM', category: 'Engineer Repair & Maintenance' },

  // ── Interior ─────────────────────────────────────────────────────────────
  { bucket: 'Interior', kind: 'expense', code: 'ICN', category: 'Interior Consumables' },
  { bucket: 'Interior', kind: 'expense', code: 'ISR', category: 'Interior Spares & Renewals' },
  { bucket: 'Interior', kind: 'expense', code: 'IRM', category: 'Interior Repair & Maintenance' },

  // ── Fuel ─────────────────────────────────────────────────────────────────
  { bucket: 'Fuel', kind: 'expense', code: 'FLE', category: 'Fuel & Lube Oil' },
  { bucket: 'Fuel', kind: 'expense', code: 'FLT', category: 'Tender Fuel' },

  // ── Financial ────────────────────────────────────────────────────────────
  { bucket: 'Financial', kind: 'expense', code: 'MGE', category: 'Management Expenses' },
  { bucket: 'Financial', kind: 'expense', code: 'PJT', category: 'Project Manager Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'INS', category: 'Insurance Premiums' },
  { bucket: 'Financial', kind: 'expense', code: 'ADM', category: 'Administration' },

  // ── Guest costs ──────────────────────────────────────────────────────────
  { bucket: 'Guest Costs', kind: 'expense', code: 'GFE', category: 'Guest Food Stock' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GWS', category: 'Guest Wine Stock' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GCT', category: 'Guest Travel / Car Hire' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'FLO', category: 'Guest Flowers' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GME', category: 'Guest Miscellaneous' },

  // ── Shipyard ─────────────────────────────────────────────────────────────
  { bucket: 'Shipyard', kind: 'expense', code: 'SHY', category: 'Shipyard Annual Maintenance' },
  { bucket: 'Shipyard', kind: 'expense', code: 'RFT', category: 'Refit (major shipyard / improvements)' },
  { bucket: 'Shipyard', kind: 'expense', code: 'MCA', category: 'Marine Coastguard Agency' },

  // ── General / ship costs ─────────────────────────────────────────────────
  { bucket: 'General', kind: 'expense', code: 'LSF', category: 'Life Saving & Fire Fighting' },
  { bucket: 'General', kind: 'expense', code: 'NAV', category: 'Navigation & Communication' },
  { bucket: 'General', kind: 'expense', code: 'AUD', category: 'Audiovisual & Entertainment' },
  { bucket: 'General', kind: 'expense', code: 'CAR', category: 'Transport' },
  { bucket: 'General', kind: 'expense', code: 'HAR', category: 'Harbour Dues & Taxes' },
  { bucket: 'General', kind: 'expense', code: 'SPW', category: 'Shore Power & Water' },
  { bucket: 'General', kind: 'expense', code: 'COM', category: 'Communication Expenses' },
  { bucket: 'General', kind: 'expense', code: 'CRT', category: 'Class & Certificates' },
  { bucket: 'General', kind: 'expense', code: 'AGT', category: 'Agent Fees' },
  { bucket: 'General', kind: 'expense', code: 'MSC', category: 'Miscellaneous Ship Cost' },
  { bucket: 'General', kind: 'expense', code: 'CAP', category: 'Capital Purchases' },
  { bucket: 'General', kind: 'expense', code: 'SET', category: 'Set Up Costs' },
  { bucket: 'General', kind: 'expense', code: 'MKT', category: 'Marketing' },
  { bucket: 'General', kind: 'expense', code: 'DOC', category: 'Dock Express' },
  { bucket: 'General', kind: 'expense', code: 'FRG', category: 'Freight' },
  { bucket: 'General', kind: 'expense', code: 'TAX', category: 'Charter VAT' },
];

// Bucket display order for the standard template (revenue first, then the
// expenditure groups in the report's order).
export const STANDARD_BUCKET_ORDER = [
  'Revenue', 'Crew Cost', 'Deck', 'Engineer', 'Interior', 'Fuel',
  'Financial', 'Guest Costs', 'Shipyard', 'General',
];
