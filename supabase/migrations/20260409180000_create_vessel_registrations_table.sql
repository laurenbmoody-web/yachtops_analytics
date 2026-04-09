-- Vessel registrations table for IMO lookup caching and lead capture
-- Used by the verifyVessel Edge Function and the /get-started questionnaire flow

CREATE TABLE IF NOT EXISTS vessel_registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vessel_name text NOT NULL,
  imo_number text UNIQUE,
  loa_metres numeric,
  loa_verified boolean DEFAULT false,
  vessel_type text,
  flag_state text,
  year_built integer,
  gross_tonnage numeric,
  home_port text,
  pricing_tier text CHECK (pricing_tier IN ('under_40m', '40_80m', 'over_80m')),
  contact_name text,
  contact_role text,
  contact_email text,
  contact_phone text,
  api_response jsonb,
  verified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Index for fast IMO lookups
CREATE INDEX IF NOT EXISTS idx_vessel_registrations_imo ON vessel_registrations (imo_number);

-- Index for cache TTL queries
CREATE INDEX IF NOT EXISTS idx_vessel_registrations_verified_at ON vessel_registrations (verified_at);

-- RLS: service role only (Edge Function uses service role key)
ALTER TABLE vessel_registrations ENABLE ROW LEVEL SECURITY;

-- No public access — only the Edge Function (via service role) reads/writes this table
-- If you later want the frontend to read cached results directly, add a SELECT policy
