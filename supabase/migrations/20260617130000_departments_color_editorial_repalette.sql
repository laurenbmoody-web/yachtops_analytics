-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617130000_departments_color_editorial_repalette.sql
--
-- Re-paints public.departments.color to a more editorial palette so the
-- dept indicator (2px rail on category headers, eyebrow chip on item
-- sections) sits cleanly alongside the navy/terracotta editorial
-- vocabulary instead of fighting it.
--
-- Why a force-overwrite (no `color IS NULL` guard like the original
-- seed): the original palette read as saturated coral/lime/indigo
-- against the cool page bg — the whole reason we're repainting.
-- Manual per-tenant overrides via Studio are intentionally NOT
-- preserved this pass because:
--   (a) no tenant has yet customised, per Phase 0 audit,
--   (b) the system-level rebrand needs the new tones everywhere to
--       unify the dept chip + rail story (DEPT_CHIP_STYLES hardcoded
--       map in the FE goes away as part of this work).
--
-- Also seeds the 'Bar' department which was missing from the original
-- canonical seed but is used in production boards (Galley split into
-- Galley + Bar for spirits & wine ordering).
--
-- Idempotent: UPDATE on existing rows, INSERT … WHERE NOT EXISTS for
-- Bar.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── New editorial palette ─────────────────────────────────────────────────
-- All tones desaturated, mid-luminance, designed to read as a system
-- identifier without dominating. Compatible with --d-navy-deep and
-- --d-orange (the brand pair) at any combination.

UPDATE public.departments SET color = '#A86F5E' WHERE lower(name) = 'galley';              -- dusty cinnamon
UPDATE public.departments SET color = '#7A6F8C' WHERE lower(name) = 'interior';            -- dusty plum
UPDATE public.departments SET color = '#6B8A5E' WHERE lower(name) = 'deck';                -- sage
UPDATE public.departments SET color = '#4A5A6E' WHERE lower(name) = 'engineering';         -- slate blue
UPDATE public.departments SET color = '#2D5B6E' WHERE lower(name) = 'bridge';              -- deep teal
UPDATE public.departments SET color = '#9C8BA8' WHERE lower(name) = 'spa';                 -- dusty lavender
UPDATE public.departments SET color = '#3D4F5C' WHERE lower(name) = 'security';            -- slate (unchanged — already editorial)
UPDATE public.departments SET color = '#B58B4E' WHERE lower(name) = 'aviation';            -- aged brass
UPDATE public.departments SET color = '#7A6E5D' WHERE lower(name) = 'shore / management';  -- taupe (unchanged)
UPDATE public.departments SET color = '#7A6E5D' WHERE lower(name) = 'admin';               -- taupe (unchanged)
UPDATE public.departments SET color = '#A65454' WHERE lower(name) = 'medical';             -- muted crimson
UPDATE public.departments SET color = '#5A7A8C' WHERE lower(name) = 'science';             -- dusty blue


-- ── Seed Bar (missed in the original seed) ────────────────────────────────
INSERT INTO public.departments (id, name, color)
SELECT gen_random_uuid(), 'Bar', '#7E5F6B'                                                  -- dusty wine
WHERE NOT EXISTS (SELECT 1 FROM public.departments WHERE lower(name) = 'bar');

-- If Bar already existed without a colour (e.g. tenant-added), set it.
UPDATE public.departments SET color = '#7E5F6B' WHERE lower(name) = 'bar'
  AND (color IS NULL OR color = '#5F5E5A');  -- only touch unset / system-fallback rows


-- ── Default for unseen depts ──────────────────────────────────────────────
-- A muted graphite — quieter than the previous #5F5E5A so unknown
-- depts still read as "neutral identifier", not "warm grey".
ALTER TABLE public.departments ALTER COLUMN color SET DEFAULT '#6B7280';
