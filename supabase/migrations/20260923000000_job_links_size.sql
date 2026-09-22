-- A job that uses a size-tracked item has to say which size.
--
-- Uniform and crew kit keep per-size counts inside stock_locations[].sizes and
-- the variants[] rollup. A flat deduction would desync that breakdown, so the
-- Uses toggle refused those items outright — which reads as the toggle being
-- broken on exactly the items crew jobs consume most. With the size recorded
-- on the link, completing the job can take it off the right size, and
-- reopening can put it back where it came from.
--
-- Null for a flat item, and for every link that already exists: those are
-- either not size-tracked or were never allowed to consume in the first place.

alter table public.job_links
  add column if not exists size text;

comment on column public.job_links.size is
  'Which size this link consumes, for items tracked by size. Null for flat items.';
