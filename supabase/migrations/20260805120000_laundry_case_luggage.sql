-- Per-person luggage: a laundry_case becomes a person's bag. Adds the owner
-- association (guest or the generic owner), the cabin it's packed in, and a
-- details jsonb that carries the exterior + interior (packing reference) photos.
alter table public.laundry_cases
  add column if not exists owner_type text,
  add column if not exists owner_guest_id uuid,
  add column if not exists cabin text,
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists laundry_cases_owner_guest_idx
  on public.laundry_cases (tenant_id, owner_guest_id);
