-- Adds invoicing-related fields to supplier_profiles.

ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS business_country text,           -- ISO 2-letter (e.g. 'FR')
  ADD COLUMN IF NOT EXISTS business_address_line1 text,
  ADD COLUMN IF NOT EXISTS business_address_line2 text,
  ADD COLUMN IF NOT EXISTS business_city text,
  ADD COLUMN IF NOT EXISTS business_postal_code text,
  ADD COLUMN IF NOT EXISTS business_state_region text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS company_registration_number text,
  ADD COLUMN IF NOT EXISTS default_currency text DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS bank_details jsonb DEFAULT '{}'::jsonb,
  -- bank_details shape: {account_name, iban, bic_swift, bank_name, sort_code, account_number}
  ADD COLUMN IF NOT EXISTS vat_categories_enabled jsonb DEFAULT '[]'::jsonb,
  -- array of category keys: ["standard", "food", "alcohol", "bonded", ...]
  ADD COLUMN IF NOT EXISTS vat_categories_overrides jsonb DEFAULT '{}'::jsonb,
  -- {category_key: override_rate} e.g. {"alcohol": 22}
  ADD COLUMN IF NOT EXISTS vat_categories_custom jsonb DEFAULT '[]'::jsonb,
  -- supplier-defined extra categories: [{key, rate, label}]
  ADD COLUMN IF NOT EXISTS invoice_number_prefix text DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS invoice_number_format text DEFAULT '{prefix}-{YYYY}-{####}',
  -- supports tokens: {prefix}, {YYYY}, {YY}, {MM}, {####} (zero-padded counter)
  ADD COLUMN IF NOT EXISTS invoice_number_counter integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_payment_terms_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS invoice_footer_terms text,
  ADD COLUMN IF NOT EXISTS invoice_logo_url text;
  -- separate from logo_url which may be used for portal display

COMMENT ON COLUMN public.supplier_profiles.vat_categories_enabled IS
  'Array of TaxCategoryKey values the supplier has enabled for invoicing.';
COMMENT ON COLUMN public.supplier_profiles.vat_categories_overrides IS
  'Per-category rate overrides keyed by TaxCategoryKey. Overrides the country preset rate.';
COMMENT ON COLUMN public.supplier_profiles.invoice_number_format IS
  'Format string for sequential invoice numbers. Tokens: {prefix} {YYYY} {YY} {MM} {####}';
