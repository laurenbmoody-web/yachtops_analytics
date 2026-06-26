-- Per-ship Testimonial of Sea Service PDFs, generated on sign and stored
-- privately. The path is stamped onto each signed entry so the log / Step 03
-- can offer "View testimonial"; the file is reached only via a short-lived
-- signed URL minted by the get-seatime-testimonial edge function.
alter table public.sea_service_entries add column if not exists testimonial_path text;

-- Private bucket — no public read; access is via signed URLs only.
insert into storage.buckets (id, name, public)
values ('sea-service-testimonials', 'sea-service-testimonials', false)
on conflict (id) do nothing;
