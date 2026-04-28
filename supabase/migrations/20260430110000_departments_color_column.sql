-- Migration: Add color column to departments + seed canonical dept colours.
--
-- Phase 1 of the dept-colours-and-ai-category sprint. Single source of truth
-- for department colours moves to the DB. Frontend hardcoded maps
-- (DEPT_CHIP_STYLES in ProvisioningBoardDetail.jsx) are flagged for backlog
-- migration but stay in place this sprint.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, UPDATE guarded by `color is null` so
-- re-runs don't overwrite manual tenant-side edits. Final fallback grey
-- catches any dept seeded after this migration that didn't get an explicit
-- colour mapped above. NOT NULL + DEFAULT applied last so the constraint
-- only locks in once every existing row is filled.
--
-- lower(name) match protects against casing drift in production seed data;
-- Phase 0 audit confirmed 'Shore / Management' uses that exact spelling.

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS color text;

-- ── Seed the canonical palette ────────────────────────────────────────────
-- Each UPDATE only touches rows that haven't been coloured yet. Manual edits
-- via Supabase studio (or a future per-tenant override system) are preserved.

UPDATE public.departments SET color = '#D4537E' WHERE lower(name) = 'galley'             AND color IS NULL;
UPDATE public.departments SET color = '#D85A30' WHERE lower(name) = 'interior'           AND color IS NULL;
UPDATE public.departments SET color = '#639922' WHERE lower(name) = 'deck'               AND color IS NULL;
UPDATE public.departments SET color = '#534AB7' WHERE lower(name) = 'engineering'        AND color IS NULL;
UPDATE public.departments SET color = '#1F6B7A' WHERE lower(name) = 'bridge'             AND color IS NULL;
UPDATE public.departments SET color = '#A98AC9' WHERE lower(name) = 'spa'                AND color IS NULL;
UPDATE public.departments SET color = '#3D4F5C' WHERE lower(name) = 'security'           AND color IS NULL;
UPDATE public.departments SET color = '#E8A33D' WHERE lower(name) = 'aviation'           AND color IS NULL;
UPDATE public.departments SET color = '#7A6E5D' WHERE lower(name) = 'shore / management' AND color IS NULL;
UPDATE public.departments SET color = '#7A6E5D' WHERE lower(name) = 'admin'              AND color IS NULL;
UPDATE public.departments SET color = '#C13F3F' WHERE lower(name) = 'medical'            AND color IS NULL;
UPDATE public.departments SET color = '#3A8FB7' WHERE lower(name) = 'science'            AND color IS NULL;

-- Fallback grey for any department row not covered above (custom tenant
-- departments seeded post-deploy will pick this up too).
UPDATE public.departments SET color = '#5F5E5A' WHERE color IS NULL;

-- ── Lock in the constraint ────────────────────────────────────────────────

ALTER TABLE public.departments ALTER COLUMN color SET DEFAULT '#5F5E5A';
ALTER TABLE public.departments ALTER COLUMN color SET NOT NULL;
