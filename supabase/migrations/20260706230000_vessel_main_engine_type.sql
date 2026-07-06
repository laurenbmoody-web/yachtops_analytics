-- Free-text main-engine make/model for a vessel (e.g. "2 x MTU 16V 2000 M96").
-- Feeds the PYA Sea Service Testimonial "Type of Main Engine" field, and sits
-- alongside propulsion_kw in vessel settings.
alter table public.vessels add column if not exists main_engine_type text;
