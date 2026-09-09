-- Align host_subscriptions metadata with the current four-plan catalog.

alter table public.host_subscriptions
  drop constraint host_subscriptions_plan_id_check;

alter table public.host_subscriptions
  add constraint host_subscriptions_plan_id_check
  check (plan_id in ('starter', 'pro', 'portfolio', 'agency'));

alter table public.host_subscriptions
  alter column monthly_usd set default 49;