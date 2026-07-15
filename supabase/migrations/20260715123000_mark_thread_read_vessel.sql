-- Vessel-side read receipts for supplier↔yacht messaging.
--
-- Tenant members can SELECT their threads and INSERT vessel messages, but they
-- have no UPDATE on supplier_message_threads (that's the supplier's). The crew
-- inbox still needs to clear its own unread + move the vessel read cursor (so
-- the supplier's ✓✓ receipts light up). This SECURITY DEFINER function does
-- exactly that, gated to a genuine member of the thread's vessel.

create or replace function public.mark_thread_read_vessel(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.supplier_message_threads t
     set vessel_last_read_at = now(),
         vessel_unread_count = 0
   where t.id = p_thread_id
     and exists (
       select 1 from public.tenant_members tm
       where tm.tenant_id = t.tenant_id
         and tm.user_id = auth.uid()
         and tm.status != 'invited'
     );
end $$;

grant execute on function public.mark_thread_read_vessel(uuid) to authenticated;
