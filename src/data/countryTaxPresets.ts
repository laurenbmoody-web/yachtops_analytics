// src/data/countryTaxPresets.ts
//
// Tax category presets by country. Used by the supplier portal invoicing
// system to bootstrap a supplier's tax configuration when they pick their
// country of business.
//
// Rates are correct as of April 2026 to the best of our knowledge.
// Suppliers can override any rate in their settings if their accountant
// has told them otherwise. Snapshots are captured per-line at invoice
// generation, so changes here don't affect historical invoices.
//
// CATEGORY KEYS (universal across countries — the labels and rates differ
// but the conceptual buckets are the same):
//
//   standard       — country's standard / default VAT rate
//   food           — most groceries, raw food
//   food_prepared  — restaurant / catering / ready-to-eat
//   alcohol        — wines, spirits, beer
//   non_alcoholic  — soft drinks, juices, bottled water (often reduced)
//   tobacco        — cigarettes, cigars, tobacco products
//   services       — labour, delivery, handling, agent fees
//   bonded         — 0% — supply to yacht under temporary admission /
//                    yacht-in-transit / customs-bonded supply (the big
//                    superyacht VAT exemption — varies by jurisdiction)
//   zero_rated     — 0% for other reasons (exports, certain goods)
//
// Countries without a national VAT/GST system (USA, GCC pre-2018, etc.)
// are flagged with `taxSystem: 'sales_tax_subnational'` or 'none' and the
// supplier will be prompted to enter their effective rate manually.

export type TaxCategoryKey =
  | 'standard'
  | 'food'
  | 'food_prepared'
  | 'alcohol'
  | 'non_alcoholic'
  | 'tobacco'
  | 'services'
  | 'bonded'
  | 'zero_rated';

export type TaxCategory = {
  key: TaxCategoryKey;
  rate: number;        // percentage, e.g. 20 = 20%
  label: string;       // localised label in the country's primary language
  labelEn?: string;    // English fallback for non-English countries
  note?: string;       // helper text for edge cases
};

export type TaxSystem =
  | 'vat'                      // unified national VAT
  | 'gst'                      // Goods and Services Tax (semantically same as VAT)
  | 'sales_tax_subnational'    // USA, some others — varies by state/province
  | 'consumption_tax'          // Japan
  | 'none';                    // no national consumption tax (Hong Kong, BVI, etc.)

export type CountryTaxPreset = {
  iso2: string;
  name: string;
  taxSystem: TaxSystem;
  taxName: string;             // 'VAT', 'GST', 'TVA', 'IVA', 'MwSt', etc.
  defaultCurrency: string;     // ISO 4217
  vatRegistrationFormat?: string; // hint string for the VAT number field
  categories: TaxCategory[];
  notes?: string;              // free-text — special rules suppliers should know
};

// ─────────────────────────────────────────────────────────────────
// Helper for countries with a VAT-exempt 'bonded supply to yacht' rule.
// Most maritime nations recognise this in some form.
// ─────────────────────────────────────────────────────────────────
const BONDED_SUPPLY: TaxCategory = {
  key: 'bonded',
  rate: 0,
  label: 'Bonded supply (yacht in transit)',
  labelEn: 'Bonded supply to yacht under temporary admission',
  note: 'Zero-rated when supplying a yacht flying a non-domestic flag, in transit, with appropriate customs declaration.',
};

const ZERO_RATED_EXPORTS: TaxCategory = {
  key: 'zero_rated',
  rate: 0,
  label: 'Zero-rated',
  labelEn: 'Zero-rated (exports, qualifying goods)',
};

// ═══════════════════════════════════════════════════════════════════
// EUROPE — EU member states + UK + EEA + non-EU European
// ═══════════════════════════════════════════════════════════════════

