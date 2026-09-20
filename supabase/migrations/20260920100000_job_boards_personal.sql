-- Personal lists: a board only its owner sees.
--
-- Everyone gets their department's board. Alongside it people want their own
-- lists — the running "chase the shipyard", the things that are theirs and
-- nobody else's — and they want to add one whenever the need appears rather
-- than asking someone to set it up.
--
-- The app has believed in these for a while: isPrivateBoardOwner() reads
-- board.is_private and the quick-add permissions already let crew add to a
-- private board they own. The column never existed, so the flag was dropped on
-- every save and a board meant to be personal came back shared. This adds it.
--
-- created_by is the owner. It is already on the table and already written, so
-- ownership needs nothing new — only the flag that says to respect it.

alter table public.job_boards
  add column if not exists is_private boolean not null default false;

-- "my personal lists on this vessel", read on every load of the Jobs page
create index if not exists job_boards_private_owner_idx
  on public.job_boards (tenant_id, created_by)
  where is_private = true;
