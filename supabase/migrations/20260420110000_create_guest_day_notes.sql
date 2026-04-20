CREATE TABLE IF NOT EXISTS public.guest_day_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guest_id   uuid NOT NULL REFERENCES public.guests(id)  ON DELETE CASCADE,
  content    text NOT NULL,
  author_id  uuid REFERENCES auth.users(id),
  status     text,
  created_at timestamptz DEFAULT now(),
  note_date  date DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS guest_day_notes_guest_date_idx
  ON public.guest_day_notes(guest_id, note_date);

ALTER TABLE public.guest_day_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_manage_day_notes"
  ON public.guest_day_notes FOR ALL TO authenticated
  USING  (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));
