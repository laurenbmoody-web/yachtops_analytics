-- Allow fractional horizontal positions for the org chart, so two people can be
-- dragged close together (a deliberate pair sharing one line from above) versus
-- normally spaced apart (separate branches) — the connector-line renderer reads
-- this closeness to decide whether to merge them under one trunk line.
alter table public.tenant_members
  alter column org_order type double precision using org_order::double precision;
