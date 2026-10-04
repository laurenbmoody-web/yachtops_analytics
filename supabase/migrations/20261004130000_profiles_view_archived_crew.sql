-- Archived (off-boarded) crew have tenant_members.active = false. The broad
-- profile-visibility helper users_share_tenant() requires BOTH parties to be
-- active, so once a crew member is archived their profile row (name, avatar)
-- becomes unreadable — the Past crew cards showed no name and their profile
-- page 404'd ("Profile not found").
--
-- Add a visibility path for archived tenant-mates: an active member may read
-- the profile of any member of a tenant they're active in, whether or not that
-- member is still active. SECURITY DEFINER so the membership lookup bypasses
-- tenant_members' own RLS (no recursion), keyed off the calling auth.uid().
create or replace function public.can_view_tenant_profile(subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from tenant_members me
    join tenant_members them on them.tenant_id = me.tenant_id
    where me.user_id = auth.uid()
      and me.active = true
      and them.user_id = subject
  );
$$;

drop policy if exists profiles_view_tenant_incl_archived on public.profiles;
create policy profiles_view_tenant_incl_archived on public.profiles
  for select using (public.can_view_tenant_profile(id));
