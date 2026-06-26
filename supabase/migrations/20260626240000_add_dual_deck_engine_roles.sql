-- Dual deck+engine yacht roles (small-vessel combined capacity). Service in a
-- dual capacity counts at 50% toward each Certificate of Competency (MSN 1858
-- §5.1). Placed in the Deck department (deck-primary); the 50% sea-time accrual
-- is handled in the app's pathways engine. Default permission tier CREW
-- (least-privilege) — elevate per assignment if the role is an officer.
insert into public.roles (name, department_id, default_permission_tier)
select v.name, 'ed5eb7f2-14d3-4084-910d-409e184f23df'::uuid, 'CREW'
from (values ('Mate/Engineer'), ('Deck/Engineer')) as v(name)
where not exists (select 1 from public.roles r where r.name = v.name);
