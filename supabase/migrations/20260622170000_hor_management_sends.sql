-- Records when a vessel's monthly Record of Hours of Rest was sent to the
-- management company, and by whom — so everyone with month-end access can see
-- that it's been done (and avoid sending duplicates). One row per
-- vessel-month; re-sends bump sent_at / sent_by and increment send_count.
--
-- Written server-side by the hor-send-to-management edge function (service
-- role) after a successful send. Tenant members may read their own vessel's
-- rows for the status line on the month-end hub.

CREATE TABLE IF NOT EXISTS public.hor_management_sends (
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_year     smallint    NOT NULL,
  period_month    smallint    NOT NULL,   -- 1..12 (calendar month)
  sent_at         timestamptz NOT NULL DEFAULT now(),
  sent_by         uuid,                    -- user_id of whoever clicked send
  sent_by_name    text,
  recipient_email text,
  send_count      integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_year, period_month)
);

ALTER TABLE public.hor_management_sends ENABLE ROW LEVEL SECURITY;

-- Tenant members can see their own vessel's send history (read-only). Writes go
-- through the edge function with the service role, so no client write policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'hor_management_sends'
      AND policyname = 'hor_management_sends_read'
  ) THEN
    CREATE POLICY "hor_management_sends_read"
      ON public.hor_management_sends
      FOR SELECT
      USING (public.is_active_tenant_member(tenant_id, auth.uid()));
  END IF;
END $$;