export const COUNTRY_TAX_PRESETS: Record<string, CountryTaxPreset> = {
  // ── Western Mediterranean ──────────────────────────────────────
  FR: {
    iso2: 'FR', name: 'France',
    taxSystem: 'vat', taxName: 'TVA', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'FR + 11 digits',
    categories: [
      { key: 'standard', rate: 20, label: 'Taux normal', labelEn: 'Standard rate' },
      { key: 'food', rate: 5.5, label: 'Produits alimentaires', labelEn: 'Food (basic)' },
      { key: 'food_prepared', rate: 10, label: 'Restauration', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 20, label: 'Boissons alcoolisées', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 5.5, label: 'Boissons non alcoolisées', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 20, label: 'Tabac', labelEn: 'Tobacco' },
      { key: 'services', rate: 20, label: 'Services', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'France recognises "avitaillement de yachts" zero-rating for non-EU flagged yachts under temporary admission.',
  },
  MC: {
    iso2: 'MC', name: 'Monaco',
    taxSystem: 'vat', taxName: 'TVA', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'FR + 11 digits (Monaco uses French VAT system)',
    categories: [
      { key: 'standard', rate: 20, label: 'Taux normal', labelEn: 'Standard rate' },
      { key: 'food', rate: 5.5, label: 'Produits alimentaires', labelEn: 'Food (basic)' },
      { key: 'food_prepared', rate: 10, label: 'Restauration', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 20, label: 'Boissons alcoolisées', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 5.5, label: 'Boissons non alcoolisées', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 20, label: 'Tabac', labelEn: 'Tobacco' },
      { key: 'services', rate: 20, label: 'Services', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'Monaco operates under a customs union with France and uses the French VAT system.',
  },
  IT: {
    iso2: 'IT', name: 'Italy',
    taxSystem: 'vat', taxName: 'IVA', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'IT + 11 digits',
    categories: [
      { key: 'standard', rate: 22, label: 'Aliquota ordinaria', labelEn: 'Standard rate' },
      { key: 'food', rate: 4, label: 'Alimentari di base', labelEn: 'Food (essential)' },
      { key: 'food_prepared', rate: 10, label: 'Ristorazione', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 22, label: 'Bevande alcoliche', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 10, label: 'Bevande analcoliche', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 22, label: 'Tabacchi', labelEn: 'Tobacco' },
      { key: 'services', rate: 22, label: 'Servizi', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'Italy applies "non imponibile art. 8-bis" zero-rating for supplies to yachts in international navigation.',
  },
  ES: {
    iso2: 'ES', name: 'Spain',
    taxSystem: 'vat', taxName: 'IVA', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'ES + letter + 7 digits + letter',
    categories: [
      { key: 'standard', rate: 21, label: 'Tipo general', labelEn: 'Standard rate' },
      { key: 'food', rate: 4, label: 'Alimentos básicos', labelEn: 'Food (essential)' },
      { key: 'food_prepared', rate: 10, label: 'Restauración', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 21, label: 'Bebidas alcohólicas', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 10, label: 'Bebidas no alcohólicas', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 21, label: 'Tabaco', labelEn: 'Tobacco' },
      { key: 'services', rate: 21, label: 'Servicios', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'Canary Islands use IGIC (7%) instead of mainland IVA. Pick "ES-CN" preset for Canary suppliers.',
  },
  PT: {
    iso2: 'PT', name: 'Portugal',
    taxSystem: 'vat', taxName: 'IVA', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'PT + 9 digits',
    categories: [
      { key: 'standard', rate: 23, label: 'Taxa normal', labelEn: 'Standard rate' },
      { key: 'food', rate: 6, label: 'Alimentos', labelEn: 'Food' },
      { key: 'food_prepared', rate: 13, label: 'Restauração', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 23, label: 'Bebidas alcoólicas', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 13, label: 'Bebidas não alcoólicas', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 23, label: 'Tabaco', labelEn: 'Tobacco' },
      { key: 'services', rate: 23, label: 'Serviços', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
  },
  GR: {
    iso2: 'GR', name: 'Greece',
    taxSystem: 'vat', taxName: 'ΦΠΑ (FPA)', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'EL + 9 digits',
    categories: [
      { key: 'standard', rate: 24, label: 'Κανονικός', labelEn: 'Standard rate' },
      { key: 'food', rate: 13, label: 'Τρόφιμα', labelEn: 'Food' },
      { key: 'food_prepared', rate: 13, label: 'Εστίαση', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 24, label: 'Αλκοολούχα', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 24, label: 'Μη αλκοολούχα', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 24, label: 'Καπνός', labelEn: 'Tobacco' },
      { key: 'services', rate: 24, label: 'Υπηρεσίες', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'Reduced rates apply on certain Greek islands (Aegean) — supplier should override if applicable.',
  },
  HR: {
    iso2: 'HR', name: 'Croatia',
    taxSystem: 'vat', taxName: 'PDV', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'HR + 11 digits',
    categories: [
      { key: 'standard', rate: 25, label: 'Opća stopa', labelEn: 'Standard rate' },
      { key: 'food', rate: 5, label: 'Osnovne namirnice', labelEn: 'Basic food' },
      { key: 'food_prepared', rate: 13, label: 'Ugostiteljstvo', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 25, label: 'Alkoholna pića', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 13, label: 'Bezalkoholna pića', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 25, label: 'Duhan', labelEn: 'Tobacco' },
      { key: 'services', rate: 25, label: 'Usluge', labelEn: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
  },
  ME: {
    iso2: 'ME', name: 'Montenegro',
    taxSystem: 'vat', taxName: 'PDV', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 21, label: 'Opšta stopa', labelEn: 'Standard rate' },
      { key: 'food', rate: 7, label: 'Hrana', labelEn: 'Food' },
      { key: 'food_prepared', rate: 7, label: 'Ugostiteljstvo', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 21, label: 'Alkohol', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 21, label: 'Bezalkoholna pića', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 21, label: 'Duvan', labelEn: 'Tobacco' },
      { key: 'services', rate: 21, label: 'Usluge', labelEn: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  TR: {
    iso2: 'TR', name: 'Turkey',
    taxSystem: 'vat', taxName: 'KDV', defaultCurrency: 'TRY',
    vatRegistrationFormat: '10 digits',
    categories: [
      { key: 'standard', rate: 20, label: 'Genel oran', labelEn: 'Standard rate' },
      { key: 'food', rate: 1, label: 'Temel gıda', labelEn: 'Basic food' },
      { key: 'food_prepared', rate: 10, label: 'Restoran', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 20, label: 'Alkollü içecekler', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 10, label: 'Alkolsüz içecekler', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 20, label: 'Tütün', labelEn: 'Tobacco' },
      { key: 'services', rate: 20, label: 'Hizmetler', labelEn: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'Turkish bonded supply rules require supplier to be in a free zone or hold a special licence.',
  },
  // ── Northern Europe ────────────────────────────────────────────
  GB: {
    iso2: 'GB', name: 'United Kingdom',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'GBP',
    vatRegistrationFormat: 'GB + 9 digits',
    categories: [
      { key: 'standard', rate: 20, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Food (zero-rated)' },
      { key: 'food_prepared', rate: 20, label: 'Catering / hot food' },
      { key: 'alcohol', rate: 20, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 0, label: 'Cold non-alcoholic drinks' },
      { key: 'tobacco', rate: 20, label: 'Tobacco' },
      { key: 'services', rate: 20, label: 'Services' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'UK food is zero-rated as standard. Hot/prepared food is standard-rated. Bonded stores rules apply for vessels leaving UK waters.',
  },
  IE: {
    iso2: 'IE', name: 'Ireland',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 23, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Food (zero-rated)' },
      { key: 'food_prepared', rate: 13.5, label: 'Catering / restaurant' },
      { key: 'alcohol', rate: 23, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 23, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 23, label: 'Tobacco' },
      { key: 'services', rate: 23, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  DE: {
    iso2: 'DE', name: 'Germany',
    taxSystem: 'vat', taxName: 'MwSt', defaultCurrency: 'EUR',
    vatRegistrationFormat: 'DE + 9 digits',
    categories: [
      { key: 'standard', rate: 19, label: 'Regelsteuersatz', labelEn: 'Standard rate' },
      { key: 'food', rate: 7, label: 'Lebensmittel', labelEn: 'Food' },
      { key: 'food_prepared', rate: 19, label: 'Gastronomie', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 19, label: 'Alkoholische Getränke', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 19, label: 'Alkoholfreie Getränke', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 19, label: 'Tabak', labelEn: 'Tobacco' },
      { key: 'services', rate: 19, label: 'Dienstleistungen', labelEn: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  NL: {
    iso2: 'NL', name: 'Netherlands',
    taxSystem: 'vat', taxName: 'BTW', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 21, label: 'Hoog tarief', labelEn: 'Standard rate' },
      { key: 'food', rate: 9, label: 'Voedsel', labelEn: 'Food' },
      { key: 'food_prepared', rate: 9, label: 'Horeca', labelEn: 'Prepared food / catering' },
      { key: 'alcohol', rate: 21, label: 'Alcohol', labelEn: 'Alcohol' },
      { key: 'non_alcoholic', rate: 9, label: 'Frisdranken', labelEn: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 21, label: 'Tabak', labelEn: 'Tobacco' },
      { key: 'services', rate: 21, label: 'Diensten', labelEn: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  BE: {
    iso2: 'BE', name: 'Belgium',
    taxSystem: 'vat', taxName: 'BTW / TVA', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 21, label: 'Standard rate' },
      { key: 'food', rate: 6, label: 'Food' },
      { key: 'food_prepared', rate: 12, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 21, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 6, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 21, label: 'Tobacco' },
      { key: 'services', rate: 21, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  LU: {
    iso2: 'LU', name: 'Luxembourg',
    taxSystem: 'vat', taxName: 'TVA', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 17, label: 'Taux normal', labelEn: 'Standard rate' },
      { key: 'food', rate: 3, label: 'Alimentation' },
      { key: 'food_prepared', rate: 17, label: 'Restauration' },
      { key: 'alcohol', rate: 17, label: 'Alcool' },
      { key: 'non_alcoholic', rate: 3, label: 'Boissons non alcoolisées' },
      { key: 'tobacco', rate: 17, label: 'Tabac' },
      { key: 'services', rate: 17, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  DK: {
    iso2: 'DK', name: 'Denmark',
    taxSystem: 'vat', taxName: 'MOMS', defaultCurrency: 'DKK',
    categories: [
      { key: 'standard', rate: 25, label: 'Standard rate' },
      { key: 'food', rate: 25, label: 'Food (no reduced rate)' },
      { key: 'food_prepared', rate: 25, label: 'Prepared food' },
      { key: 'alcohol', rate: 25, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 25, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 25, label: 'Tobacco' },
      { key: 'services', rate: 25, label: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'Denmark has no reduced VAT rates — single 25% applies to all goods.',
  },
  SE: {
    iso2: 'SE', name: 'Sweden',
    taxSystem: 'vat', taxName: 'MOMS', defaultCurrency: 'SEK',
    categories: [
      { key: 'standard', rate: 25, label: 'Standard rate' },
      { key: 'food', rate: 12, label: 'Food' },
      { key: 'food_prepared', rate: 12, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 25, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 12, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 25, label: 'Tobacco' },
      { key: 'services', rate: 25, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  NO: {
    iso2: 'NO', name: 'Norway',
    taxSystem: 'vat', taxName: 'MVA', defaultCurrency: 'NOK',
    categories: [
      { key: 'standard', rate: 25, label: 'Standard rate' },
      { key: 'food', rate: 15, label: 'Food' },
      { key: 'food_prepared', rate: 25, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 25, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 25, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 25, label: 'Tobacco' },
      { key: 'services', rate: 25, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  FI: {
    iso2: 'FI', name: 'Finland',
    taxSystem: 'vat', taxName: 'ALV', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 24, label: 'Standard rate' },
      { key: 'food', rate: 14, label: 'Food' },
      { key: 'food_prepared', rate: 14, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 24, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 14, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 24, label: 'Tobacco' },
      { key: 'services', rate: 24, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  IS: {
    iso2: 'IS', name: 'Iceland',
    taxSystem: 'vat', taxName: 'VSK', defaultCurrency: 'ISK',
    categories: [
      { key: 'standard', rate: 24, label: 'Standard rate' },
      { key: 'food', rate: 11, label: 'Food' },
      { key: 'food_prepared', rate: 11, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 24, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 11, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 24, label: 'Tobacco' },
      { key: 'services', rate: 24, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  CH: {
    iso2: 'CH', name: 'Switzerland',
    taxSystem: 'vat', taxName: 'MwSt / TVA', defaultCurrency: 'CHF',
    categories: [
      { key: 'standard', rate: 8.1, label: 'Standard rate' },
      { key: 'food', rate: 2.6, label: 'Food' },
      { key: 'food_prepared', rate: 8.1, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 8.1, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 2.6, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 8.1, label: 'Tobacco' },
      { key: 'services', rate: 8.1, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  AT: {
    iso2: 'AT', name: 'Austria',
    taxSystem: 'vat', taxName: 'USt', defaultCurrency: 'EUR',
    categories: [
      { key: 'standard', rate: 20, label: 'Standard rate' },
      { key: 'food', rate: 10, label: 'Food' },
      { key: 'food_prepared', rate: 10, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 20, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 20, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 20, label: 'Tobacco' },
      { key: 'services', rate: 20, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  PL: {
    iso2: 'PL', name: 'Poland',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'PLN',
    categories: [
      { key: 'standard', rate: 23, label: 'Standard rate' },
      { key: 'food', rate: 5, label: 'Food' },
      { key: 'food_prepared', rate: 8, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 23, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 23, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 23, label: 'Tobacco' },
      { key: 'services', rate: 23, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  // ── Caribbean & Atlantic ───────────────────────────────────────
  US: {
    iso2: 'US', name: 'United States',
    taxSystem: 'sales_tax_subnational', taxName: 'Sales Tax', defaultCurrency: 'USD',
    categories: [
      { key: 'standard', rate: 0, label: 'Sales tax (state-dependent)', note: 'No federal sales tax. Set rate per state of business — typically 4-10%.' },
      { key: 'food', rate: 0, label: 'Food (often exempt or reduced — state-dependent)' },
      { key: 'food_prepared', rate: 0, label: 'Prepared food (state-dependent)' },
      { key: 'alcohol', rate: 0, label: 'Alcohol (state-dependent + excise)' },
      { key: 'non_alcoholic', rate: 0, label: 'Non-alcoholic drinks (state-dependent)' },
      { key: 'tobacco', rate: 0, label: 'Tobacco (state + federal excise)' },
      { key: 'services', rate: 0, label: 'Services (state-dependent — many states exempt)' },
      BONDED_SUPPLY,
      ZERO_RATED_EXPORTS,
    ],
    notes: 'USA has no federal VAT. Sales tax varies by state (FL ~6%, CA ~7.25%, NY ~4%+local). Supplier must enter their state sales tax rate manually.',
  },
  BS: {
    iso2: 'BS', name: 'Bahamas',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'BSD',
    categories: [
      { key: 'standard', rate: 10, label: 'Standard rate' },
      { key: 'food', rate: 10, label: 'Food' },
      { key: 'food_prepared', rate: 10, label: 'Prepared food / catering' },
      { key: 'alcohol', rate: 10, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 10, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 10, label: 'Tobacco' },
      { key: 'services', rate: 10, label: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'Bahamas reduced VAT from 12% to 10% in 2022. Bonded supply to yachts in transit zero-rated.',
  },
  BB: {
    iso2: 'BB', name: 'Barbados',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'BBD',
    categories: [
      { key: 'standard', rate: 17.5, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (zero-rated)' },
      { key: 'food_prepared', rate: 17.5, label: 'Prepared food' },
      { key: 'alcohol', rate: 17.5, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 17.5, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 17.5, label: 'Tobacco' },
      { key: 'services', rate: 17.5, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  AG: {
    iso2: 'AG', name: 'Antigua and Barbuda',
    taxSystem: 'vat', taxName: 'ABST', defaultCurrency: 'XCD',
    categories: [
      { key: 'standard', rate: 15, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (zero-rated)' },
      { key: 'food_prepared', rate: 15, label: 'Prepared food' },
      { key: 'alcohol', rate: 15, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 15, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 15, label: 'Tobacco' },
      { key: 'services', rate: 15, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  KN: {
    iso2: 'KN', name: 'St Kitts and Nevis',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'XCD',
    categories: [
      { key: 'standard', rate: 17, label: 'Standard rate' },
      { key: 'food', rate: 10, label: 'Food' },
      { key: 'food_prepared', rate: 10, label: 'Prepared food' },
      { key: 'alcohol', rate: 17, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 17, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 17, label: 'Tobacco' },
      { key: 'services', rate: 17, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  LC: {
    iso2: 'LC', name: 'St Lucia',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'XCD',
    categories: [
      { key: 'standard', rate: 12.5, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (zero-rated)' },
      { key: 'food_prepared', rate: 12.5, label: 'Prepared food' },
      { key: 'alcohol', rate: 12.5, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 12.5, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 12.5, label: 'Tobacco' },
      { key: 'services', rate: 12.5, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  VG: {
    iso2: 'VG', name: 'British Virgin Islands',
    taxSystem: 'none', taxName: 'No VAT', defaultCurrency: 'USD',
    categories: [
      { key: 'standard', rate: 0, label: 'No VAT' },
      { key: 'food', rate: 0, label: 'Food' },
      { key: 'food_prepared', rate: 0, label: 'Prepared food' },
      { key: 'alcohol', rate: 0, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 0, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 0, label: 'Tobacco' },
      { key: 'services', rate: 0, label: 'Services' },
    ],
    notes: 'BVI has no VAT or sales tax. Customs duty applies on imports but does not feature on sales invoices.',
  },
  KY: {
    iso2: 'KY', name: 'Cayman Islands',
    taxSystem: 'none', taxName: 'No VAT', defaultCurrency: 'KYD',
    categories: [
      { key: 'standard', rate: 0, label: 'No VAT' },
      { key: 'food', rate: 0, label: 'Food' },
      { key: 'food_prepared', rate: 0, label: 'Prepared food' },
      { key: 'alcohol', rate: 0, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 0, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 0, label: 'Tobacco' },
      { key: 'services', rate: 0, label: 'Services' },
    ],
    notes: 'Cayman has no VAT or income tax. Import duty applies on goods entering the islands.',
  },
  TC: {
    iso2: 'TC', name: 'Turks and Caicos',
    taxSystem: 'none', taxName: 'No VAT', defaultCurrency: 'USD',
    categories: [
      { key: 'standard', rate: 0, label: 'No VAT' },
      { key: 'food', rate: 0, label: 'Food' },
      { key: 'food_prepared', rate: 0, label: 'Prepared food' },
      { key: 'alcohol', rate: 0, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 0, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 0, label: 'Tobacco' },
      { key: 'services', rate: 0, label: 'Services' },
    ],
    notes: 'TCI has no VAT. Customs duty applies.',
  },
  AW: {
    iso2: 'AW', name: 'Aruba',
    taxSystem: 'vat', taxName: 'BBO/BAVP/BAZV', defaultCurrency: 'AWG',
    categories: [
      { key: 'standard', rate: 7, label: 'Standard rate (combined)' },
      { key: 'food', rate: 7, label: 'Food' },
      { key: 'food_prepared', rate: 7, label: 'Prepared food' },
      { key: 'alcohol', rate: 7, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 7, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 7, label: 'Tobacco' },
      { key: 'services', rate: 7, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  CW: {
    iso2: 'CW', name: 'Curaçao',
    taxSystem: 'vat', taxName: 'OB', defaultCurrency: 'ANG',
    categories: [
      { key: 'standard', rate: 6, label: 'Standard rate' },
      { key: 'food', rate: 6, label: 'Food' },
      { key: 'food_prepared', rate: 9, label: 'Prepared food' },
      { key: 'alcohol', rate: 9, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 6, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 9, label: 'Tobacco' },
      { key: 'services', rate: 6, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  SX: {
    iso2: 'SX', name: 'Sint Maarten',
    taxSystem: 'vat', taxName: 'TOT', defaultCurrency: 'ANG',
    categories: [
      { key: 'standard', rate: 5, label: 'Turnover tax' },
      { key: 'food', rate: 5, label: 'Food' },
      { key: 'food_prepared', rate: 5, label: 'Prepared food' },
      { key: 'alcohol', rate: 5, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 5, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 5, label: 'Tobacco' },
      { key: 'services', rate: 5, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  // ── Americas ──────────────────────────────────────────────────
  CA: {
    iso2: 'CA', name: 'Canada',
    taxSystem: 'gst', taxName: 'GST/HST', defaultCurrency: 'CAD',
    categories: [
      { key: 'standard', rate: 5, label: 'GST (federal)', note: 'Provinces add PST/HST. BC: 12%, ON: 13%, NS: 15%. Override per province.' },
      { key: 'food', rate: 0, label: 'Basic groceries (zero-rated)' },
      { key: 'food_prepared', rate: 5, label: 'Prepared food' },
      { key: 'alcohol', rate: 5, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 5, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 5, label: 'Tobacco' },
      { key: 'services', rate: 5, label: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'Federal GST is 5%. Each province adds either PST or HST — override the standard rate to match your province.',
  },
  MX: {
    iso2: 'MX', name: 'Mexico',
    taxSystem: 'vat', taxName: 'IVA', defaultCurrency: 'MXN',
    categories: [
      { key: 'standard', rate: 16, label: 'Tasa general' },
      { key: 'food', rate: 0, label: 'Alimentos básicos (tasa cero)' },
      { key: 'food_prepared', rate: 16, label: 'Restauración' },
      { key: 'alcohol', rate: 16, label: 'Bebidas alcohólicas' },
      { key: 'non_alcoholic', rate: 16, label: 'Bebidas no alcohólicas' },
      { key: 'tobacco', rate: 16, label: 'Tabaco' },
      { key: 'services', rate: 16, label: 'Servicios' },
      BONDED_SUPPLY,
    ],
    notes: 'Border zones (north + south) have reduced 8% rate. Override for Quintana Roo / Baja California operations.',
  },
  PA: {
    iso2: 'PA', name: 'Panama',
    taxSystem: 'vat', taxName: 'ITBMS', defaultCurrency: 'PAB',
    categories: [
      { key: 'standard', rate: 7, label: 'Tasa general' },
      { key: 'food', rate: 0, label: 'Alimentos básicos' },
      { key: 'food_prepared', rate: 7, label: 'Restauración' },
      { key: 'alcohol', rate: 10, label: 'Bebidas alcohólicas' },
      { key: 'non_alcoholic', rate: 7, label: 'Bebidas no alcohólicas' },
      { key: 'tobacco', rate: 15, label: 'Tabaco' },
      { key: 'services', rate: 7, label: 'Servicios' },
      BONDED_SUPPLY,
    ],
  },
  BR: {
    iso2: 'BR', name: 'Brazil',
    taxSystem: 'vat', taxName: 'ICMS/IPI/PIS/COFINS', defaultCurrency: 'BRL',
    categories: [
      { key: 'standard', rate: 17, label: 'ICMS (state-dependent — typical)' },
      { key: 'food', rate: 7, label: 'Food (basic)' },
      { key: 'food_prepared', rate: 17, label: 'Prepared food' },
      { key: 'alcohol', rate: 25, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 17, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 25, label: 'Tobacco' },
      { key: 'services', rate: 17, label: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'Brazil has the most complex tax system in the world. Rates shown are illustrative — supplier must verify with their accountant.',
  },
  // ── Asia-Pacific ──────────────────────────────────────────────
  AU: {
    iso2: 'AU', name: 'Australia',
    taxSystem: 'gst', taxName: 'GST', defaultCurrency: 'AUD',
    categories: [
      { key: 'standard', rate: 10, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (GST-free)' },
      { key: 'food_prepared', rate: 10, label: 'Prepared food' },
      { key: 'alcohol', rate: 10, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 10, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 10, label: 'Tobacco' },
      { key: 'services', rate: 10, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  NZ: {
    iso2: 'NZ', name: 'New Zealand',
    taxSystem: 'gst', taxName: 'GST', defaultCurrency: 'NZD',
    categories: [
      { key: 'standard', rate: 15, label: 'Standard rate' },
      { key: 'food', rate: 15, label: 'Food (no exemption)' },
      { key: 'food_prepared', rate: 15, label: 'Prepared food' },
      { key: 'alcohol', rate: 15, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 15, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 15, label: 'Tobacco' },
      { key: 'services', rate: 15, label: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'NZ GST applies uniformly with no reduced rates.',
  },
  JP: {
    iso2: 'JP', name: 'Japan',
    taxSystem: 'consumption_tax', taxName: '消費税 (Shōhizei)', defaultCurrency: 'JPY',
    categories: [
      { key: 'standard', rate: 10, label: 'Standard rate' },
      { key: 'food', rate: 8, label: 'Food (reduced rate)' },
      { key: 'food_prepared', rate: 10, label: 'Prepared food (eat-in)' },
      { key: 'alcohol', rate: 10, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 8, label: 'Non-alcoholic drinks (takeaway)' },
      { key: 'tobacco', rate: 10, label: 'Tobacco' },
      { key: 'services', rate: 10, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  HK: {
    iso2: 'HK', name: 'Hong Kong',
    taxSystem: 'none', taxName: 'No VAT', defaultCurrency: 'HKD',
    categories: [
      { key: 'standard', rate: 0, label: 'No VAT' },
      { key: 'food', rate: 0, label: 'Food' },
      { key: 'food_prepared', rate: 0, label: 'Prepared food' },
      { key: 'alcohol', rate: 0, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 0, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 0, label: 'Tobacco (excise applies)' },
      { key: 'services', rate: 0, label: 'Services' },
    ],
    notes: 'Hong Kong has no VAT, GST, or sales tax. Excise duties apply on alcohol, tobacco, hydrocarbon oil, methyl alcohol.',
  },
  SG: {
    iso2: 'SG', name: 'Singapore',
    taxSystem: 'gst', taxName: 'GST', defaultCurrency: 'SGD',
    categories: [
      { key: 'standard', rate: 9, label: 'Standard rate' },
      { key: 'food', rate: 9, label: 'Food' },
      { key: 'food_prepared', rate: 9, label: 'Prepared food' },
      { key: 'alcohol', rate: 9, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 9, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 9, label: 'Tobacco' },
      { key: 'services', rate: 9, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  TH: {
    iso2: 'TH', name: 'Thailand',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'THB',
    categories: [
      { key: 'standard', rate: 7, label: 'Standard rate' },
      { key: 'food', rate: 7, label: 'Food' },
      { key: 'food_prepared', rate: 7, label: 'Prepared food' },
      { key: 'alcohol', rate: 7, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 7, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 7, label: 'Tobacco' },
      { key: 'services', rate: 7, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  ID: {
    iso2: 'ID', name: 'Indonesia',
    taxSystem: 'vat', taxName: 'PPN', defaultCurrency: 'IDR',
    categories: [
      { key: 'standard', rate: 11, label: 'Standard rate' },
      { key: 'food', rate: 11, label: 'Food' },
      { key: 'food_prepared', rate: 11, label: 'Prepared food' },
      { key: 'alcohol', rate: 11, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 11, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 11, label: 'Tobacco' },
      { key: 'services', rate: 11, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  PH: {
    iso2: 'PH', name: 'Philippines',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'PHP',
    categories: [
      { key: 'standard', rate: 12, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (VAT-exempt)' },
      { key: 'food_prepared', rate: 12, label: 'Prepared food' },
      { key: 'alcohol', rate: 12, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 12, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 12, label: 'Tobacco' },
      { key: 'services', rate: 12, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  // ── Middle East / GCC ─────────────────────────────────────────
  AE: {
    iso2: 'AE', name: 'United Arab Emirates',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'AED',
    categories: [
      { key: 'standard', rate: 5, label: 'Standard rate' },
      { key: 'food', rate: 5, label: 'Food' },
      { key: 'food_prepared', rate: 5, label: 'Prepared food' },
      { key: 'alcohol', rate: 5, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 5, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 5, label: 'Tobacco' },
      { key: 'services', rate: 5, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  SA: {
    iso2: 'SA', name: 'Saudi Arabia',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'SAR',
    categories: [
      { key: 'standard', rate: 15, label: 'Standard rate' },
      { key: 'food', rate: 15, label: 'Food' },
      { key: 'food_prepared', rate: 15, label: 'Prepared food' },
      { key: 'non_alcoholic', rate: 15, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 15, label: 'Tobacco' },
      { key: 'services', rate: 15, label: 'Services' },
      BONDED_SUPPLY,
    ],
    notes: 'Alcohol sales prohibited. No alcohol category.',
  },
  QA: {
    iso2: 'QA', name: 'Qatar',
    taxSystem: 'none', taxName: 'No VAT (planned)', defaultCurrency: 'QAR',
    categories: [
      { key: 'standard', rate: 0, label: 'No VAT' },
      { key: 'food', rate: 0, label: 'Food' },
      { key: 'food_prepared', rate: 0, label: 'Prepared food' },
      { key: 'non_alcoholic', rate: 0, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 0, label: 'Tobacco (excise applies)' },
      { key: 'services', rate: 0, label: 'Services' },
    ],
    notes: 'Qatar VAT planned but not yet implemented as of 2026.',
  },
  // ── Africa ────────────────────────────────────────────────────
  ZA: {
    iso2: 'ZA', name: 'South Africa',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'ZAR',
    categories: [
      { key: 'standard', rate: 15, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (zero-rated)' },
      { key: 'food_prepared', rate: 15, label: 'Prepared food' },
      { key: 'alcohol', rate: 15, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 15, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 15, label: 'Tobacco' },
      { key: 'services', rate: 15, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  SC: {
    iso2: 'SC', name: 'Seychelles',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'SCR',
    categories: [
      { key: 'standard', rate: 15, label: 'Standard rate' },
      { key: 'food', rate: 15, label: 'Food' },
      { key: 'food_prepared', rate: 15, label: 'Prepared food' },
      { key: 'alcohol', rate: 15, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 15, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 15, label: 'Tobacco' },
      { key: 'services', rate: 15, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  MU: {
    iso2: 'MU', name: 'Mauritius',
    taxSystem: 'vat', taxName: 'VAT', defaultCurrency: 'MUR',
    categories: [
      { key: 'standard', rate: 15, label: 'Standard rate' },
      { key: 'food', rate: 0, label: 'Basic food (zero-rated)' },
      { key: 'food_prepared', rate: 15, label: 'Prepared food' },
      { key: 'alcohol', rate: 15, label: 'Alcohol' },
      { key: 'non_alcoholic', rate: 15, label: 'Non-alcoholic drinks' },
      { key: 'tobacco', rate: 15, label: 'Tobacco' },
      { key: 'services', rate: 15, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
  MA: {
    iso2: 'MA', name: 'Morocco',
    taxSystem: 'vat', taxName: 'TVA', defaultCurrency: 'MAD',
    categories: [
      { key: 'standard', rate: 20, label: 'Taux normal' },
      { key: 'food', rate: 10, label: 'Alimentation' },
      { key: 'food_prepared', rate: 10, label: 'Restauration' },
      { key: 'alcohol', rate: 20, label: 'Alcool' },
      { key: 'non_alcoholic', rate: 14, label: 'Boissons non alcoolisées' },
      { key: 'tobacco', rate: 20, label: 'Tabac' },
      { key: 'services', rate: 20, label: 'Services' },
      BONDED_SUPPLY,
    ],
  },
};

// Helper: get a country preset, with fallback for unknown countries
export function getCountryTaxPreset(iso2: string | null | undefined): CountryTaxPreset | null {
  if (!iso2) return null;
  return COUNTRY_TAX_PRESETS[iso2.toUpperCase()] ?? null;
}

// Helper: list all supported countries (alphabetical)
export function listSupportedCountries(): Array<{ iso2: string; name: string }> {
  return Object.values(COUNTRY_TAX_PRESETS)
    .map(p => ({ iso2: p.iso2, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
