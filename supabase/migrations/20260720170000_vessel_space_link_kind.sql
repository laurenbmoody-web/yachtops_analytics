-- 20260720170000_vessel_space_link_kind.sql
--
-- Stairs vs doorways. A vessel_space_links row is an undirected connection
-- between two rooms. Until now every link meant "you can walk straight from A
-- to B" (a doorway on one deck). Some spaces — the foredeck, a sun deck — are
-- only reachable by STAIRS from a room on a *different* deck, which a flat
-- same-deck doorway line can't express.
--
-- link_kind tags each connection: 'door' (default, drawn as a line between two
-- pins on the same deck) or 'stairs' (drawn as a ↕ badge on each deck that
-- jumps to the connected deck). The pair table is already deck-agnostic, so no
-- structural change is needed — only this discriminator.

alter table public.vessel_space_links
  add column if not exists link_kind text not null default 'door';

alter table public.vessel_space_links
  drop constraint if exists vessel_space_links_kind_chk;
alter table public.vessel_space_links
  add constraint vessel_space_links_kind_chk check (link_kind in ('door', 'stairs'));

comment on column public.vessel_space_links.link_kind is
  'Connection type: door (same-deck walkway, rendered as a line) or stairs (cross-deck, rendered as a ↕ badge that jumps between decks).';
