-- Cargo Accounts — Ledger Part B (statement import & reconciliation).

-- A statement someone uploaded to reconcile against the ledger.
create table if not exists public.imported_statements (
  id           uuid default gen_random_uuid() primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  account_id   uuid references public.financial_accounts(id) on delete set null,
  source       text not null default 'bank' check (source in ('bank','card','voly','xero','other')),
  period_start date,
  period_end   date,
  file_path    text,
  file_name    text,
  status       text not null default 'parsing' check (status in ('parsing','ready','reconciled')),
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- One parsed row from the statement.
create table if not exists public.statement_lines (
  id             uuid default gen_random_uuid() primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  statement_id   uuid not null references public.imported_statements(id) on delete cascade,
  line_date      date,
  description    text,
  amount         numeric(14,2) not null,
  currency       text not null default 'EUR',
  external_ref   text,
  raw            jsonb,
  match_status   text not null default 'unmatched'
                 check (match_status in ('matched','missing','unconfirmed','review','ignored','unmatched')),
  matched_txn_id uuid references public.ledger_transactions(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_statement_lines_statement on public.statement_lines(statement_id);
create index if not exists idx_statement_lines_tenant on public.statement_lines(tenant_id);

-- Mark a ledger row as reconciled to a statement line.
alter table public.ledger_transactions add column if not exists reconciled_at timestamptz;

-- updated_at triggers (per-table convention).
create or replace function public.handle_imported_statements_updated_at()
  returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists set_imported_statements_updated_at on public.imported_statements;
create trigger set_imported_statements_updated_at before update on public.imported_statements
  for each row execute function public.handle_imported_statements_updated_at();

create or replace function public.handle_statement_lines_updated_at()
  returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists set_statement_lines_updated_at on public.statement_lines;
create trigger set_statement_lines_updated_at before update on public.statement_lines
  for each row execute function public.handle_statement_lines_updated_at();

-- RLS — tenant-scoped select/insert/update; COMMAND-only delete (both tables).
alter table public.imported_statements enable row level security;
alter table public.statement_lines enable row level security;

drop policy if exists imported_statements_select on public.imported_statements;
create policy imported_statements_select on public.imported_statements for select
  using (public.is_active_tenant_member(tenant_id, auth.uid()));
drop policy if exists imported_statements_insert on public.imported_statements;
create policy imported_statements_insert on public.imported_statements for insert
  with check (public.is_active_tenant_member(tenant_id, auth.uid()));
drop policy if exists imported_statements_update on public.imported_statements;
create policy imported_statements_update on public.imported_statements for update
  using (public.is_active_tenant_member(tenant_id, auth.uid()))
  with check (public.is_active_tenant_member(tenant_id, auth.uid()));
drop policy if exists imported_statements_delete on public.imported_statements;
create policy imported_statements_delete on public.imported_statements for delete
  using (exists (select 1 from public.tenant_members tm
    where tm.tenant_id = imported_statements.tenant_id and tm.user_id = auth.uid()
      and tm.active is not false and tm.permission_tier = 'COMMAND'));

drop policy if exists statement_lines_select on public.statement_lines;
create policy statement_lines_select on public.statement_lines for select
  using (public.is_active_tenant_member(tenant_id, auth.uid()));
drop policy if exists statement_lines_insert on public.statement_lines;
create policy statement_lines_insert on public.statement_lines for insert
  with check (public.is_active_tenant_member(tenant_id, auth.uid()));
drop policy if exists statement_lines_update on public.statement_lines;
create policy statement_lines_update on public.statement_lines for update
  using (public.is_active_tenant_member(tenant_id, auth.uid()))
  with check (public.is_active_tenant_member(tenant_id, auth.uid()));
drop policy if exists statement_lines_delete on public.statement_lines;
create policy statement_lines_delete on public.statement_lines for delete
  using (exists (select 1 from public.tenant_members tm
    where tm.tenant_id = statement_lines.tenant_id and tm.user_id = auth.uid()
      and tm.active is not false and tm.permission_tier = 'COMMAND'));

-- Private storage bucket for the uploaded statement files.
insert into storage.buckets (id, name, public)
  values ('statement-imports', 'statement-imports', false)
  on conflict (id) do nothing;
drop policy if exists "statement_imports_read" on storage.objects;
create policy "statement_imports_read" on storage.objects for select to authenticated using (bucket_id = 'statement-imports');
drop policy if exists "statement_imports_insert" on storage.objects;
create policy "statement_imports_insert" on storage.objects for insert to authenticated with check (bucket_id = 'statement-imports');
drop policy if exists "statement_imports_delete" on storage.objects;
create policy "statement_imports_delete" on storage.objects for delete to authenticated using (bucket_id = 'statement-imports');
