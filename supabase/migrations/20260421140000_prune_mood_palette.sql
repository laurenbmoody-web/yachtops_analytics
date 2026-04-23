-- Phase 2 · mood palette prune + rename
--
-- Shrinks the mood palette from 20 entries to 15 and renames 'private' to
-- 'dnd' for operational clarity. Also migrates any guests.current_mood rows
-- still carrying one of the pruned keys so the FK-like constraint between
-- guests.current_mood and a selectable palette key stays honest.
--
-- Pruned:
--   off           — vague; swirl emoji unclear
--   flirty        — HR-shaped risk in crew audit records
--   reflective    — no service implication
--   buzzy         — redundant with celebrating
--   contemplative — no service implication
--
-- Renamed:
--   private → dnd (label 'DND'; emoji kept as 🔕)
--
-- New Quick row order (is_quick_pick=true, sort_order 1-5):
--   happy · quiet · tired · dnd · celebrating
--
-- Playful is kept — not in the prune list, though absent from the
-- "full palette additional moods" enumeration. Easy follow-up to prune
-- if intended.

-- ── Rename private → dnd (happens before the prune so nothing overlaps) ─────
UPDATE public.moods
SET key = 'dnd', label = 'DND'
WHERE key = 'private';

UPDATE public.guests
SET current_mood = 'dnd'
WHERE current_mood = 'private';

-- ── Remove pruned moods from the selectable palette ────────────────────────
DELETE FROM public.moods
WHERE key IN ('off', 'flirty', 'reflective', 'buzzy', 'contemplative');

-- ── Clear pruned keys off any guest currently carrying them ────────────────
-- current_mood_emoji is a dead write (removed from useGuests in Phase 2) but
-- still exists in the schema — clear it alongside for row consistency.
UPDATE public.guests
SET current_mood = NULL,
    current_mood_emoji = NULL
WHERE current_mood IN ('off', 'flirty', 'reflective', 'buzzy', 'contemplative');

-- ── Re-flag quick picks + re-order so the palette renders in the new order ─
UPDATE public.moods SET sort_order = 1,  is_quick_pick = true  WHERE key = 'happy';
UPDATE public.moods SET sort_order = 2,  is_quick_pick = true  WHERE key = 'quiet';
UPDATE public.moods SET sort_order = 3,  is_quick_pick = true  WHERE key = 'tired';
UPDATE public.moods SET sort_order = 4,  is_quick_pick = true  WHERE key = 'dnd';
UPDATE public.moods SET sort_order = 5,  is_quick_pick = true  WHERE key = 'celebrating';

UPDATE public.moods SET sort_order = 10, is_quick_pick = false WHERE key = 'playful';
UPDATE public.moods SET sort_order = 11, is_quick_pick = false WHERE key = 'hungover';
UPDATE public.moods SET sort_order = 12, is_quick_pick = false WHERE key = 'jetlagged';
UPDATE public.moods SET sort_order = 13, is_quick_pick = false WHERE key = 'grumpy';
UPDATE public.moods SET sort_order = 14, is_quick_pick = false WHERE key = 'stressed';
UPDATE public.moods SET sort_order = 15, is_quick_pick = false WHERE key = 'social';
UPDATE public.moods SET sort_order = 16, is_quick_pick = false WHERE key = 'unwell';
UPDATE public.moods SET sort_order = 17, is_quick_pick = false WHERE key = 'relaxed';
UPDATE public.moods SET sort_order = 18, is_quick_pick = false WHERE key = 'focused';
UPDATE public.moods SET sort_order = 19, is_quick_pick = false WHERE key = 'seasick';

-- history_log entries referencing the pruned keys (as from/to mood values)
-- are intentionally left untouched. Log entries record what actually
-- happened at the time and should not be rewritten retroactively. Readers
-- can still display "Mood set to flirty" for a historical event — the key
-- just isn't selectable for new writes.
