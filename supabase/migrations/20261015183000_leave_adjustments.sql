-- Leave adjustments, and a carry-over policy per vessel.
--
-- The balance computed from accrual minus logged status changes is a derived
-- number, and derived numbers need a way to be corrected. Without one, any
-- disagreement about someone's leave has nowhere to go — which matters here
-- because these days get paid out.
--
-- WHY A SIGNED LEDGER RATHER THAN AN EDITABLE BALANCE
-- The obvious shortcut is a `leave_balance_override` column someone types a new
-- number into. That loses the reason and the history: a year later nobody can
-- say why the figure is what it is, and an owner's audit has nothing to read.
-- So adjustments are append-only rows, each with a signed day count, a kind, an
-- effective date and an author. The balance is the sum, and the trail survives.
--
-- SIGN CONVENTION, stated once: POSITIVE adds days to the entitlement, NEGATIVE
-- takes them away. So days bought out are negative, an opening balance brought
-- in from another system is positive, and a correction is whichever it needs.
--
-- CARRY-OVER IS OPT-IN, and the default changes nothing
-- leave_year_anchor defaults to 'none', which means one continuous accrual from
-- the contract start — exactly how the balance already behaves. A vessel that
-- wants a leave year sets the anchor, and only then does a cap mean anything.
-- Nothing is forfeited unless a vessel explicitly asks for it: silently deleting
-- someone's accrued leave because of an unconfigured default would be the worst
-- possible failure mode for this feature.

-- ── vessel policy ───────────────────────────────────────────────────────────
alter table public.vessels
  add column if not exists leave_year_anchor text not null default 'none',
  add column if not exists leave_carry_over_max_days numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vessels_leave_year_anchor_chk'
  ) then
    alter table public.vessels
      add constraint vessels_leave_year_anchor_chk
      check (leave_year_anchor in ('none', 'contract', 'calendar'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'vessels_leave_carry_over_chk'
  ) then
    alter table public.vessels
      add constraint vessels_leave_carry_over_chk
      check (leave_carry_over_max_days is null or leave_carry_over_max_days >= 0);
  end if;
end $$;

comment on column public.vessels.leave_year_anchor is
  'none = one continuous accrual from the contract start (default); contract = reset on the start-date anniversary; calendar = reset 1 January.';
comment on column public.vessels.leave_carry_over_max_days is
  'Most days that may carry into the next leave year. NULL = no limit. Only meaningful when leave_year_anchor is not none.';

-- ── the adjustment ledger ───────────────────────────────────────────────────
create table if not exists public.crew_leave_adjustments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,

  -- Signed: positive grants days, negative removes them. Never zero — a
  -- zero-day adjustment is a note, and there is a column for that.
  days           numeric not null check (days <> 0),

  -- What kind of correction this is, so the card can explain itself and a
  -- report can separate a buy-out from a clerical fix.
  kind           text not null check (kind in (
                   'opening_balance',  -- brought in from before Cargo / another vessel
                   'bought_out',       -- paid instead of taken (negative)
                   'granted',          -- extra days agreed (positive)
                   'unpaid',           -- unpaid leave taken (negative)
                   'correction'        -- clerical fix, either direction
                 )),

  -- Which leave year it lands in, and the date a reader will recognise.
  effective_date date not null,

  -- Not optional. An adjustment without a reason is unauditable, and this is
  -- the field someone will be asked about a year later.
  reason         text not null check (length(btrim(reason)) > 0),

  created_by     uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at     timestamptz not null default now()
);

comment on table public.crew_leave_adjustments is
  'Append-only corrections to a crew member''s leave entitlement. Positive grants days, negative removes them.';

create index if not exists crew_leave_adjustments_lookup
  on public.crew_leave_adjustments (tenant_id, user_id, effective_date);

alter table public.crew_leave_adjustments enable row level security;

-- Each policy is dropped first because Postgres has no CREATE POLICY IF NOT
-- EXISTS: without the guard this migration aborts the moment a policy is
-- already present, which is what happens whenever the schema was applied ahead
-- of the deploy. Every other statement here is already idempotent.

-- A crew member can see every adjustment made to their own leave. That is
-- deliberate: these change what they are owed, so finding out about one after
-- the fact would be worse than the correction itself.
drop policy if exists crew_leave_adj_select on public.crew_leave_adjustments;
create policy crew_leave_adj_select on public.crew_leave_adjustments
  for select using (
    user_id = auth.uid() or public.is_tenant_command(tenant_id)
  );

-- Only Command writes. Leave adjustments have a payroll consequence.
drop policy if exists crew_leave_adj_insert on public.crew_leave_adjustments;
create policy crew_leave_adj_insert on public.crew_leave_adjustments
  for insert with check (public.is_tenant_command(tenant_id));

-- No UPDATE policy — the ledger is append-only, so a mistake is corrected by
-- posting the opposite entry rather than quietly rewriting history.
drop policy if exists crew_leave_adj_delete on public.crew_leave_adjustments;
create policy crew_leave_adj_delete on public.crew_leave_adjustments
  for delete using (public.is_tenant_command(tenant_id));
