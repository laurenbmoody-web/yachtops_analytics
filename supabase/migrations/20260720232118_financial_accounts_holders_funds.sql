-- Cargo Accounts — crew card / holder model on financial_accounts.
--
-- Real vessels don't hold money in a few shared bank accounts: the Captain and
-- each department Chief carry their own prepaid cards, usually one for OWNER
-- funds and one for CHARTER APA, plus a petty-cash float — and each holder
-- reconciles their own at month-end. Command lists these at setup.
--
--   funds_type      owner | charter_apa | general  — which pot the money draws from
--   holder_role     free-text role that owns it (Captain, Chief Engineer, Vessel…);
--                   role-based so it survives crew changes
--   holder_user_id  the crew member currently holding it (for per-user access +
--                   display); nullable, reassigned when crew change
--   card_last4      last 4 of the card, for the card visual / statements
--   provider        card issuer or bank name (display only)
--
-- 'petty_cash' joins the kind enum so a float is distinct from a bank cash box.

ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS funds_type     text NOT NULL DEFAULT 'general'
                                          CHECK (funds_type IN ('owner','charter_apa','general')),
  ADD COLUMN IF NOT EXISTS holder_role    text,
  ADD COLUMN IF NOT EXISTS holder_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS card_last4     text,
  ADD COLUMN IF NOT EXISTS provider       text;

ALTER TABLE public.financial_accounts DROP CONSTRAINT IF EXISTS financial_accounts_kind_check;
ALTER TABLE public.financial_accounts
  ADD CONSTRAINT financial_accounts_kind_check
  CHECK (kind IN ('bank','card','cash','petty_cash'));

CREATE INDEX IF NOT EXISTS idx_financial_accounts_holder_user
  ON public.financial_accounts(holder_user_id) WHERE holder_user_id IS NOT NULL;
