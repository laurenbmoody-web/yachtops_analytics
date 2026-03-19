-- Migration: add user_board_order table for per-user board ordering
-- Each row stores one board's sort position for a specific user+tenant combination.

CREATE TABLE IF NOT EXISTS public.user_board_order (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  board_id    TEXT NOT NULL,
  sort_index  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one sort_index row per user+tenant+board
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_board_order_unique
  ON public.user_board_order (tenant_id, user_id, board_id);

CREATE INDEX IF NOT EXISTS idx_user_board_order_lookup
  ON public.user_board_order (tenant_id, user_id);

-- Enable RLS
ALTER TABLE public.user_board_order ENABLE ROW LEVEL SECURITY;

-- RLS: users can only access their own rows
DROP POLICY IF EXISTS "user_board_order_select_own" ON public.user_board_order;
CREATE POLICY "user_board_order_select_own"
  ON public.user_board_order
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_board_order_insert_own" ON public.user_board_order;
CREATE POLICY "user_board_order_insert_own"
  ON public.user_board_order
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_board_order_update_own" ON public.user_board_order;
CREATE POLICY "user_board_order_update_own"
  ON public.user_board_order
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_board_order_delete_own" ON public.user_board_order;
CREATE POLICY "user_board_order_delete_own"
  ON public.user_board_order
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
