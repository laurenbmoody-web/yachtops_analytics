-- Vessel/owner logo, embedded in the page header of contracts generated from
-- AI-rebuilt (PDF-sourced) templates. Stored as a public URL in the
-- vessel-assets bucket, same as the dashboard hero image.
alter table public.vessels add column if not exists logo_url text;
comment on column public.vessels.logo_url is 'Vessel/owner logo (public URL in vessel-assets) embedded in the header of contracts generated from rebuilt templates.';
