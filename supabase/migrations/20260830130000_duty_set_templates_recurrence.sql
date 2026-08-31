-- The New duty set modal has always collected a "Repeats" value (daily /
-- weekly / fortnightly / monthly / custom, with the day, week-A-B, nth-weekday
-- and every-X-days detail behind it), but there was nowhere to put it: the
-- table had no recurrence column and handleCreateTemplate never sent it, so
-- every schedule a user set was silently discarded on save.
--
-- Stored as jsonb because the shape is a small discriminated union keyed on
-- `type`, and the fields that matter differ per type. This mirrors the object
-- the modal already builds, so nothing has to be flattened on the way in or
-- reassembled on the way out.
--
--   { type: 'daily' }
--   { type: 'weekly',      weekDays: ['Mon','Thu'] }
--   { type: 'fortnightly', weekDays: ['Mon'], fortnightWeek: 'A' }
--   { type: 'monthly',     monthlyMode: 'day', monthDay: 15 }
--   { type: 'monthly',     monthlyMode: 'nth', nthOrdinal: '2', nthWeekday: 'Tuesday' }
--   { type: 'custom',      everyXDays: 10 }
--
-- Existing rows get 'daily', which is what the modal defaults to and therefore
-- what every template created so far was actually showing when it was saved.

alter table public.duty_set_templates
  add column if not exists recurrence jsonb not null default '{"type": "daily"}'::jsonb;

comment on column public.duty_set_templates.recurrence is
  'Repeat schedule set in the New/Edit duty set modal. Discriminated on `type`: daily | weekly | fortnightly | monthly | custom.';
