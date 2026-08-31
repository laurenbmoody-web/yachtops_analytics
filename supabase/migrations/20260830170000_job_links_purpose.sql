-- Why a job is linked to an item: it uses it up, or it is just about it.
--
-- Until now the app inferred that from whether someone had typed a quantity.
-- That is too much meaning to hang on an empty field. "Replace the ice maker
-- filter" and "Polish the ashtrays" are both jobs linked to stock, but only one
-- of them should take anything off the shelf, and nothing in the link said
-- which. Someone filling in a quantity to note how many ashtrays there are
-- would have found two of them deducted.
--
--   'about' — the job concerns this item. It shows in the item's history and
--             nothing moves. The default, because doing nothing is the safe
--             thing to do by accident.
--   'uses'  — the job consumes this item. Completing it deducts qty and writes
--             the movement; reopening puts it back.
--
-- Text rather than a boolean because equipment links will want 'services',
-- and that should not need a second migration.

alter table public.job_links
  add column if not exists purpose text not null default 'about';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_links_purpose_valid'
  ) then
    alter table public.job_links
      add constraint job_links_purpose_valid check (purpose in ('about', 'uses'));
  end if;
end $$;

-- Anything already carrying a quantity was created under the old rule, where a
-- quantity was the way to say "this consumes stock". Keep those behaving as
-- their author intended rather than silently demoting them to references.
update public.job_links
set purpose = 'uses'
where qty is not null and qty > 0 and purpose = 'about';
