-- Nautilus/PYA membership number on the crew member's personal details (a stable
-- personal identifier, like their discharge book — entered once, reused on every
-- testimonial export), and propulsion power (kW) on the vessel for engineer
-- testimonials. Both feed the Nautilus "Sea and Onboard Service Testimonial".
alter table public.crew_personal_details add column if not exists verifier_membership_number text;
alter table public.vessels             add column if not exists propulsion_kw numeric;
