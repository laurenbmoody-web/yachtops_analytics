-- AI first-pass review for uploaded certificates. When a supplier attaches a
-- certificate document, an edge function (review-supplier-cert) reads it with
-- Claude, screens it, and emails the Cargo team with the parsed details + a
-- link to the issuing body's public register to check it on. The parse is
-- stamped onto the row here so the (future) internal console can show it and
-- so the same document is never re-reviewed / re-emailed.

alter table public.supplier_certifications
  add column if not exists status        text not null default 'pending',
                                          -- pending | ai_checked | flagged | verified | rejected
  add column if not exists scheme         text,        -- detected scheme id (brcgs, ifs, msc, haccp, …)
  add column if not exists cert_number     text,
  add column if not exists issued_to       text,        -- who the cert names
  add column if not exists issue_date      date,
  add column if not exists expiry_date     date,
  add column if not exists ai_verdict      text,        -- good | review | problem
  add column if not exists ai_flags        jsonb not null default '[]'::jsonb,
  add column if not exists ai_confidence   numeric,
  add column if not exists registry_url    text,        -- official register to check it on
  add column if not exists parsed_doc_url  text,        -- the doc_url last parsed (idempotency)
  add column if not exists parsed_at       timestamptz;

-- Keep the buyer-facing verified tick honest: verified is true only when a
-- human/registry sign-off set status = 'verified'.
create or replace function public.set_cert_verified_flag()
returns trigger language plpgsql as $$
begin
  new.verified := (new.status = 'verified');
  if new.verified and new.verified_at is null then
    new.verified_at := now();
  elsif not new.verified then
    new.verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cert_verified_flag on public.supplier_certifications;
create trigger trg_cert_verified_flag
  before insert or update of status on public.supplier_certifications
  for each row execute function public.set_cert_verified_flag();
