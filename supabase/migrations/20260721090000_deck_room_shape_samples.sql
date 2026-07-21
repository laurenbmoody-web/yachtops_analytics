-- 20260721090000_deck_room_shape_samples.sql
--
-- Training-data capture for a future class-agnostic "room shape" model. Every
-- time the crew finalises a room outline on the deck plan (applies a detect,
-- taps a room, hand-traces one, or reshapes an existing one) we log the polygon
-- against its deck-crop image reference. This quietly banks a dataset of
-- human-perfected room shapes on real yacht GAs as the app is used — so if we
-- ever train a model to propose room *geometry* (never names; the crew's pins
-- carry those), the labelled data already exists. No naming/classification is
-- stored: this is shapes only.
--
-- Append-only: rows are never updated. Re-tracing a room writes a NEW row, so
-- the dataset keeps every version (more examples) and survives room deletion.

create table if not exists public.deck_room_shape_samples (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  deck_location_id uuid references public.vessel_locations(id) on delete set null,
  space_location_id uuid references public.vessel_locations(id) on delete set null,
  ga_image_url text,                        -- source GA image at capture time
  crop jsonb,                               -- deck framing {x,y,w,h} normalized to the full GA
  polygon jsonb not null,                   -- [{x,y}] normalized 0..1 to the crop
  source text,                              -- 'detect_apply' | 'tap' | 'manual' | 'reshape'
  created_at timestamptz not null default now()
);

create index if not exists deck_room_shape_samples_tenant_idx
  on public.deck_room_shape_samples (tenant_id, created_at desc);

alter table public.deck_room_shape_samples enable row level security;

-- Any active member of the vessel may read and append samples (it's their own
-- vessel's plan geometry — non-sensitive, and the same people who edit outlines).
drop policy if exists deck_room_shape_samples_member_read on public.deck_room_shape_samples;
create policy deck_room_shape_samples_member_read on public.deck_room_shape_samples
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = deck_room_shape_samples.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true));

drop policy if exists deck_room_shape_samples_member_insert on public.deck_room_shape_samples;
create policy deck_room_shape_samples_member_insert on public.deck_room_shape_samples
  for insert to authenticated
  with check (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = deck_room_shape_samples.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true));

comment on table public.deck_room_shape_samples is
  'Append-only capture of human-finalised room outlines (shapes only, no names) for a future class-agnostic room-segmentation model. One row per finalised/reshaped outline.';
