-- The issuing body (the certification company named on the cert) is the key
-- thing a reviewer checks against a scheme's register — e.g. BRCGS's public
-- lookup is a search for APPROVED certification bodies. It was extracted by
-- the AI but only shown in the email; store it and surface it in the console.

alter table public.supplier_certifications
  add column if not exists issuing_body text;

-- list_certs_for_review returns an extra column → drop + recreate.
drop function if exists public.list_certs_for_review();
create or replace function public.list_certs_for_review()
returns table (
  id            uuid,
  supplier_id   uuid,
  supplier_name text,
  name          text,
  doc_url       text,
  status        text,
  scheme        text,
  cert_number   text,
  issued_to     text,
  issuing_body  text,
  issue_date    date,
  expiry_date   date,
  ai_verdict    text,
  ai_flags      jsonb,
  ai_confidence numeric,
  registry_url  text,
  verified      boolean,
  verified_at   timestamptz,
  parsed_at     timestamptz,
  created_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.supplier_id, sp.name, c.name, c.doc_url,
         c.status, c.scheme, c.cert_number, c.issued_to, c.issuing_body,
         c.issue_date, c.expiry_date, c.ai_verdict, c.ai_flags, c.ai_confidence,
         c.registry_url, c.verified, c.verified_at, c.parsed_at, c.created_at
  from public.supplier_certifications c
  join public.supplier_profiles sp on sp.id = c.supplier_id
  where public.is_platform_admin()
  order by
    case c.status
      when 'flagged'    then 0
      when 'pending'    then 1
      when 'ai_checked' then 2
      when 'verified'   then 3
      when 'rejected'   then 4
      else 5
    end,
    c.parsed_at desc nulls last, c.created_at desc;
$$;
grant execute on function public.list_certs_for_review() to authenticated;
