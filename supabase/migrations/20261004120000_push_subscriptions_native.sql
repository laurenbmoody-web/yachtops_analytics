-- Native app push (iOS APNs / Android FCM) shares push_subscriptions with web
-- push, so every sender (laundry-push, job-reminder-push) reaches a person's
-- phone whichever way it enrolled.
--
--   platform = 'web'      endpoint = Web Push endpoint URL, p256dh + auth set
--   platform = 'ios'      endpoint = APNs device token (hex), keys null
--   platform = 'android'  endpoint = FCM registration token, keys null
--
-- endpoint stays the unique key the client upserts on.
alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check check (platform in ('web', 'ios', 'android'));

alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;

-- Web rows still need their encryption keys.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_web_keys_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_web_keys_check
  check (platform <> 'web' or (p256dh is not null and auth is not null));

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
