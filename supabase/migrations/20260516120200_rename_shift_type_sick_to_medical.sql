-- Migration C: Rename rota_shifts.shift_type `sick` -> `medical`
-- Date: 2026-05-16
--
-- ⚠️  BLIND MIGRATION — there is NO rota_shifts migration anywhere in
--     this repo (the table was created directly in Supabase). The
--     CHECK-constraint name and its full allowed value set are NOT
--     known from the codebase. VERIFY both against the actual table
--     before applying:
--
--       SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--       WHERE conrelid = 'public.rota_shifts'::regclass
--         AND contype = 'c';
--
--     The recreate below assumes the documented taxonomy
--       duty | watch | standby | training | off | medical
--     If the live constraint differs, adjust the IN (...) list to match
--     the real allowed set (with 'medical' replacing 'sick').
--
-- Order matters: data first (so existing 'sick' rows satisfy the new
-- constraint), then swap the constraint.

-- 1. Data rename
UPDATE public.rota_shifts
  SET shift_type = 'medical'
  WHERE shift_type = 'sick';

-- 2. Swap any CHECK constraint on shift_type. Drops whatever check
--    constraint currently references the column, then recreates it
--    against the documented taxonomy. Dynamic drop because the
--    constraint name is unknown from the repo.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  WHERE c.conrelid = 'public.rota_shifts'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%shift_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.rota_shifts DROP CONSTRAINT %I', v_conname);
    ALTER TABLE public.rota_shifts
      ADD CONSTRAINT rota_shifts_shift_type_check
      CHECK (shift_type IN ('duty','watch','standby','training','off','medical'));
    RAISE NOTICE 'Replaced shift_type CHECK constraint % with medical-inclusive set.', v_conname;
  ELSE
    RAISE NOTICE 'No CHECK constraint on rota_shifts.shift_type found — data rename only.';
  END IF;
END $$;
