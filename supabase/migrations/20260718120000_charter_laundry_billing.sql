-- Charter laundry billing.
--
-- Under a MYBA "plus expenses" charter, guests' personal laundry is charged at
-- cost; under a CYBA inclusive charter nothing is billed. These fields carry
-- the config and the per-item charge.

-- Vessel-level config for how laundry is billed on plus-expenses charters:
--   { scope: 'shoreside' | 'all',            -- shore-sent only, or all guest items
--     pricing: 'pricelist' | 'flat' | 'manual',
--     flat_rate: number,
--     currency: 'EUR' | 'GBP' | 'USD',
--     price_list: [{ label, price }] }
alter table public.vessels add column if not exists laundry_billing jsonb;

-- Per-charter billing basis: 'inclusive' (default, nothing billed) or
-- 'plus_expenses' (MYBA — guest laundry billable).
alter table public.trips add column if not exists billing_basis text not null default 'inclusive';

-- The charge applied to a billable guest laundry item (in the vessel currency).
alter table public.laundry_items add column if not exists charge numeric;
