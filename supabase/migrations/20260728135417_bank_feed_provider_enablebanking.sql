-- Enable Banking is the first live provider (GoCardless Bank Account Data closed
-- to new signups in 2025). Add it to the provider set and make it the default.
ALTER TABLE public.bank_connections DROP CONSTRAINT IF EXISTS bank_connections_provider_check;
ALTER TABLE public.bank_connections ADD CONSTRAINT bank_connections_provider_check
  CHECK (provider IN ('enablebanking','gocardless','truelayer','tink','saltedge','soldo','centtrip'));
ALTER TABLE public.bank_connections ALTER COLUMN provider SET DEFAULT 'enablebanking';
