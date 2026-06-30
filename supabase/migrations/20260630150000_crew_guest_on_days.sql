-- Guest-on days for the interior Yacht Purser (IAMI GUEST) pathway: operational
-- days with guests aboard (charters, shows, owner trips). Evidenced by the
-- captain/company or charter records — recorded here as a verified total.
alter table public.crew_personal_details add column if not exists guest_on_days integer;
comment on column public.crew_personal_details.guest_on_days is 'Verified guest-on days (days with guests aboard) for the Yacht Purser CoC evidence.';
