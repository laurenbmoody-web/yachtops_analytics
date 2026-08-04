-- Cargo — a management company as something with a profile, not just a name.
--
-- The firm was a row with a name on it, which was enough to hang engagements
-- from but nothing an office could call their own. They need somewhere that is
-- theirs: who they are, how a vessel reaches them, and — the part they actually
-- ask about — a plain statement of what each of their people can and cannot do.
--
-- Contact details are kept here rather than on the vessel because the firm owns
-- them: six yachts should not each hold their own stale copy of the office's
-- phone number.

ALTER TABLE public.management_companies
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS phone         text,
  ADD COLUMN IF NOT EXISTS website       text,
  ADD COLUMN IF NOT EXISTS updated_by    uuid REFERENCES auth.users(id);

-- Everything a management user needs to draw their own settings: the firm, their
-- standing in it, and what it is engaged on. One call rather than three.
CREATE OR REPLACE FUNCTION public.management_company_profile(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_tier text; v_out jsonb;
BEGIN
  SELECT m.permission_tier INTO v_tier
    FROM public.management_company_members m
   WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'id', c.id, 'name', c.name, 'contact_email', c.contact_email,
        'phone', c.phone, 'website', c.website, 'created_at', c.created_at)
      FROM public.management_companies c WHERE c.id = p_company_id
    ),
    'my_tier', v_tier,
    'people', (SELECT count(*)::int FROM public.management_company_members m
                WHERE m.company_id = p_company_id AND m.active),
    -- The vessels, and what each one chose to share. The office cannot change
    -- any of this — it is the boat's decision — so it reads as a record of who
    -- has trusted them with what.
    'engagements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', e.tenant_id, 'vessel_name', t.name,
        'scopes', e.scopes, 'granted_at', e.granted_at, 'active', e.active
      ) ORDER BY e.active DESC, t.name)
      FROM public.management_engagements e
      JOIN public.tenants t ON t.id = e.tenant_id
      WHERE e.company_id = p_company_id
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$fn$;

-- Owner or admin edits the firm's own details. Nothing here touches a vessel:
-- the engagement and its scopes stay entirely the boat's to decide.
CREATE OR REPLACE FUNCTION public.management_company_update(
  p_company_id uuid, p_name text DEFAULT NULL, p_contact_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_website text DEFAULT NULL
)
RETURNS public.management_companies
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_name text; c public.management_companies;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.management_company_members m
    WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active
      AND m.permission_tier IN ('OWNER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'Only an owner or admin can change the company' USING ERRCODE = '42501';
  END IF;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  IF v_name IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.management_companies c2
     WHERE lower(c2.name) = lower(v_name) AND c2.id <> p_company_id
  ) THEN
    -- Names are how a captain finds the firm when engaging it, so two firms
    -- called the same thing is a trap rather than a detail.
    RAISE EXCEPTION 'Another management company already uses that name' USING ERRCODE = '23505';
  END IF;

  UPDATE public.management_companies SET
    name          = coalesce(v_name, name),
    -- An empty string here means "clear it"; NULL means "leave it alone", so a
    -- form can send only the fields it is responsible for.
    contact_email = CASE WHEN p_contact_email IS NULL THEN contact_email
                         ELSE nullif(btrim(p_contact_email), '') END,
    phone         = CASE WHEN p_phone IS NULL THEN phone
                         ELSE nullif(btrim(p_phone), '') END,
    website       = CASE WHEN p_website IS NULL THEN website
                         ELSE nullif(btrim(p_website), '') END,
    updated_by    = auth.uid(),
    updated_at    = now()
  WHERE id = p_company_id
  RETURNING * INTO c;

  RETURN c;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.management_company_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_company_update(uuid, text, text, text, text) TO authenticated;
