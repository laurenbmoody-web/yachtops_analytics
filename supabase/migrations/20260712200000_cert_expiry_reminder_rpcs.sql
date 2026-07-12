-- Renewal reminders: find verified certs approaching expiry and who to email,
-- once per stage (30 days / 7 days / on expiry). The cert-expiry-reminders edge
-- function calls these daily via cron.

alter table public.supplier_certifications
  add column if not exists expiry_reminded_stages text[] not null default '{}';

-- Certs due a reminder now, with the stage and the supplier's recipient emails.
-- A stage fires once (tracked in expiry_reminded_stages).
create or replace function public.get_certs_due_for_reminder()
returns table (
  cert_id      uuid,
  cert_name    text,
  scheme       text,
  expiry_date  date,
  cert_number  text,
  issuing_body text,
  days_left    integer,
  stage        text,
  supplier_id  uuid,
  supplier_name text,
  recipients   text[]
)
language sql stable security definer set search_path = public as $$
  with due as (
    select
      c.id, c.name, c.scheme, c.expiry_date, c.cert_number, c.issuing_body,
      (c.expiry_date - current_date) as days_left,
      case
        when c.expiry_date <= current_date       then 'expired'
        when c.expiry_date <= current_date + 7    then '7'
        when c.expiry_date <= current_date + 30   then '30'
      end as stage,
      c.expiry_reminded_stages as sent,
      sp.id as supplier_id, sp.name as supplier_name,
      sp.storefront_contact_email, sp.contact_email
    from public.supplier_certifications c
    join public.supplier_profiles sp on sp.id = c.supplier_id
    where c.verified = true
      and c.expiry_date is not null
      and c.expiry_date <= current_date + 30
  )
  select
    d.id, d.name, d.scheme, d.expiry_date, d.cert_number, d.issuing_body,
    d.days_left, d.stage, d.supplier_id, d.supplier_name,
    coalesce((
      select array_agg(distinct e)
      from (
        select unnest(array_remove(array[d.storefront_contact_email, d.contact_email], null)) as e
        union
        select sc.email from public.supplier_contacts sc
          where sc.supplier_id = d.supplier_id and sc.active = true and sc.email is not null
      ) x
      where e is not null and btrim(e) <> ''
    ), '{}') as recipients
  from due d
  where d.stage is not null
    and not (d.stage = any(d.sent));
$$;
grant execute on function public.get_certs_due_for_reminder() to service_role;

-- Record that a stage's reminder has gone out (idempotent).
create or replace function public.mark_cert_reminded(p_cert_id uuid, p_stage text)
returns void
language sql security definer set search_path = public as $$
  update public.supplier_certifications
     set expiry_reminded_stages = array_append(coalesce(expiry_reminded_stages, '{}'), p_stage)
   where id = p_cert_id
     and not (p_stage = any(coalesce(expiry_reminded_stages, '{}')));
$$;
grant execute on function public.mark_cert_reminded(uuid, text) to service_role;
