-- Internal Cargo console for verifying supplier certificates. There was no
-- "platform admin" concept before this — introduce a small email allowlist
-- (platform_admins) plus is_platform_admin(), then a queue RPC and an action
-- RPC gated on it. The buyer-facing verified tick is granted here, by a human,
-- after checking the document against the issuing body's register.

-- ── Who is Cargo staff ───────────────────────────────────────────────────
create table if not exists public.platform_admins (
  email    text primary key,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- No policies: the table is only ever read through the SECURITY DEFINER
-- helper below, never directly by clients.

insert into public.platform_admins (email) values ('lauren.moody@hotmail.co.uk')
on conflict (email) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- ── The review queue — flagged first, newest first ──────────────────────
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
  select c.id, c.supplier_id, coalesce(sp.company_name, sp.name), c.name, c.doc_url,
         c.status, c.scheme, c.cert_number, c.issued_to, c.issue_date, c.expiry_date,
         c.ai_verdict, c.ai_flags, c.ai_confidence, c.registry_url,
         c.verified, c.verified_at, c.parsed_at, c.created_at
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

-- ── Grant / revoke the tick (verified flag is synced by the row trigger) ─
create or replace function public.set_certification_status(p_cert_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised';
  end if;
  if p_status not in ('verified', 'rejected', 'ai_checked', 'flagged', 'pending') then
    raise exception 'invalid status %', p_status;
  end if;
  update public.supplier_certifications set status = p_status where id = p_cert_id;
end;
$$;
grant execute on function public.set_certification_status(uuid, text) to authenticated;
