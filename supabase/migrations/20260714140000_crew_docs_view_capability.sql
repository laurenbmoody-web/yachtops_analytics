-- ─────────────────────────────────────────────────────────────────────────────
-- Crew-document view capability.
--
-- Viewing OTHER crew members' personal documents (certificates, contracts) is
-- normally Command-only. This adds an opt-in per-member capability so a Command
-- can grant it to, say, a Chief — who then sees the whole crew's certs in the
-- vault and the dashboard renewals widget. Defaults off; Command always has the
-- access implicitly via its existing ALL policy.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tenant_members
  add column if not exists can_view_crew_docs boolean not null default false;

comment on column public.tenant_members.can_view_crew_docs is
  'When true, this member may VIEW other crew members'' personal documents (certs/contracts) across the vessel — a normally Command-only capability. Command has it implicitly.';

-- Additive SELECT policy: a member with the capability may read shared members'
-- personal documents. OR''d with the existing owner + Command policies.
drop policy if exists "capability_view_crew_personal_documents" on public.personal_documents;
create policy "capability_view_crew_personal_documents"
  on public.personal_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members viewer
      join public.tenant_members subject on subject.tenant_id = viewer.tenant_id
      where viewer.user_id = auth.uid()
        and viewer.active = true
        and viewer.can_view_crew_docs = true
        and subject.user_id = personal_documents.user_id
    )
  );
