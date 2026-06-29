-- Beta feedback widget — per-page "tap and send a note (or voice note)" button.
--
-- Three pieces:
--   1. vessels.feedback_widget_enabled — the toggle (vessel settings). Default
--      ON so the affordance is present during the beta; a vessel can switch it
--      off and it disappears immediately.
--   2. public.feedback — one row per submission (the in-app inbox). Insert is
--      open to any authenticated member (they file their own); read/update is
--      restricted to the product owner so the inbox is private.
--   3. feedback-audio storage bucket — private; holds the voice notes. Writes
--      come from the submit-feedback edge function (service role); the owner can
--      read via signed URLs for playback in the inbox.
--
-- Owner gate: the beta feedback stream is the product owner's. Reads are scoped
-- by auth email rather than a tenant role, since feedback spans every vessel.

-- ── 1. Toggle on the vessel ──────────────────────────────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS feedback_widget_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.vessels.feedback_widget_enabled IS
  'Beta: show the per-page feedback widget for this vessel. Default ON.';

-- ── 2. Feedback inbox table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email   text,
  user_name    text,
  kind         text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice')),
  message      text,
  audio_path   text,                       -- object path in feedback-audio bucket
  audio_ms     integer,                    -- voice-note duration, ms
  page_path    text,                       -- route the note was filed from
  page_title   text,
  user_agent   text,
  viewport     text,                       -- e.g. "390x844"
  app_version  text,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_created_idx ON public.feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_status_idx  ON public.feedback (status);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may file feedback as themselves.
DROP POLICY IF EXISTS "feedback_insert_own" ON public.feedback;
CREATE POLICY "feedback_insert_own"
ON public.feedback
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Only the product owner reads / triages the inbox.
DROP POLICY IF EXISTS "feedback_owner_read" ON public.feedback;
CREATE POLICY "feedback_owner_read"
ON public.feedback
FOR SELECT
TO authenticated
USING (lower(auth.jwt() ->> 'email') = 'lauren.moody@hotmail.co.uk');

DROP POLICY IF EXISTS "feedback_owner_update" ON public.feedback;
CREATE POLICY "feedback_owner_update"
ON public.feedback
FOR UPDATE
TO authenticated
USING (lower(auth.jwt() ->> 'email') = 'lauren.moody@hotmail.co.uk')
WITH CHECK (lower(auth.jwt() ->> 'email') = 'lauren.moody@hotmail.co.uk');

-- ── 3. Private voice-note bucket ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'feedback-audio',
  'feedback-audio',
  false,                       -- private; playback via signed URLs
  26214400                     -- 25MB — short voice notes
)
ON CONFLICT (id) DO NOTHING;

-- Owner reads voice notes (to mint signed URLs for playback). Uploads are done
-- by the submit-feedback edge function with the service role, which bypasses
-- RLS, so no insert policy is needed here.
DROP POLICY IF EXISTS "feedback_audio_owner_read" ON storage.objects;
CREATE POLICY "feedback_audio_owner_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'feedback-audio'
  AND lower(auth.jwt() ->> 'email') = 'lauren.moody@hotmail.co.uk'
);
