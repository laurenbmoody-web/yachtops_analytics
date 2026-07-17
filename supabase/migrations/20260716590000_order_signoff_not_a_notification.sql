-- Order sign-offs belong in the Reviews queue, not the Notifications feed.
--
-- The header bell badge = pending Reviews + unread Notifications. Order
-- sign-offs are now counted as Reviews (useInboxCount → fetch_pending_order_approvals),
-- so they should NOT also drop a row in the notifications table (that put them
-- on the Notifications tab). Remove the trigger + function and clear the ones it
-- already created.

drop trigger if exists trg_notify_order_signoff on public.supplier_orders;
drop function if exists public.notify_order_signoff();

delete from public.notifications where type = 'order_signoff';
