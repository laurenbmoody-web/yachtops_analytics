-- Read a supplier's reviews for the reviews modal.
--
-- The list is platform-wide (every yacht's experience), but reviews are
-- shown ANONYMOUSLY — "Verified crew", no name or vessel. Yacht crew are
-- private about which boat they work on, so we never expose the reviewer.
-- The caller's own review is flagged (is_mine) so the modal can pull it
-- into the "your review" editor. Only rows with a written note are worth
-- listing; bare star ratings still count toward the average via
-- get_supplier_ratings().
--
-- SECURITY DEFINER + gated on active tenant membership, matching
-- get_supplier_ratings(). RLS on supplier_reviews only exposes own rows,
-- so this RPC is the only way to read the aggregate list.

create or replace function public.get_supplier_reviews(p_supplier_id uuid)
returns table (
  id         uuid,
  rating     int,
  note       text,
  created_at timestamptz,
  is_mine    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.rating,
    r.note,
    r.created_at,
    (r.user_id = auth.uid()) as is_mine
  from public.supplier_reviews r
  where r.supplier_id = p_supplier_id
    and nullif(btrim(coalesce(r.note, '')), '') is not null
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  order by r.created_at desc;
$$;

grant execute on function public.get_supplier_reviews(uuid) to authenticated;

comment on function public.get_supplier_reviews(uuid) is
  'Anonymous platform-wide reviews (with notes) for one supplier, newest first. Own review flagged is_mine. Gated on active tenant membership.';
