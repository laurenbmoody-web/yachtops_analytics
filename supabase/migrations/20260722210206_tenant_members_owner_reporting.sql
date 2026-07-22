-- Cargo Accounts — Phase 3. Read-only owner/viewer seat.
-- A per-member capability (mirrors can_access_accounts): a user with this flag can
-- see Owner reporting (/accounts/owner) read-only, without being COMMAND/CHIEF and
-- without reaching any other accounts or crew-operational surface. Grant-only —
-- it never reduces existing access. Owners are often not crew, so this is the seat
-- an owner's office uses.
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS can_view_owner_reporting boolean NOT NULL DEFAULT false;
