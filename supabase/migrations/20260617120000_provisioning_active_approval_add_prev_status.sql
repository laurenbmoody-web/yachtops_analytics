-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617120000_provisioning_active_approval_add_prev_status.sql
--
-- PR1 of the re-approval flow added `prev_status` to
-- provisioning_approval_requests but did NOT update the
-- provisioning_active_approval view that the client reads. So every
-- consumer of the view (board's chip render, inbox right pane's
-- "QUOTE REVIEW" marker) saw approvalRequest.prev_status as undefined
-- and treated initial approvals + re-approvals identically.
--
-- This re-declares the view with prev_status included. security_invoker
-- is preserved so the underlying table's RLS still applies.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.provisioning_active_approval
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (par.list_id)
  par.id,
  par.list_id,
  par.tenant_id,
  par.submitter_id,
  par.approver_id,
  par.status,
  par.comment,
  par.created_at,
  par.decided_at,
  par.prev_status
FROM public.provisioning_approval_requests par
ORDER BY par.list_id, par.created_at DESC;

GRANT SELECT ON public.provisioning_active_approval TO authenticated;
