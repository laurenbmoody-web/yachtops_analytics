-- Drop `to_order` from provisioning_items.status CHECK enum
--
-- Phase 3 commit 1. Retrospective fix: Phase 2 commit 1 (07260b5)
-- activated the previously-dead `to_order` status with a two-stage
-- cascade (Path 1: draft → to_order on board approval; Path 2:
-- to_order → ordered on supplier dispatch). The cascade was wired but
-- the underlying status doesn't reflect real user workflow — there's
-- no "committed to order but not yet sent" intermediate state; pressing
-- send IS the commitment. Items go directly draft → ordered.
--
-- The board status (pending_approval → sent_to_supplier) already carries
-- the "approved, awaiting send" signal at the board level. Splitting
-- this to a per-item state added a transient status that only existed
-- between two clicks of the same workflow, with no meaningful user-
-- visible distinction.
--
-- The single case where `to_order` carried meaning — partial-dispatch
-- (2 of 3 supplier groups sent successfully, third group's items stay
-- mid-flight) — is more honestly expressed by leaving the failed
-- group's items at `draft`. The mixed board state (some draft, some
-- ordered) becomes its own "you still have items to send" signal.
--
-- Backfill: any rows currently in `to_order` flip to `draft`. The
-- status only existed transiently between Phase 2 commit 1's deploy
-- (June 2026) and this revert; small N expected. The cascade was soft-
-- fail so any rows that landed there are pre-dispatch boards still
-- mid-flow — `draft` is the correct retroactive value.

UPDATE public.provisioning_items SET status = 'draft' WHERE status = 'to_order';

ALTER TABLE public.provisioning_items
  DROP CONSTRAINT IF EXISTS provisioning_items_status_check;

ALTER TABLE public.provisioning_items
  ADD CONSTRAINT provisioning_items_status_check
  CHECK (status IN (
    'draft',
    'ordered',
    'received',
    'partial',
    'not_received'
  ));
