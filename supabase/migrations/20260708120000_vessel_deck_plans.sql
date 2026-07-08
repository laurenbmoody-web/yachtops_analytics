-- 20260708120000_vessel_deck_plans.sql
--
-- Full-vessel layout, phase 1: lay the decks/zones/spaces tree onto the real
-- General Arrangement drawings.
--
--   - vessel_layout: one GA image per vessel (tenant). Uploaded once; the deck
--     frames and room positions below are all relative to it, so swapping in a
--     crisper drawing later never disturbs the placements.
--   - vessel_locations.plan_crop (deck rows): the {x,y,w,h} frame (0..1 of the
--     GA image) that isolates this deck's band on the combined sheet.
--   - vessel_locations.plan_x / plan_y (space rows): the room's position, 0..1
--     within its deck's crop. Null = not placed yet (lives in the tray).

create table if not exists public.vessel_layout (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ga_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vessel_layout enable row level security;

-- Any active member of the vessel may read the layout.
create policy vessel_layout_member_read on public.vessel_layout
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = vessel_layout.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true));

-- Command / Chief may create + edit it.
create policy vessel_layout_command_write on public.vessel_layout
  for all to authenticated
  using (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = vessel_layout.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true
       and tm.permission_tier = any (array['COMMAND','CHIEF'])))
  with check (exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = vessel_layout.tenant_id
       and tm.user_id = auth.uid()
       and tm.active = true
       and tm.permission_tier = any (array['COMMAND','CHIEF'])));

alter table public.vessel_locations
  add column if not exists plan_crop jsonb,   -- deck:  {x,y,w,h} in 0..1 of the GA image
  add column if not exists plan_x numeric,    -- space: 0..1 within the deck's crop
  add column if not exists plan_y numeric;

comment on table public.vessel_layout is
  'Per-vessel General Arrangement backdrop for the deck-plan layout. Deck frames (vessel_locations.plan_crop) and room positions (plan_x/plan_y) are relative to this image.';
comment on column public.vessel_locations.plan_crop is
  'Deck rows only: {x,y,w,h} (0..1) framing this deck on the shared GA image.';
comment on column public.vessel_locations.plan_x is
  'Space rows only: 0..1 horizontal position within the deck crop. Null = unplaced.';
comment on column public.vessel_locations.plan_y is
  'Space rows only: 0..1 vertical position within the deck crop. Null = unplaced.';
