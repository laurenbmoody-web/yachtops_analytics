-- Supplier ratings — any crew member can rate a marketplace supplier.
--
-- One rating per user per supplier (editable). Ratings are aggregated
-- platform-wide (like a marketplace review), so the average reflects
-- every yacht's experience, not just yours. Writes go through
-- rate_supplier(); the average + your own rating come back via
-- get_supplier_ratings().

create table if not exists public.supplier_reviews (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.supplier_profiles(id) on delete cascade,
  tenant_id   uuid not null,
  user_id     uuid not null default auth.uid(),
  rating      int  not null check (rating between 1 and 5),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (supplier_id, user_id)
);

alter table public.supplier_reviews enable row level security;
-- A member may read their own rows; aggregates come from the SECURITY
-- DEFINER RPC. Writes flow only through rate_supplier() (no insert policy).
drop policy if exists sr_select_own on public.supplier_reviews;
create policy sr_select_own on public.supplier_reviews
  for select to authenticated using (user_id = auth.uid());

create or replace function public.rate_supplier(p_supplier_id uuid, p_rating int, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_tenant uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;
  select tm.tenant_id into v_tenant
  from public.tenant_members tm
  where tm.user_id = auth.uid() and tm.active = true
  limit 1;
  if v_tenant is null then
    raise exception 'not an active crew member';
  end if;
  insert into public.supplier_reviews (supplier_id, tenant_id, user_id, rating, note)
  values (p_supplier_id, v_tenant, auth.uid(), p_rating, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (supplier_id, user_id)
  do update set rating = excluded.rating, note = excluded.note, updated_at = now();
end;
$$;

grant execute on function public.rate_supplier(uuid, int, text) to authenticated;

create or replace function public.get_supplier_ratings()
returns table (
  supplier_id  uuid,
  avg_rating   numeric,
  rating_count bigint,
  my_rating    int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.supplier_id,
    round(avg(r.rating)::numeric, 1)                      as avg_rating,
    count(*)::bigint                                      as rating_count,
    (max(r.rating) filter (where r.user_id = auth.uid()))::int as my_rating
  from public.supplier_reviews r
  where exists (
    select 1 from public.tenant_members tm
    where tm.user_id = auth.uid() and tm.active = true
  )
  group by r.supplier_id;
$$;

grant execute on function public.get_supplier_ratings() to authenticated;

comment on table public.supplier_reviews is
  'Crew ratings of marketplace suppliers (1-5, one per user per supplier). Aggregated platform-wide by get_supplier_ratings(); written via rate_supplier().';
