-- ── Provisioning board permissions ───────────────────────────────────────────
-- Adds owner_id, department_id, and visibility to provisioning_lists.
-- Visibility values:
--   'private'    — only the owner can see (replaces is_private = true)
--   'department' — everyone in the same department can see
--   'shared'     — visible to named collaborators + share-link holders

-- Add missing columns that the app already references (safe if they exist)
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS is_private    boolean       NOT NULL DEFAULT false;
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS sort_order    integer;
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS board_colour  text;
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS order_by_date date;
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS currency      text          NOT NULL DEFAULT 'USD';

-- New permission columns
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS owner_id      uuid          REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS department_id uuid          REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE provisioning_lists ADD COLUMN IF NOT EXISTS visibility    varchar(20)   NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'department', 'shared'));

-- Backfill owner_id from created_by (same user UUID — profiles.id = auth.users.id)
UPDATE provisioning_lists
SET owner_id = created_by
WHERE owner_id IS NULL AND created_by IS NOT NULL;

-- Backfill visibility from is_private:
--   is_private = true  → 'private'
--   is_private = false → 'shared'  (was "visible to all" before, treat as shared)
UPDATE provisioning_lists
SET visibility = CASE WHEN is_private = true THEN 'private' ELSE 'shared' END
WHERE true;

-- Index for efficient visibility queries
CREATE INDEX IF NOT EXISTS idx_pl_owner_id      ON provisioning_lists(owner_id);
CREATE INDEX IF NOT EXISTS idx_pl_department_id ON provisioning_lists(department_id);
CREATE INDEX IF NOT EXISTS idx_pl_visibility    ON provisioning_lists(visibility);

-- ── RLS policy ────────────────────────────────────────────────────────────────
-- Enable RLS on the table (idempotent)
ALTER TABLE provisioning_lists ENABLE ROW LEVEL SECURITY;

-- Drop any existing overly-permissive SELECT policy
DROP POLICY IF EXISTS "Users can view provisioning lists"  ON provisioning_lists;
DROP POLICY IF EXISTS "provisioning_lists_select_policy"   ON provisioning_lists;
DROP POLICY IF EXISTS "Allow all access to provisioning_lists" ON provisioning_lists;

-- New SELECT policy:
--   1. Owner can always see their board
--   2. 'department' boards are visible to anyone in the same department (via tenant_members)
--   3. 'shared' boards are visible to named collaborators
--   4. Boards the user has a (non-revoked) share token for are accessed via the token route,
--      not this policy — kept simple here.
CREATE POLICY "Users can view provisioning lists" ON provisioning_lists
FOR SELECT USING (
  -- Owner sees their own boards
  owner_id = auth.uid()
  -- Department-visible boards: user must be an active member of the same department
  OR (
    visibility = 'department'
    AND department_id IS NOT NULL
    AND department_id IN (
      SELECT department_id
      FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND department_id IS NOT NULL
    )
  )
  -- Shared boards: user is a named collaborator
  OR id IN (
    SELECT list_id
    FROM provisioning_list_collaborators
    WHERE user_id = auth.uid()
  )
);

-- INSERT: only authenticated users can create boards, and owner_id must match their UID
CREATE POLICY "Users can insert provisioning lists" ON provisioning_lists
FOR INSERT WITH CHECK (
  owner_id = auth.uid()
);

-- UPDATE / DELETE: only owner can modify or delete
CREATE POLICY "Owners can update provisioning lists" ON provisioning_lists
FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Owners can delete provisioning lists" ON provisioning_lists
FOR DELETE USING (owner_id = auth.uid());
