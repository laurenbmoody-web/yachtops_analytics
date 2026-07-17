-- Supplier saved replies (canned messages) — per supplier, shared by the team.
-- The team can read/write their own supplier's templates; get_user_supplier_id()
-- scopes it, same helper the rest of the supplier portal uses.

create table if not exists public.supplier_reply_templates (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.supplier_profiles(id) on delete cascade,
  label       text,
  body        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_srt_supplier on public.supplier_reply_templates (supplier_id, created_at);

alter table public.supplier_reply_templates enable row level security;

drop policy if exists "srt_supplier_all" on public.supplier_reply_templates;
create policy "srt_supplier_all" on public.supplier_reply_templates
  for all
  using (supplier_id = public.get_user_supplier_id())
  with check (supplier_id = public.get_user_supplier_id());
