-- Optional secondary bank account for split-payment crew. Mirrors the primary
-- account fields plus a split rule (percentage of net, or a fixed amount).
-- Stored as a single jsonb blob so it inherits the same RLS as the rest of the
-- crew_banking row (owner + COMMAND only) without widening the column list.
-- Shape: { accountHolder, bankName, accountNumber, swiftBic, currency, country,
--          accountType, sortCode, routingNumber, addressLine1, addressLine2,
--          city, addressCountry, splitType, splitValue }
alter table public.crew_banking add column if not exists secondary_account jsonb not null default '{}'::jsonb;
comment on column public.crew_banking.secondary_account is 'Optional second account for split payments (same fields as primary + splitType/splitValue).';
