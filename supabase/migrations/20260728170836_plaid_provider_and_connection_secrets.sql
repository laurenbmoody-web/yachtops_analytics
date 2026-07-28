-- Plaid becomes the live bank-feed provider (UK + EU coverage). Add it to the set.
ALTER TABLE public.bank_connections DROP CONSTRAINT IF EXISTS bank_connections_provider_check;
ALTER TABLE public.bank_connections ADD CONSTRAINT bank_connections_provider_check
  CHECK (provider IN ('plaid','enablebanking','gocardless','truelayer','tink','saltedge','soldo','centtrip'));
ALTER TABLE public.bank_connections ALTER COLUMN provider SET DEFAULT 'plaid';

-- Server-only secrets for a connection (e.g. the Plaid access_token + sync cursor).
-- NOT readable by app users: RLS is enabled with NO policies, which denies all
-- authenticated/anon access; only the service role (used by the edge function)
-- bypasses RLS and can touch this table. Access tokens never reach the browser.
CREATE TABLE IF NOT EXISTS public.bank_connection_secrets (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id uuid        NOT NULL UNIQUE REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  provider      text        NOT NULL,
  access_token  text,
  item_id       text,
  cursor        text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE public.bank_connection_secrets ENABLE ROW LEVEL SECURITY;
-- (intentionally no policies — service_role only)

CREATE OR REPLACE FUNCTION public.handle_bank_connection_secrets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_bank_connection_secrets_updated_at ON public.bank_connection_secrets;
CREATE TRIGGER set_bank_connection_secrets_updated_at
  BEFORE UPDATE ON public.bank_connection_secrets
  FOR EACH ROW EXECUTE FUNCTION public.handle_bank_connection_secrets_updated_at();
