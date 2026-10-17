-- Deleting an account (Settings → Delete account → delete-my-account) failed
-- with "Database error deleting user": vessel records the person had made
-- (a laundry item, a rota, a trip…) point at auth.users with the default
-- ON DELETE NO ACTION, so the auth delete was refused.
--
-- Those records belong to the vessel and stay; only the link to the person
-- goes. Every single-column foreign key to auth.users that would block the
-- delete becomes ON DELETE SET NULL (dropping NOT NULL where needed, so an
-- audit row keeps its content with the actor anonymised).

do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, a.attname as col, a.attnotnull as notnull
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and c.confdeltype in ('a', 'r')
      and array_length(c.conkey, 1) = 1
  loop
    if r.notnull then
      execute format('alter table %s alter column %I drop not null', r.tbl, r.col);
    end if;
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      r.tbl, r.conname, r.col);
  end loop;
end $$;
