-- Multi-guest tagging on stew_notes.
--
-- Phase D of the Stew Notes feature: a single note can apply to several
-- guests ("Polish silver for John AND Jane's dinner"), so we move from
-- a single related_guest_id FK to a UUID[] column.
--
-- The legacy related_guest_id column STAYS in place for v1 — too many
-- places might still read from it without an audit, and the cost of
-- keeping a duplicate single-id column populated alongside the array is
-- negligible. Writers populate both. Readers can use either. A future
-- migration drops related_guest_id once we've grep-audited that nothing
-- reads from it for ~30 days.
--
-- GIN index on the array enables future queries like "all notes
-- mentioning John" via related_guest_ids @> ARRAY['john-uuid']::uuid[].

ALTER TABLE public.stew_notes
  ADD COLUMN IF NOT EXISTS related_guest_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill: copy existing related_guest_id into the array column for
-- rows that haven't been migrated yet. The array_length guard makes the
-- migration idempotent — re-running won't double-write to rows that
-- already have an array populated by an earlier writer.
UPDATE public.stew_notes
   SET related_guest_ids = ARRAY[related_guest_id]
 WHERE related_guest_id IS NOT NULL
   AND (related_guest_ids IS NULL
        OR array_length(related_guest_ids, 1) IS NULL);

CREATE INDEX IF NOT EXISTS idx_stew_notes_related_guest_ids
  ON public.stew_notes USING GIN (related_guest_ids);
