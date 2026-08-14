// Standard superyacht chart of accounts.
//
// The spine is the owner's-office "Expenditure Analysis by Month" report — the
// MYBA summary lines a management account is presented on. Underneath each of
// those sits the detail a boat actually spends against, so a transaction can be
// filed where it happened ("Generators", "Teak Care & Renewal", "Crew Visas")
// rather than swept into a three-word summary line and argued about at month end.
//
// bucket = section heading, code = 3-letter account code, category = line
// description, kind = revenue | expense. Budgeted amounts start at 0 for the crew
// to fill in — a line nobody spends against simply stays at zero.
//
// TWO RULES FOR EDITING THIS FILE
//   1. ADDITIVE ONLY. Codes are stamped onto ledger_transactions.category_code and
//      budget_lines.code, and budget-vs-actual matches on the category TEXT. Renaming,
//      re-bucketing or deleting a line orphans real money. Add lines; never move them.
//      (This is why the summary lines sit first in each bucket and the detail follows —
//      the original report order is preserved exactly as it was.)
//   2. Codes are unique across the whole chart, and so are category labels — the
//      unique indexes on chart_of_accounts key on (tenant_id, code) and
//      (tenant_id, bucket, lower(category)), and computeVsActual matches actuals to
//      budget lines by category, where the first line to claim a label owns it.
// Both rules are enforced by mybaChartOfAccounts.test.js.

