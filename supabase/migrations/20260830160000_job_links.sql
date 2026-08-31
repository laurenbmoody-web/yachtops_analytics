-- What a job is about: the stock it consumes, the equipment it services.
--
-- A job title is a sentence. "Descale the ice maker" does not tell you which
-- ice maker, and "replace the filters" does not take the filters off the shelf.
-- This is the join that makes a job point at a real thing on the vessel, and it
-- carries the three behaviours that follow from that:
--
--   qty          how much of a stock item the job consumes. Completing the job
--                deducts it and writes an inventory_movements row.
--   consumed_at  set at the moment that deduction happened. It is what makes
--                the deduction exactly-once — completing an already-consumed
--                link is a no-op — and what lets reopening the job put the
--                stock back precisely, rather than guessing.
--   kind         'inventory' or 'equipment'. Both are modelled from the start
--                so the equipment register slots in without a second migration,
--                even though nothing populates that register yet.
--
-- One row per thing a job points at, so a job can consume three parts and
-- service one machine.

create table if not exists public.job_links (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  job_id            uuid not null references public.team_jobs(id) on delete cascade,
  kind              text not null check (kind in ('inventory', 'equipment')),
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  equipment_id      uuid references public.equipment(id) on delete cascade,
  qty               numeric,
  consumed_at       timestamptz,
  consumed_by       uuid,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- The kind and the populated column must agree, and exactly one target is
  -- set. Without this a row can claim to be inventory while pointing at a
  -- machine, and every reader downstream has to defend against it.
  constraint job_links_target_matches_kind check (
    (kind = 'inventory' and inventory_item_id is not null and equipment_id is null)
    or
    (kind = 'equipment' and equipment_id is not null and inventory_item_id is null)
  ),
  -- Consuming stock is only meaningful for a positive quantity.
  constraint job_links_qty_positive check (qty is null or qty > 0)
);

-- The same item must not be linked to the same job twice: two rows would each
-- deduct on completion and silently double the consumption.
create unique index if not exists job_links_job_inventory_uniq
  on public.job_links (job_id, inventory_item_id)
  where inventory_item_id is not null;
create unique index if not exists job_links_job_equipment_uniq
  on public.job_links (job_id, equipment_id)
  where equipment_id is not null;

-- "What is this job about" — read on every job the modal opens.
create index if not exists job_links_job_idx on public.job_links (job_id);

-- "What has ever been done to this thing" — the service history, read from the
-- item's own page.
create index if not exists job_links_inventory_idx
  on public.job_links (tenant_id, inventory_item_id)
  where inventory_item_id is not null;
create index if not exists job_links_equipment_idx
  on public.job_links (tenant_id, equipment_id)
  where equipment_id is not null;

alter table public.job_links enable row level security;

-- Any active member of the tenant, matching duty_task_progress: the crew member
-- doing the job is the one who links the part they used. Case-insensitive on
-- status, because the column holds lowercase 'active' and an exact 'ACTIVE'
-- comparison is what silently broke duty_set_templates.
create policy job_links_select on public.job_links
  for select using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_links_insert on public.job_links
  for insert with check (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_links_update on public.job_links
  for update using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );

create policy job_links_delete on public.job_links
  for delete using (
    tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true and upper(tm.status) = 'ACTIVE'
    )
  );
