-- Supplier company profiles (the "other side" of the marketplace)
CREATE TABLE IF NOT EXISTS public.supplier_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  logo_url text,
  contact_email text,
  contact_phone text,
  website text,
  coverage_ports text[] DEFAULT '{}',
  categories text[] DEFAULT '{}',
  payment_terms_default text DEFAULT '30 days',
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Supplier team members (users who belong to a supplier org)
CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  role text DEFAULT 'owner' CHECK (role IN ('owner', 'sales', 'logistics', 'accounts')),
  name text,
  email text,
  phone text,
  can_confirm_orders boolean DEFAULT true,
  can_manage_catalogue boolean DEFAULT true,
  can_view_invoices boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON public.supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_user ON public.supplier_contacts(user_id);

-- RLS
ALTER TABLE public.supplier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;

-- Supplier users can read their own supplier profile
CREATE POLICY "supplier_read_own_profile" ON public.supplier_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.supplier_contacts sc
      WHERE sc.supplier_id = supplier_profiles.id
      AND sc.user_id = auth.uid()
    )
  );

-- Supplier users can update their own supplier profile (owner only)
CREATE POLICY "supplier_update_own_profile" ON public.supplier_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.supplier_contacts sc
      WHERE sc.supplier_id = supplier_profiles.id
      AND sc.user_id = auth.uid()
      AND sc.role = 'owner'
    )
  );

-- Vessel crew can read supplier profiles (for the directory)
CREATE POLICY "crew_read_supplier_profiles" ON public.supplier_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
      AND tm.active = true
    )
  );

-- Anon can read supplier profiles (for public order page claim flow)
CREATE POLICY "anon_read_supplier_profiles" ON public.supplier_profiles
  FOR SELECT TO anon USING (true);

-- Supplier contacts: users can read contacts for their own supplier
CREATE POLICY "supplier_read_own_contacts" ON public.supplier_contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.supplier_contacts sc2
      WHERE sc2.supplier_id = supplier_contacts.supplier_id
      AND sc2.user_id = auth.uid()
    )
  );

-- Insert policy for supplier profile (authenticated users can create)
CREATE POLICY "authenticated_insert_supplier_profiles" ON public.supplier_profiles
  FOR INSERT TO authenticated WITH CHECK (true);

-- Insert policy for supplier contacts (owner can add more, or first contact is always allowed)
CREATE POLICY "supplier_insert_contacts" ON public.supplier_contacts
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.supplier_contacts sc
      WHERE sc.supplier_id = supplier_contacts.supplier_id
      AND sc.user_id = auth.uid()
      AND sc.role = 'owner'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.supplier_contacts sc
      WHERE sc.supplier_id = supplier_contacts.supplier_id
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_profiles_updated_at
  BEFORE UPDATE ON public.supplier_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
