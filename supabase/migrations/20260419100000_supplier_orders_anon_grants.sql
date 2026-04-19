-- Grant table-level SELECT and UPDATE to the anon role so the public
-- supplier-confirmation page can read orders and update item statuses
-- without an authenticated session.  RLS policies already exist to
-- restrict which rows are accessible; these GRANTs are the prerequisite
-- that lets PostgREST route anonymous requests to the tables at all.

GRANT SELECT, UPDATE ON public.supplier_orders      TO anon;
GRANT SELECT, UPDATE ON public.supplier_order_items TO anon;
