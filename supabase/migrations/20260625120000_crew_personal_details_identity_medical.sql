-- Personal Details additions (Identity + Medical).
-- Identity: place of birth, optional second nationality + dual-passport flag,
-- and the Seaman's Discharge Book / SID number.
-- Medical: emergency medications (free text) and a doctor contact (name + phone).
alter table public.crew_personal_details add column if not exists place_of_birth text;
alter table public.crew_personal_details add column if not exists second_nationality text;
alter table public.crew_personal_details add column if not exists dual_passport boolean not null default false;
alter table public.crew_personal_details add column if not exists discharge_book_number text;
alter table public.crew_personal_details add column if not exists emergency_medications text;
-- { "name": "...", "phone": "..." }
alter table public.crew_personal_details add column if not exists doctor_contact jsonb not null default '{}'::jsonb;

comment on column public.crew_personal_details.place_of_birth is 'Place of birth (town/country as printed on ID).';
comment on column public.crew_personal_details.second_nationality is 'Optional second nationality.';
comment on column public.crew_personal_details.dual_passport is 'Holds a second passport for the second nationality.';
comment on column public.crew_personal_details.discharge_book_number is 'Seaman''s Discharge Book / SID number.';
comment on column public.crew_personal_details.emergency_medications is 'Critical/regular medications relevant in an emergency.';
comment on column public.crew_personal_details.doctor_contact is 'Doctor/GP contact: { name, phone }.';
