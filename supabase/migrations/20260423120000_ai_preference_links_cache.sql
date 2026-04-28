-- AI-generated preference→inventory link cache.
--
-- The generate-preference-links Edge Function is stateless. Every call
-- otherwise would hit the Anthropic API with a fresh round-trip, which is
-- slow and costs tokens for payloads that haven't materially changed
-- (most page loads on /inventory/weekly reuse the same guest + inventory
-- snapshot). The cache stores the model's response keyed by a SHA256 of
-- (guest_id + sorted prefs + sorted inventory snapshot + trip days
-- remaining). Any change to the guest's prefs, any inventory qty update,
-- or a change in days remaining produces a different key — cache miss,
-- regenerate.
--
-- Tenant scoping is implicit via guest_id's FK. Clearing a guest's
-- preferences or inventory deltas bumps the key naturally; no manual
-- invalidation needed.

CREATE TABLE IF NOT EXISTS public.ai_preference_links_cache (
  cache_key  TEXT PRIMARY KEY,
  guest_id   UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_preference_links_cache_guest_idx
  ON public.ai_preference_links_cache(guest_id);

-- Housekeeping: RLS policy matching how other cache-like tables in the
-- repo are scoped. The Edge Function will run with the service role so
-- the policy mostly gates client-side reads; the cache payload isn't
-- sensitive (it's public inventory info + the AI's match opinion) but
-- we still scope to tenant members.
ALTER TABLE public.ai_preference_links_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_preference_links_cache"
  ON public.ai_preference_links_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.guests g
      JOIN public.tenant_members tm ON tm.tenant_id = g.tenant_id
      WHERE g.id = ai_preference_links_cache.guest_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
  );
