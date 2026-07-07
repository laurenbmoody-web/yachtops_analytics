-- Marketplace geography — the groundwork for "serves my area" as true
-- distance rather than a name match.
--
-- A shop covers a set of ports (supplier_profiles.coverage_ports) and
-- will travel a service_radius_km around each of them. port_locations
-- gives those port names real coordinates, seeded with the Med yachting
-- circuit. The vessel-side map geocodes the crew's typed area in the
-- browser and keeps the shops whose covered ports fall within their
-- radius of that point.

alter table public.supplier_profiles
  add column if not exists service_radius_km integer not null default 60;

create table if not exists public.port_locations (
  name    text primary key,
  lat     double precision not null,
  lng     double precision not null,
  country text,
  region  text
);

alter table public.port_locations enable row level security;
drop policy if exists port_locations_read on public.port_locations;
create policy port_locations_read on public.port_locations
  for select to authenticated using (true);

insert into public.port_locations (name, lat, lng, country, region) values
  ('Antibes',                43.5808,  7.1251, 'FR', 'French Riviera'),
  ('Cannes',                 43.5528,  7.0174, 'FR', 'French Riviera'),
  ('Monaco',                 43.7384,  7.4246, 'MC', 'French Riviera'),
  ('Nice',                   43.6961,  7.2760, 'FR', 'French Riviera'),
  ('Villefranche-sur-Mer',   43.7041,  7.3080, 'FR', 'French Riviera'),
  ('Saint-Jean-Cap-Ferrat',  43.6870,  7.3300, 'FR', 'French Riviera'),
  ('Beaulieu-sur-Mer',       43.7060,  7.3320, 'FR', 'French Riviera'),
  ('Cap d''Ail',             43.7186,  7.4032, 'FR', 'French Riviera'),
  ('Menton',                 43.7765,  7.5100, 'FR', 'French Riviera'),
  ('Golfe-Juan',             43.5636,  7.0731, 'FR', 'French Riviera'),
  ('Mandelieu-La Napoule',   43.5460,  6.9370, 'FR', 'French Riviera'),
  ('Saint-Tropez',           43.2727,  6.6407, 'FR', 'French Riviera'),
  ('Hyeres',                 43.1190,  6.1290, 'FR', 'Cote d''Azur'),
  ('Toulon',                 43.1190,  5.9290, 'FR', 'Cote d''Azur'),
  ('La Ciotat',              43.1750,  5.6070, 'FR', 'Cote d''Azur'),
  ('Marseille',              43.2951,  5.3650, 'FR', 'Provence'),
  ('Ajaccio',                41.9190,  8.7360, 'FR', 'Corsica'),
  ('Calvi',                  42.5670,  8.7570, 'FR', 'Corsica'),
  ('Bonifacio',              41.3870,  9.1590, 'FR', 'Corsica'),
  ('Sanremo',                43.8159,  7.7760, 'IT', 'Liguria'),
  ('Imperia',                43.8850,  8.0270, 'IT', 'Liguria'),
  ('Genoa',                  44.4056,  8.9463, 'IT', 'Liguria'),
  ('Portofino',              44.3033,  9.2094, 'IT', 'Liguria'),
  ('La Spezia',              44.1025,  9.8240, 'IT', 'Liguria'),
  ('Viareggio',             43.8664, 10.2380, 'IT', 'Tuscany'),
  ('Naples',                 40.8390, 14.2520, 'IT', 'Campania'),
  ('Porto Cervo',            41.1370,  9.5370, 'IT', 'Sardinia'),
  ('Olbia',                  40.9230,  9.5000, 'IT', 'Sardinia'),
  ('Venice',                 45.4340, 12.3390, 'IT', 'Adriatic'),
  ('Palma de Mallorca',      39.5670,  2.6300, 'ES', 'Balearics'),
  ('Ibiza',                  38.9070,  1.4360, 'ES', 'Balearics'),
  ('Barcelona',              41.3750,  2.1830, 'ES', 'Catalonia'),
  ('Valencia',               39.4460, -0.3260, 'ES', 'Costa Blanca'),
  ('Gibraltar',              36.1440, -5.3540, 'GI', 'Gibraltar'),
  ('Split',                  43.5030, 16.4400, 'HR', 'Adriatic'),
  ('Dubrovnik',              42.6400, 18.1080, 'HR', 'Adriatic'),
  ('Athens',                 37.9420, 23.6460, 'GR', 'Aegean'),
  ('Mykonos',                37.4450, 25.3290, 'GR', 'Aegean'),
  ('Corfu',                  39.6240, 19.9210, 'GR', 'Ionian'),
  ('Valletta',               35.8990, 14.5150, 'MT', 'Malta')
on conflict (name) do update
  set lat = excluded.lat, lng = excluded.lng,
      country = excluded.country, region = excluded.region;

-- The live demo supplier travels a tighter Riviera radius.
update public.supplier_profiles
  set service_radius_km = 45
  where name = 'Source and Supply';

comment on table public.port_locations is
  'Reference coordinates for yacht ports, keyed by the names used in supplier_profiles.coverage_ports. Powers the marketplace "serves my area" map.';
comment on column public.supplier_profiles.service_radius_km is
  'How far (km) a shop will deliver around each of its coverage ports. Used by the marketplace map to decide who reaches a crew''s location.';
