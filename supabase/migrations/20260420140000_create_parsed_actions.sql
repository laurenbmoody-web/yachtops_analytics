CREATE TABLE IF NOT EXISTS public.parsed_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  raw_transcript text NOT NULL,
  parsed_intent  text NOT NULL,
  parsed_payload jsonb NOT NULL,
  confirmed      boolean DEFAULT false,
  applied        boolean DEFAULT false,
  undone         boolean DEFAULT false,
  author_id      uuid REFERENCES auth.users(id),
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.parsed_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_manage_parsed_actions"
  ON public.parsed_actions FOR ALL TO authenticated
  USING  (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));
