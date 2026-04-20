CREATE TABLE IF NOT EXISTS public.stew_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  content              text NOT NULL,
  author_id            uuid REFERENCES auth.users(id),
  status               text,
  source               text CHECK (source IN ('voice', 'typed', 'auto')) DEFAULT 'typed',
  saved_to_preferences boolean DEFAULT false,
  related_guest_id     uuid REFERENCES public.guests(id),
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE public.stew_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_manage_stew_notes"
  ON public.stew_notes FOR ALL TO authenticated
  USING  (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));
