-- Widen the contractor_visits status check to cover the gangway visitor lifecycle.
-- Previously only 'onboard'/'ashore' were allowed, which rejected:
--   'stepped_out' — visitor temporarily off the vessel (lunch run) with details retained
--   'expected'    — pre-registered visitor who has not yet arrived
alter table contractor_visits
  drop constraint if exists contractor_visits_status_check;

alter table contractor_visits
  add constraint contractor_visits_status_check
  check (status = any (array['onboard'::text, 'ashore'::text, 'stepped_out'::text, 'expected'::text]));
