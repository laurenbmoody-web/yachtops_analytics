-- Call sign and classification/notation belong on the vessel record (they're
-- static per ship), not typed into every crew list. Add them to vessels so
-- Vessel Settings can hold them and the crew list pulls them automatically.
alter table public.vessels add column if not exists call_sign text;
alter table public.vessels add column if not exists class_notation text;

comment on column public.vessels.call_sign is 'Radio call sign — shown on the official crew list.';
comment on column public.vessels.class_notation is 'Classification society + notation (e.g. 100A1 SSC Yacht Mono) — shown on the official crew list.';
