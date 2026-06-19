-- Per-user capability flags surfaced in the profile Permissions section.
-- NULL = tier default (resolved app-side); explicit true/false overrides.
--   can_edit_rota                       — may make rota edits at all
--   can_order_without_approval          — may send supplier order requests w/o approval
--   can_confirm_quotes_without_approval — may confirm supplier quotes w/o approval
-- (Publishing rota edits without approval is the existing rota_requires_acceptance,
--  shown inverted in the UI.)
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS can_edit_rota                       boolean,
  ADD COLUMN IF NOT EXISTS can_order_without_approval          boolean,
  ADD COLUMN IF NOT EXISTS can_confirm_quotes_without_approval boolean;

COMMENT ON COLUMN public.tenant_members.can_edit_rota IS
  'May make rota edits. NULL = tier default (COMMAND/CHIEF/HOD yes, else no).';
COMMENT ON COLUMN public.tenant_members.can_order_without_approval IS
  'May send supplier order requests without approval. NULL = tier default (COMMAND yes, else no).';
COMMENT ON COLUMN public.tenant_members.can_confirm_quotes_without_approval IS
  'May confirm supplier quotes without approval. NULL = tier default (COMMAND yes, else no). Forced false when can_order_without_approval is false.';
