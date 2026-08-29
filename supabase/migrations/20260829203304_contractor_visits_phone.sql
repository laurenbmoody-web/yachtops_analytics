-- Emergency contact number for a signed-in visitor, so the boat can reach them.
alter table public.contractor_visits add column if not exists phone text;
