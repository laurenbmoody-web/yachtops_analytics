-- Share links: anyone with the token can access the board per the granted permission
CREATE TABLE IF NOT EXISTS provisioning_list_shares (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      uuid        NOT NULL REFERENCES provisioning_lists(id) ON DELETE CASCADE,
  token        text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'base64url'),
  permission   text        NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  last_accessed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pls_list_id ON provisioning_list_shares(list_id);
CREATE INDEX IF NOT EXISTS idx_pls_token   ON provisioning_list_shares(token) WHERE revoked_at IS NULL;

-- Named collaborators: specific crew members with explicit permissions
CREATE TABLE IF NOT EXISTS provisioning_list_collaborators (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid        NOT NULL REFERENCES provisioning_lists(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permission text        NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'approve')),
  added_by   uuid,
  added_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_plc_list_id ON provisioning_list_collaborators(list_id);
CREATE INDEX IF NOT EXISTS idx_plc_user_id ON provisioning_list_collaborators(user_id);