export const STANDARD_CHART_OF_ACCOUNTS = [
  // ── Revenue ──────────────────────────────────────────────────────────────
  { bucket: 'Revenue', kind: 'revenue', code: 'NCR', category: 'Net Charter Revenue' },
  { bucket: 'Revenue', kind: 'revenue', code: 'CRI', category: 'Charter Reimbursements' },
  { bucket: 'Revenue', kind: 'revenue', code: 'OIN', category: 'Other Income' },
  { bucket: 'Revenue', kind: 'revenue', code: 'APA', category: 'APA Received' },
  { bucket: 'Revenue', kind: 'revenue', code: 'OWC', category: 'Owner Contributions' },
  { bucket: 'Revenue', kind: 'revenue', code: 'IIN', category: 'Interest & Investment Income' },
  { bucket: 'Revenue', kind: 'revenue', code: 'ICP', category: 'Insurance Claim Proceeds' },

  // ── Crew cost ────────────────────────────────────────────────────────────
  { bucket: 'Crew Cost', kind: 'expense', code: 'OCW', category: 'Officer & Crew Wages' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CCW', category: 'Casual Crew Wages' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CTE', category: 'Crew Travelling' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CFC', category: 'Crew Food & Consumables' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CUF', category: 'Crew Uniforms' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'MCC', category: 'Miscellaneous Crew Cost' },
  // Employment cost that is not the wage itself — the part that surprises an owner.
  { bucket: 'Crew Cost', kind: 'expense', code: 'CSC', category: 'Crew Social Charges & Payroll Taxes' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CPS', category: 'Crew Payroll Service Fees' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CRE', category: 'Crew Recruitment & Placement Fees' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CTR', category: 'Crew Training & Certification' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CMD', category: 'Crew Medical & Dental' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CMI', category: 'Crew Medical & Travel Insurance' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CRP', category: 'Crew Repatriation' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CVI', category: 'Crew Visas & Seafarer Documentation' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CAH', category: 'Crew Accommodation Ashore' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CWF', category: 'Crew Welfare & Morale' },
  { bucket: 'Crew Cost', kind: 'expense', code: 'CBO', category: 'Crew Bonuses & Gratuities' },

  // ── Deck ─────────────────────────────────────────────────────────────────
  { bucket: 'Deck', kind: 'expense', code: 'DCN', category: 'Deck Consumables' },
  { bucket: 'Deck', kind: 'expense', code: 'DSR', category: 'Deck Spares & Renewals' },
  { bucket: 'Deck', kind: 'expense', code: 'DRM', category: 'Deck Repair & Maintenance' },
  { bucket: 'Deck', kind: 'expense', code: 'DPT', category: 'Deck Paint & Varnish' },
  { bucket: 'Deck', kind: 'expense', code: 'DTK', category: 'Teak Care & Renewal' },
  { bucket: 'Deck', kind: 'expense', code: 'DRO', category: 'Ropes, Lines & Fenders' },
  { bucket: 'Deck', kind: 'expense', code: 'DAN', category: 'Anchors, Chain & Mooring Gear' },
  { bucket: 'Deck', kind: 'expense', code: 'DRG', category: 'Rigging, Davits & Cranes' },
  { bucket: 'Deck', kind: 'expense', code: 'DCV', category: 'Covers, Canvas & Exterior Upholstery' },
  { bucket: 'Deck', kind: 'expense', code: 'DTL', category: 'Deck Tools & Equipment' },

  // ── Engineer ─────────────────────────────────────────────────────────────
  { bucket: 'Engineer', kind: 'expense', code: 'ECN', category: 'Engineer Consumables' },
  { bucket: 'Engineer', kind: 'expense', code: 'ESR', category: 'Engineer Spares & Renewals' },
  { bucket: 'Engineer', kind: 'expense', code: 'ERM', category: 'Engineer Repair & Maintenance' },
  // Split by system: "why was engineering £80k" is only answerable per machine.
  { bucket: 'Engineer', kind: 'expense', code: 'EME', category: 'Main Engines' },
  { bucket: 'Engineer', kind: 'expense', code: 'EGE', category: 'Generators' },
  { bucket: 'Engineer', kind: 'expense', code: 'EPR', category: 'Propulsion, Shafts & Propellers' },
  { bucket: 'Engineer', kind: 'expense', code: 'EHY', category: 'Hydraulics & Stabilisers' },
  { bucket: 'Engineer', kind: 'expense', code: 'EEL', category: 'Electrical Systems & Batteries' },
  { bucket: 'Engineer', kind: 'expense', code: 'EHV', category: 'HVAC & Refrigeration' },
  { bucket: 'Engineer', kind: 'expense', code: 'EWM', category: 'Watermakers' },
  { bucket: 'Engineer', kind: 'expense', code: 'EPL', category: 'Plumbing & Sanitary Systems' },
  { bucket: 'Engineer', kind: 'expense', code: 'ESW', category: 'Sewage & Waste Treatment Plant' },
  { bucket: 'Engineer', kind: 'expense', code: 'EFL', category: 'Filters, Oils & Greases' },
  { bucket: 'Engineer', kind: 'expense', code: 'ETL', category: 'Engineer Tools & Workshop' },
  { bucket: 'Engineer', kind: 'expense', code: 'ECT', category: 'Engineering Contractors & Technicians' },

  // ── Interior ─────────────────────────────────────────────────────────────
  { bucket: 'Interior', kind: 'expense', code: 'ICN', category: 'Interior Consumables' },
  { bucket: 'Interior', kind: 'expense', code: 'ISR', category: 'Interior Spares & Renewals' },
  { bucket: 'Interior', kind: 'expense', code: 'IRM', category: 'Interior Repair & Maintenance' },
  { bucket: 'Interior', kind: 'expense', code: 'ILN', category: 'Linen & Towels' },
  { bucket: 'Interior', kind: 'expense', code: 'ILA', category: 'Laundry & Dry Cleaning' },
  { bucket: 'Interior', kind: 'expense', code: 'ICH', category: 'Cleaning Chemicals & Materials' },
  { bucket: 'Interior', kind: 'expense', code: 'IGL', category: 'Glassware, China & Cutlery' },
  { bucket: 'Interior', kind: 'expense', code: 'IGE', category: 'Galley Equipment & Small Wares' },
  { bucket: 'Interior', kind: 'expense', code: 'IUP', category: 'Soft Furnishings & Upholstery' },
  { bucket: 'Interior', kind: 'expense', code: 'IDC', category: 'Interior Decor & Accessories' },
  { bucket: 'Interior', kind: 'expense', code: 'IAM', category: 'Amenities & Toiletries' },

  // ── Fuel ─────────────────────────────────────────────────────────────────
  { bucket: 'Fuel', kind: 'expense', code: 'FLE', category: 'Fuel & Lube Oil' },
  { bucket: 'Fuel', kind: 'expense', code: 'FLT', category: 'Tender Fuel' },
  { bucket: 'Fuel', kind: 'expense', code: 'FBK', category: 'Bunkering Fees & Barge Charges' },
  { bucket: 'Fuel', kind: 'expense', code: 'FAD', category: 'Fuel Additives & Treatment' },
  { bucket: 'Fuel', kind: 'expense', code: 'FGS', category: 'LPG & Galley Gas' },
  { bucket: 'Fuel', kind: 'expense', code: 'FVE', category: 'Vehicle & Shore Fuel' },

  // ── Financial ────────────────────────────────────────────────────────────
  { bucket: 'Financial', kind: 'expense', code: 'MGE', category: 'Management Expenses' },
  { bucket: 'Financial', kind: 'expense', code: 'PJT', category: 'Project Manager Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'INS', category: 'Insurance Premiums' },
  { bucket: 'Financial', kind: 'expense', code: 'ADM', category: 'Administration' },
  // Insurance broken out under the INS summary line — the four policies a yacht
  // renews separately, each with its own broker invoice.
  { bucket: 'Financial', kind: 'expense', code: 'IHM', category: 'Hull & Machinery Insurance' },
  { bucket: 'Financial', kind: 'expense', code: 'IPI', category: 'P&I / Third Party Liability' },
  { bucket: 'Financial', kind: 'expense', code: 'IWR', category: 'War Risk & Territorial Extensions' },
  { bucket: 'Financial', kind: 'expense', code: 'ILB', category: 'Employer Liability & Crew Cover' },
  { bucket: 'Financial', kind: 'expense', code: 'BNK', category: 'Bank Charges & Card Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'FXL', category: 'Foreign Exchange Differences' },
  { bucket: 'Financial', kind: 'expense', code: 'ACC', category: 'Accountancy & Bookkeeping' },
  { bucket: 'Financial', kind: 'expense', code: 'AUF', category: 'Audit Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'LEG', category: 'Legal & Professional Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'REG', category: 'Registry & Flag State Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'OSF', category: 'Corporate & Ownership Structure Fees' },
  { bucket: 'Financial', kind: 'expense', code: 'ITF', category: 'Interest & Finance Charges' },
  { bucket: 'Financial', kind: 'expense', code: 'DUT', category: 'Duties & Import Taxes' },

  // ── Guest costs ──────────────────────────────────────────────────────────
  { bucket: 'Guest Costs', kind: 'expense', code: 'GFE', category: 'Guest Food Stock' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GWS', category: 'Guest Wine Stock' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GCT', category: 'Guest Travel / Car Hire' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'FLO', category: 'Guest Flowers' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GME', category: 'Guest Miscellaneous' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GBV', category: 'Guest Soft Drinks & Mixers' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GTB', category: 'Guest Tobacco & Cigars' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GLA', category: 'Guest Laundry & Dry Cleaning' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GEX', category: 'Guest Excursions & Activities' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GSP', category: 'Guest Spa, Salon & Wellness' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GGF', category: 'Guest Gifts & Hospitality' },
  { bucket: 'Guest Costs', kind: 'expense', code: 'GXS', category: 'Guest Extra Staff & Chef Hire' },

  // ── Shipyard ─────────────────────────────────────────────────────────────
  { bucket: 'Shipyard', kind: 'expense', code: 'SHY', category: 'Shipyard Annual Maintenance' },
  { bucket: 'Shipyard', kind: 'expense', code: 'RFT', category: 'Refit (major shipyard / improvements)' },
  { bucket: 'Shipyard', kind: 'expense', code: 'MCA', category: 'Marine Coastguard Agency' },
  { bucket: 'Shipyard', kind: 'expense', code: 'DDK', category: 'Dry Dock & Haul Out' },
  { bucket: 'Shipyard', kind: 'expense', code: 'AFL', category: 'Antifoul & Hull Coatings' },
  { bucket: 'Shipyard', kind: 'expense', code: 'HUL', category: 'Hull Repair & Fairing' },
  { bucket: 'Shipyard', kind: 'expense', code: 'SVY', category: 'Survey & Inspection' },
  { bucket: 'Shipyard', kind: 'expense', code: 'SYS', category: 'Shipyard Subcontractors' },
  { bucket: 'Shipyard', kind: 'expense', code: 'SYB', category: 'Yard Berthing & Services' },
  { bucket: 'Shipyard', kind: 'expense', code: 'WIN', category: 'Winter Layup & Storage' },
  { bucket: 'Shipyard', kind: 'expense', code: 'GRD', category: 'Guardianage' },

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
  // Port and voyage cost — HAR is the summary line, these are the invoices under it.
  { bucket: 'General', kind: 'expense', code: 'BRT', category: 'Berthing & Marina Contracts' },
  { bucket: 'General', kind: 'expense', code: 'PIL', category: 'Pilotage & Towage' },
  { bucket: 'General', kind: 'expense', code: 'CNL', category: 'Canal & Waterway Transit' },
  { bucket: 'General', kind: 'expense', code: 'CUS', category: 'Customs, Clearance & Immigration' },
  { bucket: 'General', kind: 'expense', code: 'WST', category: 'Waste, Sewage & Garbage Disposal' },
  { bucket: 'General', kind: 'expense', code: 'ENV', category: 'Environmental Compliance & Fees' },
  { bucket: 'General', kind: 'expense', code: 'SEC', category: 'Security & Anti-Piracy' },
  // Compliance and ship's systems.
  { bucket: 'General', kind: 'expense', code: 'MED', category: 'Ship Medical Stores' },
  { bucket: 'General', kind: 'expense', code: 'SFS', category: 'Safety Equipment Servicing' },
  { bucket: 'General', kind: 'expense', code: 'CHP', category: 'Charts & Nautical Publications' },
  { bucket: 'General', kind: 'expense', code: 'SAT', category: 'Satellite Airtime & Internet' },
  { bucket: 'General', kind: 'expense', code: 'ITS', category: 'IT, Software & Subscriptions' },
  { bucket: 'General', kind: 'expense', code: 'ISM', category: 'ISM / ISPS Compliance & Audits' },

  // ── Charter costs ────────────────────────────────────────────────────────
  // What a charter costs to sell and turn round, as opposed to what the guests
  // consume once aboard (that is Guest Costs).
  { bucket: 'Charter Costs', kind: 'expense', code: 'CBC', category: 'Charter Broker Commission' },
  { bucket: 'Charter Costs', kind: 'expense', code: 'CCC', category: 'Central Agency Commission' },
  { bucket: 'Charter Costs', kind: 'expense', code: 'CDL', category: 'Charter Delivery & Redelivery' },
  { bucket: 'Charter Costs', kind: 'expense', code: 'CPR', category: 'Charter Preparation Costs' },
  { bucket: 'Charter Costs', kind: 'expense', code: 'CGT', category: 'Charter Gratuities' },
  { bucket: 'Charter Costs', kind: 'expense', code: 'CLS', category: 'Charter Listing & Advertising' },
  { bucket: 'Charter Costs', kind: 'expense', code: 'CIN', category: 'Charter Insurance Extension' },

  // ── Tenders & toys ───────────────────────────────────────────────────────
  // Their own section because they are their own fleet — separately registered,
  // separately insured, separately serviced. Tender FUEL stays under Fuel (FLT).
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TDC', category: 'Tender & Toy Consumables' },
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TSR', category: 'Tender Spares & Renewals' },
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TRM', category: 'Tender Repair & Maintenance' },
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TOY', category: 'Water Toys & Inflatables' },
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TDV', category: 'Diving Equipment & Compressor' },
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TJS', category: 'Jet Ski & Seabob Servicing' },
  { bucket: 'Tenders & Toys', kind: 'expense', code: 'TRI', category: 'Tender Registration & Insurance' },
];

// Bucket display order for the standard template (revenue first, then the
// expenditure groups in the report's order). The two sections that are not on the
// original report — Charter Costs, Tenders & Toys — sort after it, so a chart that
// was seeded before they existed and has since been topped up reads in the same
// order as one seeded fresh today.
export const STANDARD_BUCKET_ORDER = [
  'Revenue', 'Crew Cost', 'Deck', 'Engineer', 'Interior', 'Fuel',
  'Financial', 'Guest Costs', 'Shipyard', 'General',
  'Charter Costs', 'Tenders & Toys',
];
