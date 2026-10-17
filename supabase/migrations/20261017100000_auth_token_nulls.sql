-- Stop NULL auth token columns from breaking the admin API.
--
-- THE FAILURE
-- Sending a roster crew member their invite returned a database error. GoTrue:
--
--   PUT /admin/users/<id> -> 500
--   error finding user: sql: Scan error on column index 3,
--   name "confirmation_token": converting NULL to string is unsupported
--
-- GoTrue scans these columns into Go strings, which cannot hold NULL. So a user
-- row with a NULL token is unreadable by the admin API: not just unwritable —
-- unreadable. Every admin call touching that row 500s, and the crew member
-- cannot be given a login at all.
--
-- WHERE THE NULLS COME FROM
-- `supabase.auth.admin.createUser({ email_confirm: false })`, which is how
-- rosterCrew creates a crew member who has no login yet, can leave
-- confirmation_token, recovery_token, email_change_token_new and email_change
-- NULL rather than ''. It is inconsistent — most roster rows on this project
-- have '' and one had NULL — so it cannot be relied on either way.
--
-- This is the SECOND time it has bitten this project: the management test
-- logins hit the identical error in August and were repaired one row at a time,
-- which fixed those accounts and left the cause in place. Hence a trigger
-- rather than another round of UPDATEs.
--
-- WHY A TRIGGER AND NOT A FIX IN rosterCrew
-- The broken rows came from at least two different creation paths (the roster
-- edge function, and an older seed), so patching one caller would leave the
-- same landmine for the next. The normalisation is trivial and idempotent:
-- blank is the value every healthy row already carries, so this only ever
-- rewrites a NULL and never changes a real token.
--
-- Written to be re-runnable, because a Supabase auth upgrade could in principle
-- drop objects in the auth schema; re-applying this migration restores it.

create or replace function public.auth_user_blank_null_tokens()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Only ever turns NULL into ''. A real token is passed through untouched.
  new.confirmation_token         := coalesce(new.confirmation_token, '');
  new.recovery_token             := coalesce(new.recovery_token, '');
  new.email_change_token_new     := coalesce(new.email_change_token_new, '');
  new.email_change_token_current := coalesce(new.email_change_token_current, '');
  new.phone_change_token         := coalesce(new.phone_change_token, '');
  new.reauthentication_token     := coalesce(new.reauthentication_token, '');
  new.email_change               := coalesce(new.email_change, '');
  new.phone_change               := coalesce(new.phone_change, '');
  return new;
end;
$$;

comment on function public.auth_user_blank_null_tokens is
  'Keeps auth.users token columns non-NULL. GoTrue scans them into Go strings, so a NULL makes the row unreadable by the admin API and any invite touching it fails with a 500.';

drop trigger if exists auth_users_blank_null_tokens on auth.users;
create trigger auth_users_blank_null_tokens
  before insert or update on auth.users
  for each row
  execute function public.auth_user_blank_null_tokens();

-- Repair anything already in that state. No-op once clean.
update auth.users set
  confirmation_token          = coalesce(confirmation_token, ''),
  recovery_token              = coalesce(recovery_token, ''),
  email_change_token_new      = coalesce(email_change_token_new, ''),
  email_change_token_current  = coalesce(email_change_token_current, ''),
  phone_change_token          = coalesce(phone_change_token, ''),
  reauthentication_token      = coalesce(reauthentication_token, ''),
  email_change                = coalesce(email_change, ''),
  phone_change                = coalesce(phone_change, '')
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change_token is null
   or reauthentication_token is null
   or email_change is null
   or phone_change is null;
